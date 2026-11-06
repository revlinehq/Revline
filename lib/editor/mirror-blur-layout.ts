import { DEFAULT_COLOR_GRADE, VISUAL_EFFECT_LIMITS } from './visual-effects';
import { validateVisualTransform } from './visual-inputs';
import { calculateVisualRect } from './visual-source-geometry';
import { DEFAULT_TRANSFORM, deriveTrackCounts, dimensions, layerGroup, maxTrackCount, normalizeTimeline, trackOf, type Clip, type MediaAsset, type Timeline } from './types';

type LayoutSource = Pick<MediaAsset, '_id' | 'kind' | 'width' | 'height'>;

/** Background look shared by every mirrored copy: blurred and a little darker than the sharp clip. */
export const MIRROR_BLUR_AMOUNT = 24;
export const MIRROR_BLUR_EXPOSURE = -0.45;
const MIRROR_SEAM_OVERLAP = 3;

/** Visible height of a full-width wide source, in canvas fractions, or a refusal when it already fills the height. */
function bandHeight(asset: LayoutSource | undefined, clip: Clip, canvas: { width: number; height: number }) {
  if ((clip.kind !== 'video' && clip.kind !== 'image') || !asset || asset.kind !== clip.kind || asset._id !== clip.assetId) throw new Error('Choose a video or image source for the mirror blur layout.');
  if (!asset.width || !asset.height || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) throw new Error('Wait for the source dimensions before applying a mirror blur layout.');
  if (clip.motion?.length || clip.focus?.length || clip.cameraMotion || clip.smoothZoom) throw new Error('Remove existing custom motion, camera motion or subject-follow crop before applying a mirror blur layout.');
  const band = calculateVisualRect(asset.width, asset.height, canvas.width, canvas.height, undefined, undefined, 'contain').height / canvas.height;
  if (band >= 1 - 1e-6) throw new Error('The mirror blur layout needs a source wider than the canvas. Set a taller aspect ratio first.');
  return band;
}

/**
 * Sharp clip fit to the full width in the middle; the empty space above and below is filled with
 * synchronized, muted, blurred copies of the same clip on new V layers beneath it. The first copy on
 * each side is flipped vertically so it meets the sharp clip at the matching edge; further copies
 * alternate so every seam joins mirrored pixels and no black bar remains.
 */
export function applyMirrorBlurLayout(input: Timeline, assets: readonly LayoutSource[], clipIds: readonly string[], newId: () => string = () => crypto.randomUUID()): { timeline: Timeline; copies: Record<string, string[]> } {
  if (!clipIds.length) throw new Error('Choose footage for the mirror blur layout.');
  if (new Set(clipIds).size !== clipIds.length) throw new Error('Choose each mirror blur clip only once.');
  const timeline = normalizeTimeline(input);
  const canvas = dimensions(timeline.aspectRatio);
  const sources = new Map(assets.map(asset => [asset._id, asset]));
  const selected = clipIds.map(id => {
    const clip = timeline.clips.find(current => current.id === id);
    if (!clip) throw new Error('A selected mirror blur clip is no longer on the timeline.');
    return { clip, band: bandHeight(sources.get(clip.assetId ?? ''), clip, canvas) };
  });
  if (new Set(selected.map(({ clip }) => trackOf(clip))).size > 1) throw new Error('Selected mirror blur clips are on different V layers. Apply the layout to one layer at a time.');
  for (const [index, { clip }] of selected.entries()) for (const { clip: other } of selected.slice(index + 1)) {
    if (clip.start < other.start + other.duration - 1e-6 && other.start < clip.start + clip.duration - 1e-6) throw new Error('Selected mirror blur clips overlap in time. Apply the layout to one stacked clip at a time.');
  }
  const mirrored = new Set(selected.map(({ clip }) => `${clip.assetId}:${clip.start}:${clip.duration}:${clip.sourceStart}`));
  if (timeline.clips.some(clip => clip.flip?.vertical && clip.softBlur?.enabled && mirrored.has(`${clip.assetId}:${clip.start}:${clip.duration}:${clip.sourceStart}`))) throw new Error('This clip already has mirror blur copies. Delete them before applying the layout again.');

  // Copies per side: enough stacked bands to reach the frame edge from the middle band.
  const perSide = selected.map(({ band }) => Math.max(1, Math.ceil((1 - band) / 2 / band - 1e-6)));
  const layers = 2 * Math.max(...perSide);
  const base = Math.min(...selected.map(({ clip }) => trackOf(clip)));
  const visualLimit = maxTrackCount('visual');
  const visualCount = deriveTrackCounts(timeline).visual;
  if (visualCount + layers > visualLimit) throw new Error(`The mirror blur layout needs ${layers} new V layers beneath the clip; this timeline would exceed ${visualLimit}.`);
  const shifted = timeline.clips.map(clip => layerGroup(clip.kind) === 'visual' && trackOf(clip) >= base ? { ...clip, track: trackOf(clip) + layers } : clip);

  const middles = new Map<string, Clip>();
  const added: Clip[] = [];
  const copies: Record<string, string[]> = {};
  for (const [index, { clip, band }] of selected.entries()) {
    const current = shifted.find(item => item.id === clip.id)!;
    const transform = { ...DEFAULT_TRANSFORM, opacity: clip.transform?.opacity ?? 1 };
    validateVisualTransform(transform);
    const middle: Clip = { ...current, fit: 'contain', crop: undefined, transform, flip: undefined };
    middles.set(clip.id, middle);
    copies[clip.id] = [];
    const grade = middle.colorGrade?.enabled ? middle.colorGrade : DEFAULT_COLOR_GRADE;
    const exposure = Math.max(VISUAL_EFFECT_LIMITS.colorGrade.exposure[0], grade.exposure + MIRROR_BLUR_EXPOSURE);
    // Each copy reaches a few design pixels under its neighbours so antialiased edges never show the black canvas.
    const overlapScale = 1 + 2 * MIRROR_SEAM_OVERLAP / (band * canvas.height);
    for (let step = 1; step <= perSide[index]; step++) for (const side of [-1, 1] as const) {
      const copyTransform = { ...transform, y: .5 + side * step * band, scale: overlapScale };
      validateVisualTransform(copyTransform);
      const id = newId();
      copies[clip.id].push(id);
      added.push({
        ...middle, id, transform: copyTransform,
        // Far copies sit lowest; the pair nearest the sharp clip sits directly beneath it.
        track: base + layers - 2 * step + (side < 0 ? 0 : 1),
        flip: step % 2 ? { vertical: true } : undefined,
        softBlur: { enabled: true, amount: MIRROR_BLUR_AMOUNT },
        colorGrade: { ...grade, enabled: true, exposure },
        volume: 0, audioSeparated: true,
        linkedClipId: undefined, audio: undefined, normalizedAudio: undefined, audioFadeTiming: undefined,
        outline: undefined, frameCorners: undefined, approval: undefined, approvedSections: undefined,
        // Keyed or tracked looks would override the fixed background blur and darkening.
        effectKeyframes: undefined, audioReactive: undefined, mask: undefined, pixelTracking: undefined,
      });
    }
  }
  const clips = [...added, ...shifted.map(clip => middles.get(clip.id) ?? clip)].map(clip => Object.fromEntries(Object.entries(clip).filter(([, value]) => value !== undefined)) as Clip);
  const next = { ...timeline, clips, tracks: { ...deriveTrackCounts(timeline), visual: visualCount + layers } };
  return { timeline: { ...next, tracks: deriveTrackCounts(next) }, copies };
}
