import type { ExportResolution } from './composition';
import { calculateVisualRect } from './visual-source-geometry';
import { audioFadeAttributes, audioVolumeEnvelope, validateAudioTimeline } from './audio-settings';
import { MAX_CLIP_VOLUME } from './clip-volume';
import { playbackRateOf, validatePlaybackRate } from './playback-rate';
import { VISUAL_EFFECT_KEYS } from './visual-effects';
import { DEFAULT_TRANSFORM, dimensions, timelineDuration, type Clip, type MediaAsset, type Timeline } from './types';

/** One output frame range of the single visible footage layer, or black between clips. */
export type PlainVideoSegment =
  | { kind: 'gap'; frames: number }
  | {
    kind: 'clip'; clipId: string; assetId: string; frames: number;
    sourceStart: number; playbackRate: number;
    /** Source seconds HyperFrames extracts for the clip (its duration times speed). */
    sourceDuration: number;
    /** First output tick minus clip start, in frames; HyperFrames samples relative to the unsnapped start. */
    phase: number;
    fit: 'cover' | 'contain';
    /** Integer source raster and its placement on the canvas: crop offset for cover, pad offset for contain. */
    scaleWidth: number; scaleHeight: number; x: number; y: number;
  };
export type PlainAudioTrack = { clipId: string; assetId: string; kind: 'video' | 'audio'; start: number; duration: number; sourceStart: number; playbackRate: number; volume: number; fadeIn: number; fadeOut: number };
export type PlainExportPlan = { width: number; height: number; fps: 24 | 30 | 60; duration: number; frames: number; video: PlainVideoSegment[]; audio: PlainAudioTrack[] };
export type PlainExportDecision = { eligible: true; plan: PlainExportPlan } | { eligible: false; reason: string };

/** The encoder opens every sounding clip at once (footage is chunked). Larger mixes keep the browser path. */
export const PLAIN_EXPORT_MAX_AUDIO_TRACKS = 64;
// HyperFrames snaps clip edges within 1/1000 frame to the frame grid (parityContract FRAME_BOUNDARY_EPSILON).
const FRAME_BOUNDARY_EPSILON = 1e-3;
const SHARED_KEYS = new Set<keyof Clip>(['id', 'kind', 'assetId', 'track', 'start', 'duration', 'sourceStart', 'playbackRate', 'volume', 'linkedClipId', 'audioSeparated', 'effectPreset', 'motion', 'motionOffset']);
const VIDEO_KEYS = new Set<keyof Clip>([...SHARED_KEYS, 'fit', 'transform', 'crop', 'blendMode', 'focus', 'visualFade', ...VISUAL_EFFECT_KEYS]);
const AUDIO_KEYS = new Set<keyof Clip>([...SHARED_KEYS, 'audio', 'audioFadeTiming']);

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
export function exportFrameCount(duration: number, fps: number) {
  const raw = duration * fps, nearest = Math.round(raw);
  return Math.max(1, Math.abs(raw - nearest) <= FRAME_BOUNDARY_EPSILON ? nearest : Math.ceil(raw));
}

function unsupportedKey(clip: Clip, allowed: Set<keyof Clip>) {
  return (Object.keys(clip) as (keyof Clip)[]).find(key => clip[key] !== undefined && !allowed.has(key));
}
function finite(...values: number[]) { return values.every(Number.isFinite); }

function visualReason(clip: Clip, asset: MediaAsset | undefined): string | undefined {
  if (!asset || asset.kind !== 'video') return 'a video clip references unavailable or mismatched media';
  if (!(asset.width! > 0 && asset.height! > 0)) return 'a video source has no recorded dimensions';
  const transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  if ((Object.keys(DEFAULT_TRANSFORM) as (keyof typeof DEFAULT_TRANSFORM)[]).some(key => transform[key] !== DEFAULT_TRANSFORM[key])) return 'a clip is moved, scaled, rotated or transparent';
  if (clip.crop && (clip.crop.left || clip.crop.top || clip.crop.right || clip.crop.bottom)) return 'a clip is cropped';
  if (clip.blendMode !== undefined && clip.blendMode !== 'normal') return 'a clip uses a blend mode';
  if (clip.focus?.length) return 'a clip follows a tracked subject';
  if (clip.visualFade && (clip.visualFade.fadeIn || clip.visualFade.fadeOut)) return 'a clip has a visual fade';
  if (clip.fit !== undefined && clip.fit !== 'cover' && clip.fit !== 'contain') return 'a clip uses unknown framing';
  for (const key of VISUAL_EFFECT_KEYS) {
    const effect = clip[key] as { enabled?: unknown } | undefined;
    if (effect !== undefined && effect?.enabled !== false) return `a clip has the ${key} effect`;
  }
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
 * Decide whether an export can skip browser compositing. Eligible only when
 * every clip is plain video/audio whose browser render is one framed footage
 * layer at a time plus a static-gain audio mix; any field this plan does not
 * explicitly reproduce makes the timeline ineligible.
 */
export function plainExportPlan(timeline: Timeline, assets: MediaAsset[], resolution: ExportResolution, fps: number): PlainExportDecision {
  const no = (reason: string): PlainExportDecision => ({ eligible: false, reason });
  if (fps !== 24 && fps !== 30 && fps !== 60) return no('unsupported export frame rate');
  if (resolution !== 720 && resolution !== 1080 && resolution !== 2160) return no('unsupported export resolution');
  if (!timeline.clips.length) return no('the timeline is empty');
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  const { width, height } = dimensions(timeline.aspectRatio, resolution);
  try { validateAudioTimeline(timeline); } catch { return no('audio settings are invalid'); }
  const visuals: { clip: Clip; first: number; end: number }[] = [];
  const audio: PlainAudioTrack[] = [];
  for (const clip of timeline.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') return no(`the timeline contains a ${clip.kind} clip`);
    const extra = unsupportedKey(clip, clip.kind === 'video' ? VIDEO_KEYS : AUDIO_KEYS);
    if (extra) return no(`a ${clip.kind} clip sets ${extra}`);
    if (!finite(clip.start, clip.duration, clip.sourceStart) || clip.start < 0 || clip.duration <= 0 || clip.sourceStart < 0) return no('a clip has invalid timing');
    try { validatePlaybackRate(clip); } catch { return no('a clip has an invalid playback speed'); }
    if (clip.effectPreset !== undefined && clip.effectPreset !== 'none') return no('a clip uses an effect preset');
    if (clip.motion?.length) return no('a clip has motion keyframes');
    if (!clip.assetId) return no('a clip has no media');
    const asset = assetMap.get(clip.assetId);
    if (clip.kind === 'video') {
      const reason = visualReason(clip, asset);
      if (reason) return no(reason);
      const { first, end } = visibleTicks(clip, fps);
      if (end > first) visuals.push({ clip, first, end });
    } else if (!asset || asset.kind !== 'audio') return no('an audio clip references unavailable or mismatched media');
    const volume = Number.isFinite(clip.volume) ? Math.min(MAX_CLIP_VOLUME, Math.max(0, clip.volume!)) : 1;
    // Export omits silent sound entirely; composition writing also mutes video without an audio stream.
    if (volume === 0) continue;
    // HyperFrames bakes the clip's volume lane into its samples. Reproduce only a constant lane;
    // ducking and phase-retained fades vary the gain and keep the browser path.
    let points: { v: number }[];
    try { points = (JSON.parse(audioVolumeEnvelope(timeline, clip, volume)) as { lanes: { points: { v: number }[] }[] }).lanes[0].points; } catch { return no('a clip has an unsupported volume envelope'); }
    if (points.some(point => Math.abs(point.v - volume) > 1e-9)) return no('a clip has ducking or a retained fade envelope');
    const fades = audioFadeAttributes(clip);
    audio.push({ clipId: clip.id, assetId: clip.assetId, kind: clip.kind, start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart, playbackRate: playbackRateOf(clip), volume, fadeIn: fades.fadeIn, fadeOut: fades.fadeOut });
  }
  visuals.sort((a, b) => a.first - b.first);
  for (let index = 1; index < visuals.length; index++) if (visuals[index].first < visuals[index - 1].end) return no('video clips overlap');
  if (audio.length > PLAIN_EXPORT_MAX_AUDIO_TRACKS) return no(`more than ${PLAIN_EXPORT_MAX_AUDIO_TRACKS} sounding clips`);
  const duration = Math.max(timelineDuration(timeline), 1 / fps);
  const frames = exportFrameCount(duration, fps);
  const video: PlainVideoSegment[] = [];
  let cursor = 0;
  for (const { clip, first, end: rawEnd } of visuals) {
    const end = Math.min(rawEnd, frames);
    if (end <= first) continue;
    if (first > cursor) video.push({ kind: 'gap', frames: first - cursor });
    const fit = clip.fit ?? 'cover';
    video.push({ kind: 'clip', clipId: clip.id, assetId: clip.assetId!, frames: end - first, sourceStart: clip.sourceStart, playbackRate: playbackRateOf(clip), sourceDuration: clip.duration * playbackRateOf(clip), phase: first - clip.start * fps || 0, fit, ...framing(assetMap.get(clip.assetId!)!, width, height, fit) });
    cursor = end;
  }
  if (cursor < frames) video.push({ kind: 'gap', frames: frames - cursor });
  return { eligible: true, plan: { width, height, fps, duration, frames, video, audio } };
}
