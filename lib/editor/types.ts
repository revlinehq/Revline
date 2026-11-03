import type { ImpactSettings, OverlaySettings, ParallaxSettings } from './montage-vfx';
import type { PixelTrackBinding } from '../media-analysis/pixel-track';
import type { TextGradient } from './text-gradient';
import type { BlendMode, CinematicBarSettings, EffectPreset, SolidColorSettings, MotionKeyframe, FrameShrinkSettings, ZoomSettings } from './clip-effects';
import type { ColorGrade, ZoomBlur, Glitch, InvertColors, Dither, NeonEdges, LensDistortion, FilmOverlay, Vhs, LightLeak, DirectionalBlur, TurbulentDisplace, LightSweep, SoftBlur, FrameDistortion, FrameCorners, Bloom } from './visual-effects';
import type { RemotionTextTemplate } from './remotion-text';
import type { ClipTransition } from './clip-transitions';
import type { AudioSettings } from './audio-settings';
import type { VisualFadeSettings } from './visual-fades';
import type { TextAppearance } from './text-style';
import type { TextFontId } from './text-fonts';
import type { FlashSettings, PunchSettings, ShakeSettings, PopSettings } from './motion-effect-settings';
import type { SmoothZoomSettings } from './smooth-zoom-settings';
import type { CameraMotionSettings } from './camera-motion-settings';
import type { EffectKeyframeLane } from './effect-keyframes';
import type { RampPoint } from './speed-ramp';
import type { AudioReactive } from './audio-reactive';
import type { ClipLut, ColorCurves, HslAdjust, TimelineLut } from './color-finish';
import type { ClipMask } from './masks';
import type { SceneSource } from './scene-layers';
import type { ClipOutline } from './clip-outline';
import { scenePlaceholderCover } from './scene-placeholder';
export type AspectRatio = 'vertical' | 'portrait-feed' | 'square' | 'classic' | 'landscape';
export type ClipKind = 'video' | 'image' | 'audio' | 'caption' | 'graphic' | 'solid' | 'scene' | 'effect';
export type LayerGroup = 'visual' | 'overlay' | 'audio' | 'effects';
export type TrackCounts = Record<Exclude<LayerGroup, 'effects'>, number> & { effects?:number };
export type ResolvedTrackCounts = Required<TrackCounts>;
export const TIMELINE_LAYER_GROUPS = ['effects', 'visual', 'audio'] as const;
export type VisualTransform = { x: number; y: number; scale: number; rotation: number; opacity: number };
export type SourceCrop = { left: number; top: number; right: number; bottom: number };
export const DEFAULT_TRANSFORM: VisualTransform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
export const DEFAULT_CROP: SourceCrop = { left: 0, top: 0, right: 0, bottom: 0 };
/** The user signed off on this work: editing agents refuse to change it unless the user names it. */
export type ClipApproval = { note?: string; at: number; by: 'user' | 'agent' };
/** An approved stretch of a film or scene, in film seconds (the scene's own clock), so it holds across moves and splits. */
export type ApprovedSection = ClipApproval & { id: string; start: number; end: number; label?: string };
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
  normalizedAudio?: {assetId:string;key:string;targetLufs:number;truePeak:number;offset?:number};
  audioFadeTiming?: {duration:number;offset:number};
  visualFade?: VisualFadeSettings;
  visualFadeTiming?: {duration:number;offset:number};
  frameShrink?: FrameShrinkSettings;
  impact?: ImpactSettings;
  overlay?: OverlaySettings;
  overlayTiming?: { duration: number; offset: number };
  parallax?: ParallaxSettings;
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
  /** Keyframed visual-effect controls (colorGrade.saturation, softBlur.amount, ...), in motion path time. */
  effectKeyframes?: EffectKeyframeLane[];
  /** 0..1: blur keyframed movement by its speed (directional for slides, radial for scale pops). */
  motionBlur?: number;
  pixelTracking?: PixelTrackBinding;
  /** Speed ramp: playback rate over clip-local seconds (linked video and audio share it). */
  speedRamp?: RampPoint[];
  /** Shape/text mask with feathered edge, keyed in motion path time. */
  mask?: ClipMask;
  /** Scale/shake/rotate or effect controls driven by a music level curve (timeline seconds). */
  audioReactive?: AudioReactive;
  /** Color finishing after the grade: RGB/master curves, 8-band HSL, LUT look. */
  colorCurves?: ColorCurves;
  hsl?: HslAdjust;
  lut?: ClipLut;
  bloom?: Bloom;
  smoothZoom?: SmoothZoomSettings;
  cameraMotion?: CameraMotionSettings;
  effectPreset?: EffectPreset | 'none';
  cinematicBars?: CinematicBarSettings;
  solidColor?: SolidColorSettings;
  scene?: SceneSource;
  transition?: ClipTransition;
  colorGrade?: ColorGrade;
  zoomBlur?: ZoomBlur;
  glitch?: Glitch;
  invert?: InvertColors;
  dither?: Dither;
  neonEdges?: NeonEdges;
  lensDistortion?: LensDistortion;
  filmOverlay?: FilmOverlay;
  vhs?: Vhs;
  lightLeak?: LightLeak;
  directionalBlur?: DirectionalBlur;
  turbulentDisplace?: TurbulentDisplace;
  lightSweep?: LightSweep;
  softBlur?: SoftBlur;
  frameDistortion?: FrameDistortion;
  frameCorners?: FrameCorners;
  outline?: ClipOutline;
  textTemplate?: RemotionTextTemplate;
  textStyle?: TextAppearance;
  textGradient?: TextGradient;
  fontFamily?: TextFontId;
  animation?: 'none' | 'fade' | 'rise';
  textAnimationTiming?: {duration:number;offset:number};
  focus?: {time:number;x:number;y:number}[];
  transform?: VisualTransform;
  crop?: SourceCrop;
  fit?: 'cover' | 'contain';
  approval?: ClipApproval;
  approvedSections?: ApprovedSection[];
};
export type TimelineMarker = { id: string; time: number; label?: string };
export type Timeline = { audioNormalization?: NonNullable<Clip['normalizedAudio']>; clips: Clip[]; fps: number; aspectRatio: AspectRatio; tracks?: TrackCounts; markers?: TimelineMarker[]; luts?: TimelineLut[] };
export type AudioWaveform = { peaks: string; samplesPerSecond: number };
export type MediaAsset = {
  _id: string; fileName: string; kind: 'video' | 'image' | 'audio' | 'model';
  createdAt?: number;
  imageGeneration?: { purpose?: 'asset' | 'storyboard'; storyboard?: { name: string; phase?: 'sheet' | 'rough' | 'style' | 'direction' | 'board'; presented?: boolean; shotIndex: number } };
  duration?: number; width?: number; height?: number; size?: number; url: string | null; thumbnailUrl?:string|null;
  previewUrl?: string | null; previewSize?: number; previewWidth?: number; previewHeight?: number; previewFps?: number; previewVersion?: number;
  previewOriginalPlayable?: boolean;
  previewSegments?: import('./preview-segments').PreviewSegment[];
  audioAssetId?: string; audioExtracted?: boolean;
  /** Set on a background-removed copy (VP9 with alpha) of cutoutOf, on the same source timeline; frames before cutoutStart are transparent. */
  cutoutOf?: string; cutoutStart?: number;
  /** Set on a processed copy of derivedOf: a freeze still, or slow-motion/upscaled video on the same source timeline. */
  derivedOf?: string; derivedStart?: number; derivation?: 'freeze' | 'slowmo' | 'upscale' | 'parallax';
  analysisKinds?: string[];
  preparation?: {status:'processing'|'failed';message:string};
  waveform?: AudioWaveform;
  analysis?: {
    facecam?: import('../media-analysis/clipping').FacecamAnalysis;
    speakers?: import('../media-analysis/clipping').SpeakerAnalysis;
    transcript?: {segments:{start:number;end:number;text:string}[];words:{start:number;end:number;text:string;speaker?:number;speakerConfidence?:number}[]};
    audioActivity?: import('../media-analysis/audio-activity').AudioActivity;
    speechCleanup?: import('../speech-cleanup/types').SpeechCleanup;
    understanding?: {summary:string;scenes:{start:number;end:number;description:string;score:number}[];suggestions?:SourceEditSuggestion[]};
    shots?: {fps:number;sourceTiming?:{basis:'pts';videoStart:number;videoEnd:number;frameCount:number};shots:{start:number;end:number;startFrame:number;endFrame:number}[]};
    beats?: import('../media-analysis/beat-map').BeatMap;
    focus?: {time:number;x:number;y:number}[];
  };
};
export type SourceEditSuggestion = { label:string;prompt:string;start:number;end:number };
export const EMPTY_TIMELINE: Timeline = { clips: [], fps: 60, aspectRatio: 'vertical', tracks: { visual: 1, overlay: 0, audio: 1, effects:0 } };
export function maxTrackCount(group: LayerGroup) { return group === 'visual' || group === 'effects' ? 24 : 12; }
export function layerGroup(kind: ClipKind | 'model'): Exclude<LayerGroup,'overlay'> {
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
/** A timeline's preview: the thumbnail of its first shot (the earliest video or image, top layer first). */
/** The timeline's first picture: footage's thumbnail, or a motion scene's own rendered frame (from sceneThumbs). */
export function timelineCover(timeline: Pick<Timeline, 'clips'>, assets: readonly Pick<MediaAsset, '_id' | 'kind' | 'url' | 'thumbnailUrl'>[], sceneThumbs?: Record<string, { time: number; image: string }[]>) {
  const first = timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image' || (clip.kind === 'scene' && sceneThumbs?.[clip.id]?.length)).sort((a, b) => a.start - b.start || trackOf(b) - trackOf(a))[0];
  if (first?.kind === 'scene') { const frames = sceneThumbs![first.id]; const image = frames[Math.floor(frames.length / 2)].image; return image.startsWith('https://') ? image : `data:image/jpeg;base64,${image}`; }
  const asset = first && assets.find(item => item._id === first.assetId);
  if (asset) return asset.thumbnailUrl ?? (asset.kind === 'image' ? asset.url : null);
  // Motion clips whose frames are still coming get their placeholder, not a blank cover.
  if (first) return null;
  const scene = timeline.clips.filter(clip => clip.kind === 'scene').sort((a, b) => a.start - b.start)[0] as Clip | undefined;
  return scene ? scenePlaceholderCover(scene.scene?.title || 'Scene') : null;
}
/** Zero legacy overlay rows marks the shared V-track model, without a schema migration. */
export function normalizeTimeline(timeline: Timeline): Timeline {
  if (timeline.tracks?.overlay === 0) return timeline;
  const visuals = timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'solid' || clip.kind === 'scene');
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
  return kind === 'effect' ? '#F53F46' : kind === 'caption' ? '#5DBAA0' : kind === 'graphic' ? '#BA5D7A' : kind === 'scene' ? '#5D86BA' : kind === 'audio' ? '#8F5DBA' : '#303030';
}
export function deriveTracks(timeline: Timeline) {
  const counts = deriveTrackCounts(timeline);
  return TIMELINE_LAYER_GROUPS.flatMap(group => Array.from({ length: counts[group] }, (_, index) => {
    const number = counts[group] - index;
    return { id: `${group}-${number}`, group, number, label: `${group === 'effects' ? 'FX' : group === 'visual' ? 'V' : 'A'}${number}`, color: group === 'visual' ? '#3DD68C' : group === 'audio' ? '#A78BFA' : clipColor('effect') };
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
/** The project frame closest to a source's shape, so new footage fills the frame it was shot for. */
export function aspectRatioForSize(width: number, height: number): AspectRatio {
  const shapes: [AspectRatio, number][] = [['vertical', 9 / 16], ['portrait-feed', 4 / 5], ['square', 1], ['classic', 4 / 3], ['landscape', 16 / 9]];
  const ratio = width / height;
  return shapes.reduce((best, shape) => Math.abs(Math.log(shape[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? shape : best)[0];
}
export function formatTime(time: number, frames = false, fps = 30) {
  // The composition clock rounds seconds to seven decimals. Tolerate that
  // precision at frame boundaries so 1.0333333 displays frame 01 at 30 fps.
  const seconds = Math.max(0, time) + (frames ? 1e-7 : 0);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}${frames ? ':' + Math.floor(seconds % 1 * fps).toString().padStart(2, '0') : ''}`;
}
