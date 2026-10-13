import type { BlendMode, EffectPreset, MotionKeyframe } from './clip-effects';
export type AspectRatio = 'vertical' | 'portrait-feed' | 'square' | 'classic' | 'landscape';
export type ClipKind = 'video' | 'image' | 'audio' | 'caption' | 'graphic' | 'effect';
export type LayerGroup = 'visual' | 'overlay' | 'audio';
export type TrackCounts = Record<LayerGroup, number>;
export type VisualTransform = { x: number; y: number; scale: number; rotation: number; opacity: number };
export type SourceCrop = { left: number; top: number; right: number; bottom: number };
export const DEFAULT_TRANSFORM: VisualTransform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
export const DEFAULT_CROP: SourceCrop = { left: 0, top: 0, right: 0, bottom: 0 };
export type Clip = {
  id: string;
  kind: ClipKind;
  assetId?: string;
  track?: number;
  start: number;
  duration: number;
  sourceStart: number;
  text?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  x?: number;
  y?: number;
  volume?: number;
  linkedClipId?: string;
  audioSeparated?: boolean;
  blendMode?: BlendMode;
  motion?: MotionKeyframe[];
  motionOffset?: number;
  effectPreset?: EffectPreset | 'none';
  animation?: 'none' | 'fade' | 'rise';
  focus?: {time:number;x:number;y:number}[];
  transform?: VisualTransform;
  crop?: SourceCrop;
  fit?: 'cover' | 'contain';
};
export type TimelineMarker = { id: string; time: number; label?: string };
export type Timeline = { clips: Clip[]; fps: number; aspectRatio: AspectRatio; tracks?: TrackCounts; markers?: TimelineMarker[] };
export type AudioWaveform = { peaks: string; samplesPerSecond: number };
export type MediaAsset = {
  _id: string; fileName: string; kind: 'video' | 'image' | 'audio';
  duration?: number; width?: number; height?: number; url: string | null;
  audioAssetId?: string; audioExtracted?: boolean;
  waveform?: AudioWaveform;
  analysis?: {
    transcript?: {segments:{start:number;end:number;text:string}[];words:{start:number;end:number;text:string}[]};
    understanding?: {summary:string;scenes:{start:number;end:number;description:string;score:number}[]};
    shots?: {fps:number;shots:{start:number;end:number;startFrame:number;endFrame:number}[]};
    beats?: {beats:number[];bpm:number;confidence:number};
    focus?: {time:number;x:number;y:number}[];
  };
};
export const EMPTY_TIMELINE: Timeline = { clips: [], fps: 30, aspectRatio: 'vertical', tracks: { visual: 1, overlay: 0, audio: 1 } };
export function maxTrackCount(group: LayerGroup) { return group === 'visual' ? 24 : 12; }
export function layerGroup(kind: ClipKind): LayerGroup {
  return kind === 'audio' ? 'audio' : 'visual';
}
function validCount(value: number, maximum = 12) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`A group can have between 0 and ${maximum} layers.`);
  return value;
}
function validTrack(value: number, maximum = 24) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Layer numbers must be integers from 1 to ${maximum}.`);
  return value;
}
export function trackOf(clip: Pick<Clip, 'kind' | 'track'>) { return validTrack(clip.track ?? (clip.kind === 'caption' ? 2 : 1), maxTrackCount(layerGroup(clip.kind))); }
/** Zero legacy overlay rows marks the shared V-track model, without a schema migration. */
export function normalizeTimeline(timeline: Timeline): Timeline {
  if (timeline.tracks?.overlay === 0) return timeline;
  const visuals = timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'effect');
  const text = timeline.clips.filter(clip => clip.kind === 'caption' || clip.kind === 'graphic');
  const audio = timeline.clips.filter(clip => clip.kind === 'audio');
  const visualCount = Math.max(validCount(timeline.tracks?.visual ?? 1), ...visuals.map(clip => validTrack(clip.track ?? 1, 12)));
  const overlayCount = Math.max(validCount(timeline.tracks?.overlay ?? (text.length ? 1 : 0)), ...text.map(clip => validTrack(clip.track ?? (clip.kind === 'caption' ? 2 : 1), 12)));
  const audioCount = Math.max(validCount(timeline.tracks?.audio ?? 1), ...audio.map(clip => trackOf(clip)));
  return {
    ...timeline,
    tracks: { visual: visualCount + overlayCount, overlay: 0, audio: audioCount },
    clips: timeline.clips.map(clip => clip.kind === 'caption' || clip.kind === 'graphic' ? { ...clip, track: visualCount + (clip.track ?? (clip.kind === 'caption' ? 2 : 1)) } : clip),
  };
}
export function deriveTrackCounts(timeline: Timeline): TrackCounts {
  timeline = normalizeTimeline(timeline);
  const counts: TrackCounts = {
    visual: validCount(timeline.tracks?.visual ?? 1, 24),
    overlay: 0,
    audio: validCount(timeline.tracks?.audio ?? 1),
  };
  for (const clip of timeline.clips) {
    const group = layerGroup(clip.kind);
    counts[group] = Math.max(counts[group], trackOf(clip));
  }
  return counts;
}
export function clipColor(kind: ClipKind) {
  return kind === 'effect' ? '#AB7A32' : kind === 'caption' ? '#5DBAA0' : kind === 'graphic' ? '#BA5D7A' : kind === 'audio' ? '#8F5DBA' : '#303030';
}
export function deriveTracks(timeline: Timeline) {
  const counts = deriveTrackCounts(timeline);
  return (['visual', 'audio'] as const).flatMap(group => Array.from({ length: counts[group] }, (_, index) => {
    const number = counts[group] - index;
    return { id: `${group}-${number}`, group, number, label: `${group === 'visual' ? 'V' : 'A'}${number}`, color: clipColor(group === 'visual' ? 'video' : 'audio') };
  }));
}
export function timelineDuration(timeline: Timeline) {
  return Math.max(0, ...timeline.clips.map(c => c.start + c.duration));
}
export function dimensions(ratio: AspectRatio, resolution = 1080) {
  const even = (value: number) => Math.round(value / 2) * 2;
  if (ratio === 'vertical') return { width: resolution, height: even(resolution * 16 / 9) };
  if (ratio === 'portrait-feed') return { width: resolution, height: even(resolution * 5 / 4) };
  if (ratio === 'landscape') return { width: even(resolution * 16 / 9), height: resolution };
  if (ratio === 'classic') return { width: even(resolution * 4 / 3), height: resolution };
  return { width: resolution, height: resolution };
}
export function formatTime(time: number, frames = false, fps = 30) {
  // The composition clock rounds seconds to seven decimals. Tolerate that
  // precision at frame boundaries so 1.0333333 displays frame 01 at 30 fps.
  const seconds = Math.max(0, time) + (frames ? 1e-7 : 0);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}${frames ? ':' + Math.floor(seconds % 1 * fps).toString().padStart(2, '0') : ''}`;
}
