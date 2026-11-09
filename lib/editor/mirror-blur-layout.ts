import { DEFAULT_COLOR_GRADE, VISUAL_EFFECT_LIMITS } from './visual-effects';
import { validateVisualTransform } from './visual-inputs';
import { calculateVisualRect } from './visual-source-geometry';
import { playbackRateOf } from './playback-rate';
import { DEFAULT_TRANSFORM, deriveTrackCounts, dimensions, layerGroup, normalizeTimeline, trackOf, type BackgroundFill, type Clip, type MediaAsset, type Timeline } from './types';

type LayoutSource = Pick<MediaAsset, '_id' | 'kind' | 'width' | 'height'>;

/** Background look of the mirrored bands: blurred and a little darker than the sharp clip. */
export const MIRROR_BLUR_AMOUNT = 24;
export const MIRROR_BLUR_EXPOSURE = -0.45;
export const MIRROR_FILL_LIMITS = { blur: VISUAL_EFFECT_LIMITS.softBlur.amount, darken: [0, -VISUAL_EFFECT_LIMITS.colorGrade.exposure[0]] } as const;
export const DEFAULT_MIRROR_FILL: Readonly<BackgroundFill> = Object.freeze({ kind: 'mirror-blur', blur: MIRROR_BLUR_AMOUNT, darken: -MIRROR_BLUR_EXPOSURE });
const MIRROR_SEAM_OVERLAP = 3;
/** Render-only band ids: `<clip id>~mirror-<n>`. They never reach a saved timeline. */
const FILL_COPY = '~mirror-';
export const mirrorFillOwner = (id: string) => { const at = id.lastIndexOf(FILL_COPY); return at > 0 ? id.slice(0, at) : undefined; };

/** Visible height of a full-width wide source, in canvas fractions; undefined when it cannot be computed. */
function containedBand(asset: LayoutSource | undefined, canvas: { width: number; height: number }) {
  if (!asset?.width || !asset.height || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) return undefined;
  return calculateVisualRect(asset.width, asset.height, canvas.width, canvas.height, undefined, undefined, 'contain').height / canvas.height;
}

/** Refuses a clip the layout cannot fill, with the reason. */
function bandHeight(asset: LayoutSource | undefined, clip: Clip, canvas: { width: number; height: number }) {
  if ((clip.kind !== 'video' && clip.kind !== 'image') || !asset || asset.kind !== clip.kind || asset._id !== clip.assetId) throw new Error('Choose a video or image source for the mirror blur layout.');
  const band = containedBand(asset, canvas);
  if (band === undefined) throw new Error('Wait for the source dimensions before applying a mirror blur layout.');
  if (clip.motion?.length || clip.focus?.length || clip.cameraMotion || clip.smoothZoom) throw new Error('Remove existing custom motion, camera motion or subject-follow crop before applying a mirror blur layout.');
  if (band >= 1 - 1e-6) throw new Error('The mirror blur layout needs a source wider than the canvas. Set a taller aspect ratio first.');
  return band;
}

const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value));
export function validBackgroundFill(fill: Partial<Omit<BackgroundFill, 'kind'>> = {}): BackgroundFill {
  const blur = fill.blur ?? DEFAULT_MIRROR_FILL.blur, darken = fill.darken ?? DEFAULT_MIRROR_FILL.darken;
  if (!Number.isFinite(blur) || !Number.isFinite(darken)) throw new Error('Mirror blur needs finite blur and darken values.');
  return { kind: 'mirror-blur', blur: clamp(blur, MIRROR_FILL_LIMITS.blur), darken: clamp(darken, MIRROR_FILL_LIMITS.darken) };
}

/**
 * The bands around one sharp clip: enough stacked copies per side to reach the frame edge. The first
 * copy on each side is flipped vertically so it meets the sharp clip at the matching edge; further copies
 * alternate so every seam joins mirrored pixels. Ordered far to near, so nearer bands paint on top.
 */
function mirrorBands(middle: Clip, band: number, canvas: { width: number; height: number }, fill: BackgroundFill, id: (step: number, side: -1 | 1) => string) {
  const perSide = Math.max(1, Math.ceil((1 - band) / 2 / band - 1e-6));
  const transform = { ...DEFAULT_TRANSFORM, opacity: middle.transform?.opacity ?? 1 };
  const grade = middle.colorGrade?.enabled ? middle.colorGrade : DEFAULT_COLOR_GRADE;
  const exposure = Math.max(VISUAL_EFFECT_LIMITS.colorGrade.exposure[0], grade.exposure - fill.darken);
  // Each copy reaches a few design pixels under its neighbours so antialiased edges never show the black canvas.
  const scale = 1 + 2 * MIRROR_SEAM_OVERLAP / (band * canvas.height);
  const copies: { step: number; side: -1 | 1; clip: Clip }[] = [];
  for (let step = perSide; step >= 1; step--) for (const side of [-1, 1] as const) {
    const copyTransform = { ...transform, y: .5 + side * step * band, scale };
    validateVisualTransform(copyTransform);
    copies.push({ step, side, clip: {
      ...middle, id: id(step, side), transform: copyTransform, fit: 'contain', crop: undefined,
      flip: step % 2 ? { vertical: true } : undefined,
      softBlur: { enabled: true, amount: fill.blur },
      colorGrade: { ...grade, enabled: true, exposure },
      volume: 0, audioSeparated: true,
      linkedClipId: undefined, audio: undefined, normalizedAudio: undefined, audioFadeTiming: undefined,
      outline: undefined, frameCorners: undefined, approval: undefined, approvedSections: undefined, backgroundFill: undefined, transition: undefined,
      // Keyed, tracked or moving looks would override the fixed background blur, darkening and placement.
      effectKeyframes: undefined, audioReactive: undefined, mask: undefined, pixelTracking: undefined,
      motion: undefined, motionOffset: undefined, focus: undefined, cameraMotion: undefined, smoothZoom: undefined,
    } });
  }
  return copies;
}

const stackKey = (clip: Clip) => JSON.stringify([clip.kind, clip.assetId, clip.start, clip.duration, clip.sourceStart, playbackRateOf(clip), clip.speedRamp ?? null]);
const isStackCopy = (clip: Clip) => (clip.kind === 'video' || clip.kind === 'image') && !!clip.softBlur?.enabled && (clip.kind === 'image' || (clip.volume ?? 1) === 0) && !clip.linkedClipId;

/**
 * Copies of a sharp clip made by the old stacked mirror-blur layout (before backgroundFill): blurred,
 * muted clips of the same footage, timing and speed on V layers beneath it.
 */
export function stackedMirrorCopies(timeline: Timeline, sharpId: string): Clip[] {
  const sharp = timeline.clips.find(clip => clip.id === sharpId);
  if (!sharp || (sharp.kind !== 'video' && sharp.kind !== 'image') || sharp.softBlur?.enabled) return [];
  const key = stackKey(sharp);
  return timeline.clips.filter(clip => clip.id !== sharp.id && isStackCopy(clip) && trackOf(clip) < trackOf(sharp) && stackKey(clip) === key);
}

/** Every clip that is a stacked mirror copy of some sharp clip, in one pass. */
export function stackedMirrorCopyIds(timeline: Timeline): Set<string> {
  const sharp = new Map<string, number>();
  for (const clip of timeline.clips) if ((clip.kind === 'video' || clip.kind === 'image') && !clip.softBlur?.enabled) sharp.set(stackKey(clip), Math.max(sharp.get(stackKey(clip)) ?? -Infinity, trackOf(clip)));
  return new Set(timeline.clips.filter(clip => isStackCopy(clip) && (sharp.get(stackKey(clip)) ?? -Infinity) > trackOf(clip)).map(clip => clip.id));
}

/** Remove the given clips and every V layer they leave empty, keeping the other layers in order. */
function dropCopies(timeline: Timeline, removed: ReadonlySet<string>): Timeline {
  const emptied = new Set(timeline.clips.filter(clip => removed.has(clip.id)).map(trackOf));
  const clips = timeline.clips.filter(clip => !removed.has(clip.id));
  for (const clip of clips) if (layerGroup(clip.kind) === 'visual') emptied.delete(trackOf(clip));
  const below = (track: number) => [...emptied].filter(number => number < track).length;
  const next = { ...timeline, clips: clips.map(clip => layerGroup(clip.kind) === 'visual' && below(trackOf(clip)) ? { ...clip, track: trackOf(clip) - below(trackOf(clip)) } : clip) };
  const counts = deriveTrackCounts(timeline);
  return { ...next, tracks: deriveTrackCounts({ ...next, tracks: { ...counts, visual: Math.max(1, counts.visual - emptied.size) } }) };
}

const stripUndefined = (clip: Clip) => Object.fromEntries(Object.entries(clip).filter(([, value]) => value !== undefined)) as Clip;

/**
 * Mirror blur as one clip: each selected clip is fit to the full width in the middle and gets a
 * `backgroundFill` that renders blurred, darkened, mirrored bands of its own frames above and below.
 * No clips or layers are added. A clip that still has copies from the old stacked layout is folded:
 * its copies are removed (with the V layers they emptied) and their blur and darkening carried over.
 * Applying it again updates the look.
 */
export function applyMirrorBlurLayout(input: Timeline, assets: readonly LayoutSource[], clipIds: readonly string[], look: Partial<Omit<BackgroundFill, 'kind'>> = {}): { timeline: Timeline; folded: Record<string, string[]> } {
  if (!clipIds.length) throw new Error('Choose footage for the mirror blur layout.');
  if (new Set(clipIds).size !== clipIds.length) throw new Error('Choose each mirror blur clip only once.');
  const timeline = normalizeTimeline(input);
  const canvas = dimensions(timeline.aspectRatio);
  const sources = new Map(assets.map(asset => [asset._id, asset]));
  const folded: Record<string, string[]> = {};
  const fills = new Map<string, BackgroundFill>();
  const stackCopies = stackedMirrorCopyIds(timeline);
  for (const id of clipIds) {
    const clip = timeline.clips.find(current => current.id === id);
    if (!clip) throw new Error('A selected mirror blur clip is no longer on the timeline.');
    if (mirrorFillOwner(id)) throw new Error('Choose the sharp clip, not a rendered mirror band.');
    if (stackCopies.has(id)) throw new Error('This clip is a blurred mirror copy. Choose the sharp clip it repeats.');
    bandHeight(sources.get(clip.assetId ?? ''), clip, canvas);
    const copies = stackedMirrorCopies(timeline, id);
    if (copies.length) folded[id] = copies.map(copy => copy.id);
    fills.set(id, validBackgroundFill({ ...(copies.length ? stackLook(clip, copies) : clip.backgroundFill), ...look }));
  }
  const removed = new Set(Object.values(folded).flat());
  const clips = timeline.clips.map(clip => {
    const fill = fills.get(clip.id);
    if (!fill) return clip;
    const transform = { ...DEFAULT_TRANSFORM, opacity: clip.transform?.opacity ?? 1 };
    validateVisualTransform(transform);
    return stripUndefined({ ...clip, fit: 'contain', crop: undefined, transform, flip: undefined, backgroundFill: fill });
  });
  return { timeline: removed.size ? dropCopies({ ...timeline, clips }, removed) : { ...timeline, clips }, folded };
}

/** The blur and darkening an old stack used, read from its copies. */
function stackLook(sharp: Clip, copies: readonly Clip[]): Omit<BackgroundFill, 'kind'> {
  const copy = copies[0];
  const base = sharp.colorGrade?.enabled ? sharp.colorGrade.exposure : 0;
  const exposure = copy.colorGrade?.enabled ? copy.colorGrade.exposure : 0;
  return { blur: copy.softBlur?.amount ?? MIRROR_BLUR_AMOUNT, darken: Math.max(0, base - exposure) };
}

/**
 * One-shot conversion of old stacked mirror-blur timelines: every sharp clip (or only clipIds) whose
 * blurred copies sit on V layers beneath it becomes one clip with a backgroundFill. Its framing is kept.
 */
export function foldMirrorBlurStacks(input: Timeline, clipIds?: readonly string[]): { timeline: Timeline; folded: Record<string, string[]> } {
  const timeline = normalizeTimeline(input);
  const candidates = clipIds?.length ? clipIds : timeline.clips.filter(clip => (clip.kind === 'video' || clip.kind === 'image') && !isStackCopy(clip)).map(clip => clip.id);
  const folded: Record<string, string[]> = {};
  const fills = new Map<string, BackgroundFill>();
  const claimed = new Set<string>();
  for (const id of candidates) {
    const sharp = timeline.clips.find(clip => clip.id === id);
    if (!sharp) throw new Error('A selected clip is no longer on the timeline.');
    const copies = stackedMirrorCopies(timeline, id).filter(copy => !claimed.has(copy.id));
    if (!copies.length) { if (clipIds?.length) throw new Error(`Clip ${id} has no stacked mirror blur copies to fold.`); continue; }
    for (const copy of copies) claimed.add(copy.id);
    folded[id] = copies.map(copy => copy.id);
    fills.set(id, validBackgroundFill(stackLook(sharp, copies)));
  }
  if (!fills.size) throw new Error('This timeline has no stacked mirror blur copies to fold.');
  const clips = timeline.clips.map(clip => fills.has(clip.id) ? { ...clip, backgroundFill: fills.get(clip.id) } : clip);
  return { timeline: dropCopies({ ...timeline, clips }, claimed), folded };
}

/**
 * Render-time expansion of backgroundFill: the bands become extra clips on the sharp clip's own layer,
 * appended after every saved clip so saved clips keep their composition indices. Idempotent. The
 * composition stacks them just beneath their sharp clip (mirrorFillOwner); preview draws them from the
 * sharp clip's decoder (mirrorBlurSources).
 * TODO(fast export): plainExportPlan refuses clips that set backgroundFill, so these timelines take the
 * browser export. An FFmpeg path could render the bands with split/vflip/boxblur/overlay of the one decode.
 */
export function expandBackgroundFills(timeline: Timeline, assets: readonly LayoutSource[]): Timeline {
  if (!timeline.clips.some(clip => clip.backgroundFill)) return timeline;
  const canvas = dimensions(timeline.aspectRatio);
  const sources = new Map(assets.map(asset => [asset._id, asset]));
  const present = new Set(timeline.clips.map(clip => clip.id));
  const added: Clip[] = [];
  for (const clip of timeline.clips) {
    if (clip.backgroundFill?.kind !== 'mirror-blur' || (clip.kind !== 'video' && clip.kind !== 'image')) continue;
    const asset = sources.get(clip.assetId ?? '');
    const band = asset?.kind === clip.kind ? containedBand(asset, canvas) : undefined;
    if (band === undefined || band >= 1 - 1e-6) continue;
    const fill = validBackgroundFill(clip.backgroundFill);
    for (const { clip: copy } of mirrorBands(clip, band, canvas, fill, (step, side) => `${clip.id}${FILL_COPY}${step}${side < 0 ? 'a' : 'b'}`)) if (!present.has(copy.id)) added.push(stripUndefined(copy));
  }
  return added.length ? { ...timeline, clips: [...timeline.clips, ...added] } : timeline;
}

/**
 * Blurred copies that show exactly the frames of a sharp clip: same footage, timing and speed.
 * Editor preview draws them from that clip's decoder instead of decoding the file again per copy.
 * Maps each copy's id to its sharp clip's id: backgroundFill bands by id, old stacked copies by
 * matching footage. Export still renders every copy from its own decode.
 */
export function mirrorBlurSources(clips: readonly Clip[]): Map<string, string> {
  const key = (clip: Clip) => JSON.stringify([clip.assetId, clip.start, clip.duration, clip.sourceStart, playbackRateOf(clip), clip.speedRamp ?? null]);
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const sharp = new Map<string, string>();
  for (const clip of clips) if (clip.kind === 'video' && clip.assetId && !clip.softBlur?.enabled && !mirrorFillOwner(clip.id) && !sharp.has(key(clip))) sharp.set(key(clip), clip.id);
  // A transition samples its own clips' decoders, and an audible copy needs its own element.
  const transitioning = new Set(clips.flatMap(clip => clip.transition ? [clip.transition.fromClipId, clip.transition.toClipId] : []));
  const sources = new Map<string, string>();
  for (const clip of clips) {
    const copy = clip.kind === 'video' && clip.softBlur?.enabled && clip.softBlur.amount > 0 && (clip.volume ?? 1) === 0 && !transitioning.has(clip.id);
    if (!copy) continue;
    const owner = mirrorFillOwner(clip.id), fillOwner = owner ? byId.get(owner) : undefined;
    const twin = fillOwner ? (fillOwner.kind === 'video' ? fillOwner.id : undefined) : sharp.get(key(clip));
    if (twin) sources.set(clip.id, twin);
  }
  return sources;
}
