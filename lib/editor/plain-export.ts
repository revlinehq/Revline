import { resolvedAudioTimeline } from './audio-normalization';
import { canonical } from './export-reuse';
import { expandBackgroundFills, mirrorFillOwner } from './mirror-blur-layout';
import { layerZIndex, type ExportResolution } from './composition';
import { calculateVisualRect } from './visual-source-geometry';
import { audioFadeAttributes, audioVolumeEnvelope, validateAudioTimeline } from './audio-settings';
import { MAX_CLIP_VOLUME } from './clip-volume';
import { playbackRateOf, validatePlaybackRate } from './playback-rate';
import { VISUAL_EFFECT_KEYS } from './visual-effects';
import { DEFAULT_TRANSFORM, dimensions, timelineDuration, type Clip, type MediaAsset, type Timeline } from './types';

/** Where a layered clip's frames come from: HyperFrames' sampling of its source, as for a full-frame clip. */
type PlainSampling = {
  assetId: string; sourceStart: number; playbackRate: number;
  /** Source seconds HyperFrames extracts for the clip (its duration times speed). */
  sourceDuration: number;
  /** First output tick minus clip start, in frames; HyperFrames samples relative to the unsnapped start. */
  phase: number;
};
/**
 * One clip in a stack, painted in order over black. The source is scaled to scaleWidth x scaleHeight
 * (framing times transform scale), cut to its visible window (crop), flipped inside that window,
 * blurred and darkened like the editor's effect canvas, and placed at x/y (may be off-canvas).
 */
export type PlainLayer = PlainSampling & {
  clipId: string;
  /** Frames from the stack start to the clip's first visible frame, and how many frames it shows. */
  offset: number; frames: number;
  scaleWidth: number; scaleHeight: number;
  crop: { x: number; y: number; width: number; height: number };
  x: number; y: number;
  flip: { horizontal: boolean; vertical: boolean };
  /** Gaussian sigma in output pixels of the soft blur, 0 for none. */
  blur: number;
  /** Exposure in stops (the grade multiplies RGB by 2^exposure), 0 for none. */
  exposure: number;
};
/** One output frame range of the single visible footage layer, a stack of layered clips, or black between them. */
export type PlainVideoSegment =
  | { kind: 'gap'; frames: number }
  | (PlainSampling & {
    kind: 'clip'; clipId: string; frames: number;
    fit: 'cover' | 'contain';
    /** Integer source raster and its placement on the canvas: crop offset for cover, pad offset for contain. */
    scaleWidth: number; scaleHeight: number; x: number; y: number;
  })
  | { kind: 'stack'; frames: number; layers: PlainLayer[] };
/** A static text clip, rasterized once by the browser text renderer and laid over the footage on these frames. */
export type PlainTextOverlay = { clipId: string; first: number; end: number;
  /** Everything that sets the text's pixels, for caching its raster and the segments under it. */
  look: string };
export type PlainAudioTrack = { clipId: string; assetId: string; kind: 'video' | 'audio'; start: number; duration: number; sourceStart: number; playbackRate: number; volume: number; fadeIn: number; fadeOut: number };
export type PlainExportPlan = { width: number; height: number; fps: 24 | 30 | 60; duration: number; frames: number; video: PlainVideoSegment[]; text: PlainTextOverlay[]; audio: PlainAudioTrack[] };
export type PlainExportDecision = { eligible: true; plan: PlainExportPlan } | { eligible: false; reason: string };

/** The encoder opens every sounding clip at once (footage is chunked). Larger mixes keep the browser path. */
const PLAIN_EXPORT_MAX_AUDIO_TRACKS = 64;
/** Each static text is captured in one bounded browser session; more keep the browser path. */
export const PLAIN_EXPORT_MAX_TEXT_OVERLAYS = 12;
/** Distinct decoded sources one stack may open at once (a producer holds them all). */
export const PLAIN_EXPORT_MAX_STACK_SOURCES = 8;
// HyperFrames snaps clip edges within 1/1000 frame to the frame grid (parityContract FRAME_BOUNDARY_EPSILON).
const FRAME_BOUNDARY_EPSILON = 1e-3;
const SHARED_KEYS = new Set<keyof Clip>(['id', 'kind', 'assetId', 'track', 'start', 'duration', 'sourceStart', 'playbackRate', 'volume', 'linkedClipId', 'audioSeparated', 'effectPreset', 'motion', 'motionOffset', 'approval', 'approvedSections']);
const VIDEO_KEYS = new Set<keyof Clip>([...SHARED_KEYS, 'fit', 'transform', 'crop', 'blendMode', 'focus', 'framingCuts', 'visualFade', 'flip', 'backgroundFill', ...VISUAL_EFFECT_KEYS]);
const AUDIO_KEYS = new Set<keyof Clip>([...SHARED_KEYS, 'audio', 'audioFadeTiming']);
// Everything the browser text layer reads for a clip without a template, gradient or entrance.
const TEXT_KEYS = new Set<keyof Clip>(['id', 'kind', 'track', 'start', 'duration', 'sourceStart', 'playbackRate', 'volume', 'text', 'fontSize', 'color', 'background', 'x', 'y', 'textStyle', 'fontFamily', 'transform', 'blendMode', 'animation', 'textAnimationTiming', 'approval', 'approvedSections']);

const TEXT_PLACEMENT_KEYS = new Set<keyof Clip>(['id', 'start', 'duration', 'track', 'sourceStart', 'playbackRate', 'volume', 'approval', 'approvedSections', 'textAnimationTiming']);

function snapToFrame(time: number, fps: number) {
  const position = time * fps, nearest = Math.round(position);
  return Math.abs(position - nearest) <= FRAME_BOUNDARY_EPSILON ? nearest : position;
}
/** HyperFrames shows a clip on ticks n/fps within [start, end) after frame snapping. */
function visibleTicks(clip: Pick<Clip, 'start' | 'duration'>, fps: number) {
  const first = Math.ceil(snapToFrame(clip.start, fps) - 1e-9), end = Math.ceil(snapToFrame(clip.start + clip.duration, fps) - 1e-9);
  return { first, end: Math.max(first, end) };
}
/** HyperFrames' composition frame count (durationToFrameCount). */
function exportFrameCount(duration: number, fps: number) {
  const raw = duration * fps, nearest = Math.round(raw);
  return Math.max(1, Math.abs(raw - nearest) <= FRAME_BOUNDARY_EPSILON ? nearest : Math.ceil(raw));
}

function unsupportedKey(clip: Clip, allowed: Set<keyof Clip>) {
  return (Object.keys(clip) as (keyof Clip)[]).find(key => clip[key] !== undefined && !allowed.has(key));
}
function finite(...values: number[]) { return values.every(Number.isFinite); }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** What a video clip needs beyond one full-canvas footage layer; undefined when it is plain. */
type LayerLook = { transform: typeof DEFAULT_TRANSFORM; flip: { horizontal: boolean; vertical: boolean }; blur: number; exposure: number; layered: boolean };
function visualLook(clip: Clip, asset: MediaAsset | undefined): string | LayerLook {
  if (!asset || asset.kind !== 'video') return 'a video clip references unavailable or mismatched media';
  if (!(asset.width! > 0 && asset.height! > 0)) return 'a video source has no recorded dimensions';
  const transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  if (!finite(transform.x, transform.y, transform.scale) || !(transform.scale > 0)) return 'a clip has an invalid transform';
  if (!near(transform.rotation, 0)) return 'a clip is rotated';
  if (!near(transform.opacity, 1)) return 'a clip is transparent';
  if (clip.crop && (clip.crop.left || clip.crop.top || clip.crop.right || clip.crop.bottom)) return 'a clip is cropped';
  if (clip.blendMode !== undefined && clip.blendMode !== 'normal') return 'a clip uses a blend mode';
  if (clip.focus?.length) return 'a clip follows a tracked subject';
  if (clip.visualFade && (clip.visualFade.fadeIn || clip.visualFade.fadeOut)) return 'a clip has a visual fade';
  if (clip.fit !== undefined && clip.fit !== 'cover' && clip.fit !== 'contain') return 'a clip uses unknown framing';
  let blur = 0, exposure = 0;
  for (const key of VISUAL_EFFECT_KEYS) {
    const effect = clip[key] as { enabled?: unknown } | undefined;
    if (effect === undefined || effect?.enabled === false) continue;
    // The soft blur and an exposure-only grade are what mirror-blur copies use; both have exact FFmpeg equivalents.
    if (key === 'softBlur' && clip.softBlur) { if (!finite(clip.softBlur.amount) || clip.softBlur.amount < 0) return 'a clip has an invalid soft blur'; blur = clip.softBlur.amount; continue; }
    const grade = clip.colorGrade;
    if (key === 'colorGrade' && grade && near(grade.contrast, 1) && near(grade.saturation, 1) && near(grade.temperature, 0) && near(grade.tint, 0) && near(grade.vibrance, 0) && finite(grade.exposure)) { exposure = grade.exposure; continue; }
    return `a clip has the ${key} effect`;
  }
  const flip = { horizontal: !!clip.flip?.horizontal, vertical: !!clip.flip?.vertical };
  const moved = !near(transform.x, .5) || !near(transform.y, .5) || !near(transform.scale, 1);
  return { transform, flip, blur, exposure, layered: moved || flip.horizontal || flip.vertical || blur > 0 || exposure !== 0 };
}

/** Integer raster matching the browser's calculateVisualRect framing at the export canvas. */
function framing(asset: MediaAsset, width: number, height: number, fit: 'cover' | 'contain') {
  const rect = calculateVisualRect(asset.width!, asset.height!, width, height, undefined, undefined, fit);
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  if (fit === 'contain') {
    const scaleWidth = clamp(Math.round(rect.width), 1, width), scaleHeight = clamp(Math.round(rect.height), 1, height);
    return { scaleWidth, scaleHeight, x: clamp(Math.round(rect.left), 0, width - scaleWidth), y: clamp(Math.round(rect.top), 0, height - scaleHeight) };
  }
  const scaleWidth = Math.max(width, Math.round(rect.width)), scaleHeight = Math.max(height, Math.round(rect.height));
  return { scaleWidth, scaleHeight, x: clamp(Math.round(-rect.left), 0, scaleWidth - width), y: clamp(Math.round(-rect.top), 0, scaleHeight - height) };
}

/**
 * A layered clip's placement as the composition lays it out: the framed source inside its
 * canvas-clamped window, then the frame's translate and scale about the canvas centre.
 */
function layerPlacement(asset: MediaAsset, clip: Clip, look: LayerLook, width: number, height: number) {
  const rect = calculateVisualRect(asset.width!, asset.height!, width, height, undefined, undefined, clip.fit ?? 'cover');
  const { x: tx, y: ty, scale } = look.transform;
  const mapX = (value: number) => (tx - .5) * width + width / 2 + scale * (value - width / 2);
  const mapY = (value: number) => (ty - .5) * height + height / 2 + scale * (value - height / 2);
  const scaleWidth = Math.max(1, Math.round(rect.width * scale)), scaleHeight = Math.max(1, Math.round(rect.height * scale));
  const x = Math.round(mapX(rect.window.left)), y = Math.round(mapY(rect.window.top));
  const cropX = Math.min(scaleWidth - 1, Math.max(0, x - Math.round(mapX(rect.left)))), cropY = Math.min(scaleHeight - 1, Math.max(0, y - Math.round(mapY(rect.top))));
  const crop = { x: cropX, y: cropY, width: Math.max(1, Math.min(scaleWidth - cropX, Math.round(rect.window.width * scale))), height: Math.max(1, Math.min(scaleHeight - cropY, Math.round(rect.window.height * scale))) };
  return { scaleWidth, scaleHeight, crop, x, y };
}

function textReason(clip: Clip): string | undefined {
  const extra = unsupportedKey(clip, TEXT_KEYS);
  if (extra) return `a ${clip.kind} clip sets ${extra}`;
  if (clip.animation !== undefined && clip.animation !== 'none') return `a ${clip.kind} clip has an entrance animation`;
  if (clip.blendMode !== undefined && clip.blendMode !== 'normal') return `a ${clip.kind} clip uses a blend mode`;
  if (!clip.text?.trim()) return `a ${clip.kind} clip has no text`;
}

/** A clip's sound as the native producer mixes it: undefined when silent, a reason when its gain varies. */
function soundOf(timeline: Timeline, clip: Clip): PlainAudioTrack | undefined | string {
  const volume = Number.isFinite(clip.volume) ? Math.min(MAX_CLIP_VOLUME, Math.max(0, clip.volume!)) : 1;
  // Export omits silent sound entirely; composition writing also mutes video without an audio stream.
  if (volume === 0) return undefined;
  // HyperFrames bakes the clip's volume lane into its samples. Reproduce only a constant lane;
  // ducking and phase-retained fades vary the gain and keep the browser path.
  let points: { v: number }[];
  try { points = (JSON.parse(audioVolumeEnvelope(timeline, clip, volume)) as { lanes: { points: { v: number }[] }[] }).lanes[0].points; } catch { return 'a clip has an unsupported volume envelope'; }
  if (points.some(point => Math.abs(point.v - volume) > 1e-9)) return 'a clip has ducking or a retained fade envelope';
  const fades = audioFadeAttributes(clip);
  return { clipId: clip.id, assetId: clip.assetId!, kind: clip.kind as 'video' | 'audio', start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart, playbackRate: playbackRateOf(clip), volume, fadeIn: fades.fadeIn, fadeOut: fades.fadeOut };
}

export type PlainAudioPlan = Pick<PlainExportPlan, 'fps' | 'duration' | 'frames' | 'audio'>;
/**
 * The export's sound alone, for remuxing an unchanged picture: the same static-gain mix the
 * fast path encodes, whatever the visual layers are. A reason when the browser must mix it.
 */
export function plainAudioPlan(timeline: Timeline, assets: MediaAsset[], fps: number): { eligible: true; plan: PlainAudioPlan } | { eligible: false; reason: string } {
  timeline = resolvedAudioTimeline(timeline);
  const no = (reason: string) => ({ eligible: false as const, reason });
  if (fps !== 24 && fps !== 30 && fps !== 60) return no('unsupported export frame rate');
  try { validateAudioTimeline(timeline); } catch { return no('audio settings are invalid'); }
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  const audio: PlainAudioTrack[] = [];
  for (const clip of timeline.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
    if (!clip.assetId || assetMap.get(clip.assetId)?.kind !== clip.kind) return no(`a ${clip.kind} clip references unavailable or mismatched media`);
    if (!finite(clip.start, clip.duration, clip.sourceStart) || clip.start < 0 || clip.duration <= 0 || clip.sourceStart < 0) return no('a clip has invalid timing');
    try { validatePlaybackRate(clip); } catch { return no('a clip has an invalid playback speed'); }
    const sound = soundOf(timeline, clip);
    if (typeof sound === 'string') return no(sound);
    if (!sound) continue;
    if (clip.speedRamp?.length) return no('a sounding clip has a speed ramp');
    audio.push(sound);
  }
  if (audio.length > PLAIN_EXPORT_MAX_AUDIO_TRACKS) return no(`more than ${PLAIN_EXPORT_MAX_AUDIO_TRACKS} sounding clips`);
  const duration = Math.max(timelineDuration(timeline), 1 / fps);
  return { eligible: true, plan: { fps, duration, frames: exportFrameCount(duration, fps), audio } };
}

/**
 * Decide whether an export can skip browser compositing. Eligible when every clip is
 * video/audio the plan reproduces exactly (full-frame footage, or stacked clips moved,
 * scaled, flipped, soft-blurred or exposure-graded, as mirror blur builds) or static text
 * above all footage, with a static-gain audio mix; any field this plan does not explicitly
 * reproduce makes the timeline ineligible.
 */
export function plainExportPlan(timeline: Timeline, assets: MediaAsset[], resolution: ExportResolution, fps: number): PlainExportDecision {
  timeline=resolvedAudioTimeline(timeline);
  // A backgroundFill is drawn as the browser draws it: bands of the clip's own frames (flipped,
  // soft-blurred, darkened copies) stacked just beneath it, which the stack path below reproduces.
  timeline = expandBackgroundFills(timeline, assets);
  const clipIndex = new Map(timeline.clips.map((clip, index) => [clip.id, index]));
  const zOf = (clip: Clip, index: number) => {
    const owner = mirrorFillOwner(clip.id), ownerIndex = owner === undefined ? undefined : clipIndex.get(owner);
    return ownerIndex === undefined ? layerZIndex(clip, index) : layerZIndex(timeline.clips[ownerIndex], ownerIndex) - 1;
  };
  const no = (reason: string): PlainExportDecision => ({ eligible: false, reason });
  if (fps !== 24 && fps !== 30 && fps !== 60) return no('unsupported export frame rate');
  if (resolution !== 720 && resolution !== 1080 && resolution !== 2160) return no('unsupported export resolution');
  if (!timeline.clips.length) return no('the timeline is empty');
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  const { width, height } = dimensions(timeline.aspectRatio, resolution);
  try { validateAudioTimeline(timeline); } catch { return no('audio settings are invalid'); }
  const visuals: { clip: Clip; look: LayerLook; z: number; first: number; end: number }[] = [];
  const texts: { clip: Clip; z: number; first: number; end: number }[] = [];
  const audio: PlainAudioTrack[] = [];
  for (const [index, clip] of timeline.clips.entries()) {
    if (clip.kind === 'graphic' || clip.kind === 'caption') {
      const reason = textReason(clip);
      if (reason) return no(reason);
      if (!finite(clip.start, clip.duration) || clip.start < 0 || clip.duration <= 0) return no('a clip has invalid timing');
      const { first, end } = visibleTicks(clip, fps);
      if (end > first) texts.push({ clip, z: zOf(clip, index), first, end });
      continue;
    }
    if (clip.kind !== 'video' && clip.kind !== 'audio') return no(`the timeline contains a ${clip.kind} clip`);
    const extra = unsupportedKey(clip, clip.kind === 'video' ? VIDEO_KEYS : AUDIO_KEYS);
    if (extra) return no(`a ${clip.kind} clip sets ${extra}`);
    if (!finite(clip.start, clip.duration, clip.sourceStart) || clip.start < 0 || clip.duration <= 0 || clip.sourceStart < 0) return no('a clip has invalid timing');
    try { validatePlaybackRate(clip); } catch { return no('a clip has an invalid playback speed'); }
    if (clip.effectPreset !== undefined && clip.effectPreset !== 'none') return no('a clip uses an effect preset');
    if (clip.motion?.length) return no('a clip has motion keyframes');
    if (clip.effectKeyframes?.length) return no('a clip has keyframed effects');
    if (clip.speedRamp?.length) return no('a clip has a speed ramp');
    if (clip.mask) return no('a clip is masked');
    if (clip.audioReactive) return no('a clip reacts to audio');
    if (clip.colorCurves || clip.hsl || clip.lut || clip.bloom?.enabled) return no('a clip has color finishing');
    if (!clip.assetId) return no('a clip has no media');
    const asset = assetMap.get(clip.assetId);
    if (clip.kind === 'video') {
      const look = visualLook(clip, asset);
      if (typeof look === 'string') return no(look);
      const { first, end } = visibleTicks(clip, fps);
      if (end > first) visuals.push({ clip, look, z: zOf(clip, index), first, end });
    } else if (!asset || asset.kind !== 'audio') return no('an audio clip references unavailable or mismatched media');
    const sound = soundOf(timeline, clip);
    if (typeof sound === 'string') return no(sound);
    if (sound) audio.push(sound);
  }
  if (audio.length > PLAIN_EXPORT_MAX_AUDIO_TRACKS) return no(`more than ${PLAIN_EXPORT_MAX_AUDIO_TRACKS} sounding clips`);
  if (texts.length > PLAIN_EXPORT_MAX_TEXT_OVERLAYS) return no(`more than ${PLAIN_EXPORT_MAX_TEXT_OVERLAYS} text clips`);
  // Text is laid over the finished footage, so it must paint above every clip it overlaps.
  if (texts.some(text => visuals.some(visual => visual.first < text.end && text.first < visual.end && visual.z > text.z))) return no('a text clip sits beneath footage');
  const duration = Math.max(timelineDuration(timeline), 1 / fps);
  const frames = exportFrameCount(duration, fps);
  // Overlapping footage forms one stack; a lone full-frame clip keeps the exact single-layer chain.
  visuals.sort((a, b) => a.first - b.first || a.z - b.z);
  const groups: (typeof visuals)[] = [];
  let groupEnd = -Infinity;
  for (const visual of visuals) {
    if (visual.first >= Math.min(groupEnd, frames)) { if (visual.first >= frames) break; groups.push([]); groupEnd = -Infinity; }
    groups.at(-1)!.push(visual);
    groupEnd = Math.max(groupEnd, visual.end);
  }
  const sampling = (clip: Clip, first: number): PlainSampling => ({ assetId: clip.assetId!, sourceStart: clip.sourceStart, playbackRate: playbackRateOf(clip), sourceDuration: clip.duration * playbackRateOf(clip), phase: first - clip.start * fps || 0 });
  const video: PlainVideoSegment[] = [];
  let cursor = 0;
  for (const group of groups) {
    const first = group[0].first, end = Math.min(frames, Math.max(...group.map(visual => visual.end)));
    if (first > cursor) video.push({ kind: 'gap', frames: first - cursor });
    const [only] = group;
    if (group.length === 1 && !only.look.layered) {
      const fit = only.clip.fit ?? 'cover';
      video.push({ kind: 'clip', clipId: only.clip.id, frames: end - first, ...sampling(only.clip, first), fit, ...framing(assetMap.get(only.clip.assetId!)!, width, height, fit) });
    } else {
      const layers = group.sort((a, b) => a.z - b.z).map(({ clip, look, first: start, end: stop }): PlainLayer => ({
        clipId: clip.id, ...sampling(clip, start), offset: start - first, frames: Math.min(stop, end) - start,
        ...layerPlacement(assetMap.get(clip.assetId!)!, clip, look, width, height),
        flip: look.flip, exposure: look.exposure,
        // The editor's soft blur has a standard deviation of half its amount, in 1080p design pixels,
        // measured on the clip's own layout and then scaled with it.
        blur: look.blur > 0 ? look.blur / 2 * resolution / 1080 * look.transform.scale : 0,
      }));
      if (new Set(layers.map(layer => samplingKey(layer))).size > PLAIN_EXPORT_MAX_STACK_SOURCES) return no(`more than ${PLAIN_EXPORT_MAX_STACK_SOURCES} different clips are stacked at once`);
      video.push({ kind: 'stack', frames: end - first, layers });
    }
    cursor = end;
  }
  if (cursor < frames) video.push({ kind: 'gap', frames: frames - cursor });
  // Timing only places the raster; the rest of the clip (and the canvas) decides its pixels.
  const look = (clip: Clip) => canonical({ clip: Object.fromEntries(Object.entries(clip).filter(([key]) => !TEXT_PLACEMENT_KEYS.has(key as keyof Clip))), width, height });
  const text = texts.sort((a, b) => a.z - b.z).flatMap(({ clip, first, end }) => first < frames ? [{ clipId: clip.id, first, end: Math.min(end, frames), look: look(clip) }] : []);
  return { eligible: true, plan: { width, height, fps, duration, frames, video, text, audio } };
}

/** Layers showing the same source frames at the same output frames decode once and are split. */
export function samplingKey(layer: PlainLayer) {
  return JSON.stringify([layer.assetId, layer.sourceStart, layer.playbackRate, layer.sourceDuration, layer.phase, layer.offset, layer.frames]);
}
