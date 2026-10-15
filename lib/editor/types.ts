import type { BlendMode, CinematicBarSettings, EffectPreset, SolidColorSettings, MotionKeyframe, FrameShrinkSettings, ZoomSettings } from './clip-effects';
import type { ColorGrade, ZoomBlur, Glitch, InvertColors, Dither, NeonEdges } from './visual-effects';
import type { RemotionTextTemplate } from './remotion-text';
import type { ClipTransition } from './clip-transitions';
import type { AudioSettings } from './audio-settings';
import type { VisualFadeSettings } from './visual-fades';
import type { TextAppearance } from './text-style';
import type { TextFontId } from './text-fonts';
import type { FlashSettings, PunchSettings, ShakeSettings, PopSettings } from './motion-effect-settings';
export type AspectRatio = 'vertical' | 'portrait-feed' | 'square' | 'classic' | 'landscape';
export type ClipKind = 'video' | 'image' | 'audio' | 'caption' | 'graphic' | 'effect';
export type LayerGroup = 'visual' | 'overlay' | 'audio' | 'effects';
export type TrackCounts = Record<Exclude<LayerGroup, 'effects'>, number> & { effects?:number };
export type ResolvedTrackCounts = Required<TrackCounts>;
export const TIMELINE_LAYER_GROUPS = ['effects', 'visual', 'audio'] as const;
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
  playbackRate?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  x?: number;
  y?: number;
  volume?: number;
  audio?: AudioSettings;
  audioFadeTiming?: {duration:number;offset:number};
  visualFade?: VisualFadeSettings;
  visualFadeTiming?: {duration:number;offset:number};
  frameShrink?: FrameShrinkSettings;
  flash?: FlashSettings;
  punch?: PunchSettings;
  shake?: ShakeSettings;
  pop?: PopSettings;
  zoom?: ZoomSettings;
  linkedClipId?: string;
  audioSeparated?: boolean;
  blendMode?: BlendMode;
  motion?: MotionKeyframe[];
  motionOffset?: number;
  effectPreset?: EffectPreset | 'none';
  cinematicBars?: CinematicBarSettings;
  solidColor?: SolidColorSettings;
  transition?: ClipTransition;
  colorGrade?: ColorGrade;
  zoomBlur?: ZoomBlur;
  glitch?: Glitch;
  invert?: InvertColors;
  dither?: Dither;
  neonEdges?: NeonEdges;
  textTemplate?: RemotionTextTemplate;
  textStyle?: TextAppearance;
  fontFamily?: TextFontId;
  animation?: 'none' | 'fade' | 'rise';
  textAnimationTiming?: {duration:number;offset:number};
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
  duration?: number; width?: number; height?: number; url: string | null; thumbnailUrl?:string|null;
  audioAssetId?: string; audioExtracted?: boolean;
  preparation?: {status:'processing'|'failed';message:string};
  waveform?: AudioWaveform;
  analysis?: {
    transcript?: {segments:{start:number;end:number;text:string}[];words:{start:number;end:number;text:string}[]};
    understanding?: {summary:string;scenes:{start:number;end:number;description:string;score:number}[];suggestions?:SourceEditSuggestion[]};
    shots?: {fps:number;sourceTiming?:{basis:'pts';videoStart:number;videoEnd:number;frameCount:number};shots:{start:number;end:number;startFrame:number;endFrame:number}[]};
    beats?: import('../media-analysis/beat-map').BeatMap;
    focus?: {time:number;x:number;y:number}[];
  };
};
export type SourceEditSuggestion = { label:string;prompt:string;start:number;end:number };
export const EMPTY_TIMELINE: Timeline = { clips: [], fps: 30, aspectRatio: 'vertical', tracks: { visual: 1, overlay: 0, audio: 1, effects:0 } };
export function maxTrackCount(group: LayerGroup) { return group === 'visual' || group === 'effects' ? 24 : 12; }
export function layerGroup(kind: ClipKind): Exclude<LayerGroup,'overlay'> {
  return kind === 'effect' ? 'effects' : kind === 'audio' ? 'audio' : 'visual';
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
  const visuals = timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image');
  // Old separated-overlay projects counted effects as V rows. Preserve that
  // historical text offset; explicit FX counts and FX13–24 never belonged to it.
  const legacyEffects = timeline.tracks?.effects === undefined ? timeline.clips.filter(clip=>clip.kind==='effect'&&(clip.track??1)<=12) : [];
  const text = timeline.clips.filter(clip => clip.kind === 'caption' || clip.kind === 'graphic');
  const audio = timeline.clips.filter(clip => clip.kind === 'audio');
  const visualCount = Math.max(validCount(timeline.tracks?.visual ?? 1), ...[...visuals,...legacyEffects].map(clip => validTrack(clip.track ?? 1, 12)));
  const overlayCount = Math.max(validCount(timeline.tracks?.overlay ?? (text.length ? 1 : 0)), ...text.map(clip => validTrack(clip.track ?? (clip.kind === 'caption' ? 2 : 1), 12)));
  const audioCount = Math.max(validCount(timeline.tracks?.audio ?? 1), ...audio.map(clip => trackOf(clip)));
  return {
    ...timeline,
    tracks: { visual: visualCount + overlayCount, overlay: 0, audio: audioCount, effects:Math.max(validCount(timeline.tracks?.effects??0,24), ...timeline.clips.filter(clip=>clip.kind==='effect').map(trackOf)) },
    clips: timeline.clips.map(clip => clip.kind === 'caption' || clip.kind === 'graphic' ? { ...clip, track: visualCount + (clip.track ?? (clip.kind === 'caption' ? 2 : 1)) } : clip),
  };
}
export function deriveTrackCounts(timeline: Timeline): ResolvedTrackCounts {
  timeline = normalizeTimeline(timeline);
  const counts: ResolvedTrackCounts = {
    visual: validCount(timeline.tracks?.visual ?? 1, 24),
    overlay: 0,
    audio: validCount(timeline.tracks?.audio ?? 1),
    effects: validCount(timeline.tracks?.effects ?? 0,24),
  };
  for (const clip of timeline.clips) {
    const group = layerGroup(clip.kind);
    counts[group] = Math.max(counts[group], trackOf(clip));
  }
  return counts;
}
export function clipColor(kind: ClipKind) {
  return kind === 'effect' ? '#F53F46' : kind === 'caption' ? '#5DBAA0' : kind === 'graphic' ? '#BA5D7A' : kind === 'audio' ? '#8F5DBA' : '#303030';
}
export function deriveTracks(timeline: Timeline) {
  const counts = deriveTrackCounts(timeline);
  return TIMELINE_LAYER_GROUPS.flatMap(group => Array.from({ length: counts[group] }, (_, index) => {
    const number = counts[group] - index;
    return { id: `${group}-${number}`, group, number, label: `${group === 'effects' ? 'FX' : group === 'visual' ? 'V' : 'A'}${number}`, color: group === 'visual' ? '#32C878' : clipColor(group === 'effects' ? 'effect' : 'audio') };
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
