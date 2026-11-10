import { resolvedAudioTimeline } from './audio-normalization';
import { canonical } from './export-reuse';
import { expandBackgroundFills, mirrorFillOwner } from './mirror-blur-layout';
import { layerZIndex, type ExportResolution } from './composition';
import { calculateVisualRect } from './visual-source-geometry';
import { validateVisualTransform } from './visual-inputs';
import { audioFadeAttributes, audioVolumeEnvelope, validateAudioTimeline } from './audio-settings';
import { MAX_CLIP_VOLUME } from './clip-volume';
import { playbackRateOf, validatePlaybackRate } from './playback-rate';
import { VISUAL_EFFECT_KEYS } from './visual-effects';
import { validateVisualFade, visualFadeClock, visualFadeGain } from './visual-fades';
import { isTransitionClip, transitionSources } from './clip-transitions';
import { textLayerFrame } from './text-layers';
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
 * The visual fade clock of a clip (visualFadeGain): the clip's local time t = (phase + frame) / fps,
 * held at `cap` on its last frame, is offset into a clock of `duration` seconds whose edges fade
 * over `fadeIn` and `fadeOut` seconds. Linear ramps, multiplied where they overlap.
 */
export type PlainFade = { fadeIn: number; fadeOut: number; duration: number; offset: number; cap: number };
/**
 * One clip in a stack, painted in order over black. The source is scaled to scaleWidth x scaleHeight
 * (framing times transform scale), cut to its visible window (crop), flipped inside that window,
 * blurred and darkened like the editor's effect canvas, turned by quarter turns about the frame
 * centre, faded, and placed at x/y (may be off-canvas; x/y and the crop size describe the turned raster).
 */
export type PlainLayer = PlainSampling & {
  clipId: string;
  /** Frames from the stack start to the clip's first visible frame, and how many frames it shows. */
  offset: number; frames: number;
  scaleWidth: number; scaleHeight: number;
  crop: { x: number; y: number; width: number; height: number };
  x: number; y: number;
  flip: { horizontal: boolean; vertical: boolean };
  /** Clockwise quarter turns of the frame, applied after the flip. */
  rotate?: 90 | 180 | 270;
  /** Gaussian sigma in output pixels of the soft blur, 0 for none. */
  blur: number;
  /** Exposure in stops (the grade multiplies RGB by 2^exposure), 0 for none. */
  exposure: number;
  /** Opacity ramp of the layer, composited with alpha over the layers beneath. */
  fade?: PlainFade;
};
/**
 * A crossfade between two layers of a stack: layers before `from` are painted first, then `from`
 * and `to` are each painted over a copy of that base and the two pictures mixed linearly from the
 * first to the second over `duration` seconds, starting `phase` frames before the stack's first
 * frame; the layers after `to` are painted over the mix.
 */
export type PlainTransition = { from: number; to: number; duration: number; phase: number };
/** One output frame range of the single visible footage layer, a stack of layered clips, or black between them. */
export type PlainVideoSegment =
  | { kind: 'gap'; frames: number }
  | (PlainSampling & {
    kind: 'clip'; clipId: string; frames: number;
    fit: 'cover' | 'contain';
    /** Integer source raster and its placement on the canvas: crop offset for cover, pad offset for contain. */
    scaleWidth: number; scaleHeight: number; x: number; y: number;
    /** Opacity ramp toward the black canvas. */
    fade?: PlainFade;
  })
  | { kind: 'stack'; frames: number; layers: PlainLayer[]; transition?: PlainTransition };
/**
 * A static text or image clip, rasterized once by the browser renderer and laid over the footage
 * on these frames. An image overlay also names its asset, whose file identity joins the cache key.
 * `alpha` is the raster's opacity on each of its frames when it fades; omitted when it is always opaque.
 */
export type PlainOverlay = { clipId: string; kind: 'text' | 'image'; assetId?: string; first: number; end: number;
  /** Everything in the clip that sets its pixels, for caching its raster and the segments under it. */
  look: string; alpha?: number[] };
export type PlainAudioTrack = { clipId: string; assetId: string; kind: 'video' | 'audio'; start: number; duration: number; sourceStart: number; playbackRate: number; volume: number; fadeIn: number; fadeOut: number };
export type PlainExportPlan = { width: number; height: number; fps: 24 | 30 | 60; duration: number; frames: number; video: PlainVideoSegment[]; overlays: PlainOverlay[]; audio: PlainAudioTrack[] };
export type PlainExportDecision = { eligible: true; plan: PlainExportPlan } | { eligible: false; reason: string };

/** The encoder opens every sounding clip at once (footage is chunked). Larger mixes keep the browser path. */
const PLAIN_EXPORT_MAX_AUDIO_TRACKS = 64;
/** Each static text or image is captured in one bounded browser session; more keep the browser path. */
export const PLAIN_EXPORT_MAX_OVERLAYS = 12;
/** Distinct decoded sources one stack may open at once (a producer holds them all). */
export const PLAIN_EXPORT_MAX_STACK_SOURCES = 8;
/**
 * Footage segments longer than this are cut into equal pieces of at most this length, so a long
 * shot encodes on several cores. The grid depends only on the segment, never on the host, so
 * cached pieces match across workers; each piece pays a seek, a keyframe pre-roll and an encoder warm-up.
 */
export const PLAIN_EXPORT_MAX_PIECE_SECONDS = 6;
// HyperFrames snaps clip edges within 1/1000 frame to the frame grid (parityContract FRAME_BOUNDARY_EPSILON).
const FRAME_BOUNDARY_EPSILON = 1e-3;
const SHARED_KEYS = new Set<keyof Clip>(['id', 'kind', 'assetId', 'track', 'start', 'duration', 'sourceStart', 'playbackRate', 'volume', 'linkedClipId', 'audioSeparated', 'effectPreset', 'motion', 'motionOffset', 'approval', 'approvedSections']);
const VIDEO_KEYS = new Set<keyof Clip>([...SHARED_KEYS, 'fit', 'transform', 'crop', 'blendMode', 'focus', 'framingCuts', 'visualFade', 'visualFadeTiming', 'flip', 'backgroundFill', ...VISUAL_EFFECT_KEYS]);
const AUDIO_KEYS = new Set<keyof Clip>([...SHARED_KEYS, 'audio', 'audioFadeTiming']);
// Everything the browser text layer reads for a clip without a template, gradient or motion.
const TEXT_KEYS = new Set<keyof Clip>(['id', 'kind', 'track', 'start', 'duration', 'sourceStart', 'playbackRate', 'volume', 'text', 'fontSize', 'color', 'background', 'x', 'y', 'textStyle', 'fontFamily', 'transform', 'blendMode', 'animation', 'textAnimationTiming', 'approval', 'approvedSections']);

// A still image the browser draws without motion or effects: framing, transform, crop, flip and a visual fade.
const IMAGE_KEYS = new Set<keyof Clip>(['id', 'kind', 'assetId', 'track', 'start', 'duration', 'sourceStart', 'playbackRate', 'volume', 'linkedClipId', 'audioSeparated', 'effectPreset', 'motion', 'motionOffset', 'approval', 'approvedSections', 'fit', 'transform', 'crop', 'flip', 'blendMode', 'visualFade', 'visualFadeTiming']);
/** Still formats only: GIF, WebP and APNG can animate. */
const STILL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

// Timing and fades place and ramp the raster; they do not change its pixels.
const TEXT_PLACEMENT_KEYS = new Set<keyof Clip>(['id', 'start', 'duration', 'track', 'sourceStart', 'playbackRate', 'volume', 'approval', 'approvedSections', 'animation', 'textAnimationTiming', 'visualFade', 'visualFadeTiming']);

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
const hasFade = (clip: Clip) => !!clip.visualFade && (clip.visualFade.fadeIn > 0 || clip.visualFade.fadeOut > 0);
/** The visual fade clock of a clip, as installVisualFades samples it: local time held on the clip's last project frame. */
function fadeOf(clip: Clip, projectFps: number): PlainFade | undefined {
  if (!hasFade(clip)) return undefined;
  const clock = visualFadeClock(clip);
  return { ...clock, cap: Math.max(0, clip.duration - 1 / projectFps) };
}
/** Normalize a transform rotation to a quarter turn; undefined for anything else. */
function quarterTurn(rotation: number): 0 | 90 | 180 | 270 | undefined {
  const turn = ((rotation % 360) + 360) % 360;
  for (const quarter of [0, 90, 180, 270] as const) if (near(turn, quarter) || near(turn, quarter + 360)) return quarter;
}

/** What a video clip needs beyond one full-canvas footage layer; undefined when it is plain. */
type LayerLook = { transform: typeof DEFAULT_TRANSFORM; flip: { horizontal: boolean; vertical: boolean }; rotate: 0 | 90 | 180 | 270; blur: number; exposure: number; fade?: PlainFade; layered: boolean };
function visualLook(clip: Clip, asset: MediaAsset | undefined, projectFps: number): string | LayerLook {
  if (!asset || asset.kind !== 'video') return 'a video clip references unavailable or mismatched media';
  if (!(asset.width! > 0 && asset.height! > 0)) return 'a video source has no recorded dimensions';
  const transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  if (!finite(transform.x, transform.y, transform.scale, transform.rotation) || !(transform.scale > 0)) return 'a clip has an invalid transform';
  const rotate = quarterTurn(transform.rotation);
  if (rotate === undefined) return 'a clip is rotated by less than a quarter turn';
  if (!near(transform.opacity, 1)) return 'a clip is transparent';
  const crop = clip.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  if (!finite(crop.left, crop.top, crop.right, crop.bottom) || [crop.left, crop.top, crop.right, crop.bottom].some(edge => edge < 0 || edge > .95) || crop.left + crop.right >= .95 || crop.top + crop.bottom >= .95) return 'a clip has an invalid crop';
  const cropped = !!(crop.left || crop.top || crop.right || crop.bottom);
  if (clip.blendMode !== undefined && clip.blendMode !== 'normal') return 'a clip uses a blend mode';
  if (clip.focus?.length) return 'a clip follows a tracked subject';
  try { validateVisualFade(clip); } catch { return 'a clip has an invalid visual fade'; }
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
  return { transform, flip, rotate, blur, exposure, fade: fadeOf(clip, projectFps), layered: moved || flip.horizontal || flip.vertical || blur > 0 || exposure !== 0 || cropped || rotate !== 0 };
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
 * canvas-clamped crop window, then the frame's translate, scale and quarter turn about the frame centre.
 */
function layerPlacement(asset: MediaAsset, clip: Clip, look: LayerLook, width: number, height: number) {
  const rect = calculateVisualRect(asset.width!, asset.height!, width, height, clip.crop, undefined, clip.fit ?? 'cover');
  const { x: tx, y: ty, scale } = look.transform;
  const mapX = (value: number) => (tx - .5) * width + width / 2 + scale * (value - width / 2);
  const mapY = (value: number) => (ty - .5) * height + height / 2 + scale * (value - height / 2);
  const scaleWidth = Math.max(1, Math.round(rect.width * scale)), scaleHeight = Math.max(1, Math.round(rect.height * scale));
  let x = Math.round(mapX(rect.window.left)), y = Math.round(mapY(rect.window.top));
  const cropX = Math.min(scaleWidth - 1, Math.max(0, x - Math.round(mapX(rect.left)))), cropY = Math.min(scaleHeight - 1, Math.max(0, y - Math.round(mapY(rect.top))));
  const crop = { x: cropX, y: cropY, width: Math.max(1, Math.min(scaleWidth - cropX, Math.round(rect.window.width * scale))), height: Math.max(1, Math.min(scaleHeight - cropY, Math.round(rect.window.height * scale))) };
  if (look.rotate) {
    // CSS rotate() turns the placed window about the frame centre (the canvas centre after the translate).
    const centreX = mapX(width / 2), centreY = mapY(height / 2), left = mapX(rect.window.left), top = mapY(rect.window.top);
    const right = left + rect.window.width * scale, bottom = top + rect.window.height * scale;
    const turned = look.rotate === 90 ? { x: centreX - (bottom - centreY), y: centreY + (left - centreX) }
      : look.rotate === 180 ? { x: centreX - (right - centreX), y: centreY - (bottom - centreY) }
        : { x: centreX + (top - centreY), y: centreY - (right - centreX) };
    x = Math.round(turned.x); y = Math.round(turned.y);
  }
  return { scaleWidth, scaleHeight, crop, x, y, ...look.rotate ? { rotate: look.rotate } : {} };
}

function textReason(clip: Clip): string | undefined {
  const extra = unsupportedKey(clip, TEXT_KEYS);
  if (extra) return `a ${clip.kind} clip sets ${extra}`;
  if (clip.animation !== undefined && clip.animation !== 'none' && clip.animation !== 'fade') return `a ${clip.kind} clip has a ${clip.animation} entrance animation`;
  if (clip.textAnimationTiming && (!finite(clip.textAnimationTiming.duration, clip.textAnimationTiming.offset) || clip.textAnimationTiming.duration <= 0)) return `a ${clip.kind} clip has invalid animation timing`;
  if (clip.blendMode !== undefined && clip.blendMode !== 'normal') return `a ${clip.kind} clip uses a blend mode`;
  if (!clip.text?.trim()) return `a ${clip.kind} clip has no text`;
}

/** Why a still image clip cannot be laid over the footage as one raster; undefined when it can. */
function imageReason(clip: Clip, asset: MediaAsset | undefined): string | undefined {
  const extra = unsupportedKey(clip, IMAGE_KEYS);
  if (extra) return `an image clip sets ${extra}`;
  if (!asset || asset.kind !== 'image') return 'an image clip references unavailable or mismatched media';
  // Export snapshots carry the stored content type; the editor's asset type does not declare it.
  const type = ((asset as MediaAsset & { contentType?: string }).contentType ?? '').toLowerCase();
  if (!STILL_IMAGE_TYPES.has(type)) return `an image clip uses ${type || 'an unknown format'}, which may animate`;
  if (!(asset.width! > 0 && asset.height! > 0)) return 'an image has no recorded dimensions';
  if (clip.motion?.length) return 'an image clip has motion keyframes';
  if (clip.effectPreset !== undefined && clip.effectPreset !== 'none') return 'an image clip uses an effect preset';
  if (clip.blendMode !== undefined && clip.blendMode !== 'normal') return 'an image clip uses a blend mode';
  try { validateVisualFade(clip); } catch { return 'an image clip has an invalid visual fade'; }
  try { validateVisualTransform({ ...DEFAULT_TRANSFORM, ...clip.transform }); } catch { return 'an image clip has an invalid transform'; }
}

/** The raster's opacity on each visible frame, as the browser animates it; undefined when always opaque. */
function overlayAlpha(clip: Clip, kind: 'text' | 'image', first: number, end: number, fps: number, projectFps: number, width: number, height: number, resolution: number): number[] | undefined {
  if (kind === 'text' ? clip.animation !== 'fade' : !hasFade(clip)) return undefined;
  // Where the ramps are, in the clip's local time: the text entrance and exit (textLayerFrame) or the
  // fade clock's edges; frames in between are opaque without sampling the text layer.
  const ramps: [number, number][] = [];
  if (kind === 'text') {
    const offset = clip.textAnimationTiming?.offset ?? 0, animationDuration = clip.textAnimationTiming?.duration ?? clip.duration, ramp = Math.min(.3, animationDuration / 3);
    ramps.push([-offset, ramp - offset], [animationDuration - ramp - offset, animationDuration - offset]);
  } else {
    const clock = visualFadeClock(clip);
    ramps.push([-clock.offset, clock.fadeIn - clock.offset], [clock.duration - clock.fadeOut - clock.offset, clock.duration - clock.offset]);
  }
  const alpha: number[] = [];
  for (let frame = first; frame < end; frame++) {
    const time = frame / fps, local = time - clip.start;
    // installVisualFades holds the opacity of the last project frame; the text layer samples the tick directly.
    const held = Math.max(0, Math.min(Math.max(0, clip.duration - 1 / projectFps), local));
    const inRamp = ramps.some(([from, to]) => (kind === 'text' ? local : held) <= to + 1 / fps && (kind === 'text' ? local : held) >= from - 1 / fps);
    const gain = !inRamp ? 1 : kind === 'text' ? textLayerFrame({ clip, index: 0, fps, resolution }, time, width, height).opacity : visualFadeGain(clip, held);
    alpha.push(Math.round(Math.max(0, Math.min(1, gain)) * 1e4) / 1e4);
  }
  return alpha.every(value => value === 1) ? undefined : alpha;
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

type Visual = { clip: Clip; look: LayerLook; z: number; first: number; end: number };
/** A crossfade's frames on the output grid and the layers it mixes. */
type Crossfade = { from: Clip; to: Clip; first: number; end: number; duration: number; phase: number;
  /** The cut's frame, and the extracted frame of the outgoing clip held from the cut on. */
  cut: number; hold: number };

/**
 * Decide whether an export can skip browser compositing. Eligible when every clip is
 * video/audio the plan reproduces exactly (full-frame footage, or stacked clips moved,
 * scaled, flipped, cropped, turned by quarter turns, soft-blurred, exposure-graded or faded, as mirror
 * blur builds), crossfade transitions between neighbouring video clips, or static text (with at most a
 * basic fade entrance) and still PNG/JPEG images above all footage, with a static-gain audio mix; any field
 * this plan does not explicitly reproduce makes the timeline ineligible.
 */
export function plainExportPlan(timeline: Timeline, assets: MediaAsset[], resolution: ExportResolution, fps: number): PlainExportDecision {
  timeline=resolvedAudioTimeline(timeline);
  const no = (reason: string): PlainExportDecision => ({ eligible: false, reason });
  // Transitions are validated on the saved clips, as the composition validates them, before the
  // render-only mirror bands join the clip list.
  let transitions: ReturnType<typeof transitionSources>;
  try { transitions = transitionSources(timeline.clips, timeline.fps); } catch (error) { return no(error instanceof Error ? error.message : 'a transition is invalid'); }
  // A backgroundFill is drawn as the browser draws it: bands of the clip's own frames (flipped,
  // soft-blurred, darkened copies) stacked just beneath it, which the stack path below reproduces.
  timeline = expandBackgroundFills(timeline, assets);
  const clipIndex = new Map(timeline.clips.map((clip, index) => [clip.id, index]));
  const zOf = (clip: Clip, index: number) => {
    const owner = mirrorFillOwner(clip.id), ownerIndex = owner === undefined ? undefined : clipIndex.get(owner);
    return ownerIndex === undefined ? layerZIndex(clip, index) : layerZIndex(timeline.clips[ownerIndex], ownerIndex) - 1;
  };
  if (fps !== 24 && fps !== 30 && fps !== 60) return no('unsupported export frame rate');
  if (resolution !== 720 && resolution !== 1080 && resolution !== 2160) return no('unsupported export resolution');
  if (!timeline.clips.length) return no('the timeline is empty');
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  const { width, height } = dimensions(timeline.aspectRatio, resolution);
  try { validateAudioTimeline(timeline); } catch { return no('audio settings are invalid'); }
  const projectFps = timeline.fps > 0 && Number.isFinite(timeline.fps) ? timeline.fps : fps;
  const visuals: Visual[] = [];
  const overlays: { clip: Clip; kind: 'text' | 'image'; z: number; first: number; end: number }[] = [];
  const audio: PlainAudioTrack[] = [];
  for (const [index, clip] of timeline.clips.entries()) {
    if (clip.kind === 'graphic' || clip.kind === 'caption') {
      const reason = textReason(clip);
      if (reason) return no(reason);
      if (!finite(clip.start, clip.duration) || clip.start < 0 || clip.duration <= 0) return no('a clip has invalid timing');
      const { first, end } = visibleTicks(clip, fps);
      if (end > first) overlays.push({ clip, kind: 'text', z: zOf(clip, index), first, end });
      continue;
    }
    if (clip.kind === 'image') {
      const reason = imageReason(clip, clip.assetId ? assetMap.get(clip.assetId) : undefined);
      if (reason) return no(reason);
      if (!finite(clip.start, clip.duration) || clip.start < 0 || clip.duration <= 0) return no('a clip has invalid timing');
      const { first, end } = visibleTicks(clip, fps);
      if (end > first) overlays.push({ clip, kind: 'image', z: zOf(clip, index), first, end });
      continue;
    }
    // Transition FX clips are drawn by the stacks below; every other effect keeps the browser path.
    if (clip.kind === 'effect' && isTransitionClip(clip)) continue;
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
      const look = visualLook(clip, asset, projectFps);
      if (typeof look === 'string') return no(look);
      const { first, end } = visibleTicks(clip, fps);
      if (end > first) visuals.push({ clip, look, z: zOf(clip, index), first, end });
    } else if (!asset || asset.kind !== 'audio') return no('an audio clip references unavailable or mismatched media');
    const sound = soundOf(timeline, clip);
    if (typeof sound === 'string') return no(sound);
    if (sound) audio.push(sound);
  }
  if (audio.length > PLAIN_EXPORT_MAX_AUDIO_TRACKS) return no(`more than ${PLAIN_EXPORT_MAX_AUDIO_TRACKS} sounding clips`);
  if (overlays.length > PLAIN_EXPORT_MAX_OVERLAYS) return no(`more than ${PLAIN_EXPORT_MAX_OVERLAYS} text and image clips`);
  const duration = Math.max(timelineDuration(timeline), 1 / fps);
  const frames = exportFrameCount(duration, fps);
  // A crossfade holds the outgoing clip's last frame and the incoming clip's first frame across its
  // band (transitionSampleTime), so both clips' windows grow to cover it. From the cut on, the browser
  // seeks the outgoing clip to source time (duration - 1/project fps): an extracted frame only when the
  // export frame rate is a multiple of the project's and the clip's duration is whole frames at speed 1.
  const crossfades: Crossfade[] = [];
  for (const { clip, from, to } of transitions) {
    if (clip.effectPreset !== 'crossfade') return no(`a ${clip.effectPreset} transition`);
    if (fps % projectFps !== 0) return no('a transition is exported at a frame rate that is not a multiple of the project frame rate');
    const outgoing = visuals.find(visual => visual.clip.id === from.id), incoming = visuals.find(visual => visual.clip.id === to.id);
    if (!outgoing || !incoming) return no('a transition joins an image clip');
    if (!near(playbackRateOf(from), 1)) return no('a transition clip has a changed playback speed');
    if (Math.abs(from.duration * fps - Math.round(from.duration * fps)) > FRAME_BOUNDARY_EPSILON) return no('a transition cut is off the frame grid');
    const { first, end } = visibleTicks(clip, fps);
    if (end <= first) continue;
    const cut = visibleTicks(from, fps).end;
    crossfades.push({ from, to, first, end, duration: clip.duration, phase: first - snapToFrame(clip.start, fps), cut, hold: Math.max(0, Math.round(from.duration * fps) - fps / projectFps) });
    outgoing.end = Math.max(outgoing.end, end);
    incoming.first = Math.min(incoming.first, first);
  }
  // Overlays are laid over the finished footage, so each must paint above every clip it overlaps.
  const beneath = overlays.find(overlay => visuals.some(visual => visual.first < overlay.end && overlay.first < visual.end && visual.z > overlay.z));
  if (beneath) return no(`a${beneath.kind === 'image' ? 'n image' : ' text'} clip sits beneath footage`);
  // Overlapping footage forms one stack; a lone full-frame clip keeps the exact single-layer chain.
  visuals.sort((a, b) => a.first - b.first || a.z - b.z);
  const groups: Visual[][] = [];
  let groupEnd = -Infinity;
  for (const visual of visuals) {
    if (visual.first >= Math.min(groupEnd, frames)) { if (visual.first >= frames) break; groups.push([]); groupEnd = -Infinity; }
    groups.at(-1)!.push(visual);
    groupEnd = Math.max(groupEnd, visual.end);
  }
  const sampling = (clip: Clip, first: number): PlainSampling => ({ assetId: clip.assetId!, sourceStart: clip.sourceStart, playbackRate: playbackRateOf(clip), sourceDuration: clip.duration * playbackRateOf(clip), phase: first - clip.start * fps || 0 });
  const layerOf = ({ clip, look, first: start, end: stop }: Visual, from: number, to: number): PlainLayer => ({
    clipId: clip.id, ...sampling(clip, Math.max(start, from)), offset: Math.max(start, from) - from, frames: Math.min(stop, to) - Math.max(start, from),
    ...layerPlacement(assetMap.get(clip.assetId!)!, clip, look, width, height),
    flip: look.flip, exposure: look.exposure,
    // The editor's soft blur has a standard deviation of half its amount, in 1080p design pixels,
    // measured on the clip's own layout and then scaled with it.
    blur: look.blur > 0 ? look.blur / 2 * resolution / 1080 * look.transform.scale : 0,
    ...look.fade ? { fade: look.fade } : {},
  });
  const video: PlainVideoSegment[] = [];
  let cursor = 0;
  for (const group of groups) {
    const groupFirst = group[0].first, groupLast = Math.min(frames, Math.max(...group.map(visual => visual.end)));
    if (groupFirst > cursor) video.push({ kind: 'gap', frames: groupFirst - cursor });
    // A segment per range between layer edges and crossfade edges, so a cut or a dissolve never
    // joins its neighbours' frames into one encode.
    const edges = new Set<number>([groupFirst, groupLast]);
    for (const visual of group) for (const edge of [visual.first, visual.end]) if (edge > groupFirst && edge < groupLast) edges.add(edge);
    for (const crossfade of crossfades) for (const edge of [crossfade.first, crossfade.cut, crossfade.end]) if (edge > groupFirst && edge < groupLast) edges.add(edge);
    const cuts = [...edges].sort((a, b) => a - b);
    for (let index = 1; index < cuts.length; index++) {
      const from = cuts[index - 1], to = cuts[index];
      const members = group.filter(visual => visual.first < to && visual.end > from);
      const crossfade = crossfades.find(item => item.first <= from && item.end >= to && members.some(visual => visual.clip.id === item.from.id) && members.some(visual => visual.clip.id === item.to.id));
      const [only] = members;
      if (members.length === 1 && !only.look.layered && !crossfade) {
        const fit = only.clip.fit ?? 'cover';
        video.push({ kind: 'clip', clipId: only.clip.id, frames: to - from, ...sampling(only.clip, from), fit, ...framing(assetMap.get(only.clip.assetId!)!, width, height, fit), ...only.look.fade ? { fade: only.look.fade } : {} });
        continue;
      }
      members.sort((a, b) => a.z - b.z);
      let transition: PlainTransition | undefined;
      if (crossfade) {
        // The browser lifts both shots into one group at the higher of their z-indices; everything
        // beneath that is the base both are drawn over, everything above paints over the mix.
        const outgoing = members.find(visual => visual.clip.id === crossfade.from.id)!, incoming = members.find(visual => visual.clip.id === crossfade.to.id)!;
        const top = Math.max(outgoing.z, incoming.z), rest = members.filter(visual => visual !== outgoing && visual !== incoming);
        const below = rest.filter(visual => visual.z < top), above = rest.filter(visual => visual.z > top);
        members.splice(0, members.length, ...below, outgoing, incoming, ...above);
        transition = { from: below.length, to: below.length + 1, duration: crossfade.duration, phase: crossfade.phase + (from - crossfade.first) };
      }
      const layers = members.map(visual => {
        const layer = layerOf(visual, from, to);
        // Past its cut the outgoing shot shows one held frame: the one the browser seeks, not the extraction's last.
        if (crossfade && visual.clip.id === crossfade.from.id && from >= crossfade.cut) return { ...layer, phase: crossfade.hold, sourceDuration: (crossfade.hold + 1) / fps };
        return layer;
      });
      if (new Set(layers.map(layer => samplingKey(layer))).size > PLAIN_EXPORT_MAX_STACK_SOURCES) return no(`more than ${PLAIN_EXPORT_MAX_STACK_SOURCES} different clips are stacked at once`);
      video.push({ kind: 'stack', frames: to - from, layers, ...transition ? { transition } : {} });
    }
    cursor = groupLast;
  }
  if (cursor < frames) video.push({ kind: 'gap', frames: frames - cursor });
  // Timing only places the raster; the rest of the clip (and the canvas) decides its pixels.
  const look = (clip: Clip) => canonical({ clip: Object.fromEntries(Object.entries(clip).filter(([key]) => !TEXT_PLACEMENT_KEYS.has(key as keyof Clip))), width, height });
  const placed = overlays.sort((a, b) => a.z - b.z).flatMap(({ clip, kind, first, end }): PlainOverlay[] => {
    if (first >= frames) return [];
    const alpha = overlayAlpha(clip, kind, first, Math.min(end, frames), fps, projectFps, width, height, resolution);
    return [{ clipId: clip.id, kind, ...kind === 'image' ? { assetId: clip.assetId! } : {}, first, end: Math.min(end, frames), look: look(clip), ...alpha ? { alpha } : {} }];
  });
  return { eligible: true, plan: { width, height, fps, duration, frames, video: splitLongSegments(video, fps), overlays: placed, audio } };
}

/** Layers showing the same source frames at the same output frames decode once and are split. */
export function samplingKey(layer: PlainLayer) {
  return JSON.stringify([layer.assetId, layer.sourceStart, layer.playbackRate, layer.sourceDuration, layer.phase, layer.offset, layer.frames]);
}

/**
 * Cut footage segments longer than PLAIN_EXPORT_MAX_PIECE_SECONDS into equal pieces so they encode
 * on several cores at once. A piece shows the same frames as its part of the whole: its sampling phase
 * advances by the frames before it, so the frame, hold and fade maths are unchanged. Crossfade stacks stay whole.
 */
export function splitLongSegments(video: PlainVideoSegment[], fps: number): PlainVideoSegment[] {
  const maximum = Math.round(PLAIN_EXPORT_MAX_PIECE_SECONDS * fps);
  return video.flatMap(segment => {
    if (segment.kind === 'gap' || (segment.kind === 'stack' && segment.transition) || segment.frames <= maximum) return [segment];
    const pieces = Math.ceil(segment.frames / maximum), result: PlainVideoSegment[] = [];
    let rest = segment;
    for (let piece = 1; piece < pieces; piece++) {
      const [left, right] = splitSegment(rest, Math.round(segment.frames * piece / pieces) - (segment.frames - rest.frames));
      result.push(left); rest = right;
    }
    return [...result, rest];
  });
}

function splitSegment<T extends PlainVideoSegment>(segment: T, cut: number): [T, T] {
  if (segment.kind === 'gap') return [{ ...segment, frames: cut }, { ...segment, frames: segment.frames - cut }];
  if (segment.kind === 'clip') return [{ ...segment, frames: cut }, { ...segment, phase: segment.phase + cut, frames: segment.frames - cut }];
  const left: PlainLayer[] = [], right: PlainLayer[] = [];
  for (const layer of segment.layers) {
    const start = layer.offset, stop = layer.offset + layer.frames;
    if (start < cut) left.push({ ...layer, frames: Math.min(stop, cut) - start });
    if (stop > cut) right.push({ ...layer, offset: Math.max(start, cut) - cut, phase: layer.phase + Math.max(0, cut - start), frames: stop - Math.max(start, cut) });
  }
  return [{ ...segment, frames: cut, layers: left }, { ...segment, frames: segment.frames - cut, layers: right }];
}
