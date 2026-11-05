/**
 * The timeline data model: plain data types, the enumerations they are built from, and the track model.
 * Settings modules (clip-effects, visual-effects, masks, ...) import their data types from here and add the
 * validation and behaviour; this file imports only types, from modules that never import it back.
 */
import type { ImpactSettings, OverlaySettings, ParallaxSettings } from './montage-vfx';
import type { TextGradient } from './text-gradient';
import type { MotionKeyframe, NamedMotionEasing } from './motion-path';
import type { NeonEdges } from './neon-edges';
import type { RemotionTextTemplate } from './remotion-text';
import type { TextAppearance } from './text-style';
import type { TextFontId } from './text-fonts';
import type { RampPoint } from './speed-ramp';
import type { ClipLut, ColorCurves, HslAdjust, TimelineLut } from './color-finish';
import type { SceneBrand } from './brand-kit';
import type { Transcript } from '../media-analysis/transcript';
/** Every project frame, as its name and the width:height of its shape, narrowest first. */
const ASPECT_RATIO_SHAPES = [['vertical', 9, 16], ['portrait-feed', 4, 5], ['square', 1, 1], ['classic', 4, 3], ['landscape', 16, 9]] as const;
export type AspectRatio = typeof ASPECT_RATIO_SHAPES[number][0];
export const ASPECT_RATIOS: readonly AspectRatio[] = ASPECT_RATIO_SHAPES.map(([ratio]) => ratio);
/** The frame's width-to-height label, such as "16:9". */
export function aspectRatioLabel(ratio: AspectRatio) { const [, width, height] = ASPECT_RATIO_SHAPES.find(([name]) => name === ratio)!; return `${width}:${height}`; }

// Clip settings data. Validation and defaults live in the named settings module.

// clip-effects
export const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay', 'plus-lighter', 'difference'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export const TIMED_EFFECT_PRESETS = ['punch', 'shake', 'flash', 'pop', 'cinematic-bars', 'quick-zoom-in', 'quick-zoom-out', 'zoom-blur', 'solid-color', 'impact-frame', 'texture-overlay'] as const;
export type TimedEffectPreset=typeof TIMED_EFFECT_PRESETS[number];
export const TRANSITION_PRESETS = ['crossfade', 'spin-zoom', 'blur-dissolve', 'gradient-wipe', 'iris-wipe', 'whip-pan', 'zoom-through', 'film-burn'] as const;
export type TransitionPreset = typeof TRANSITION_PRESETS[number];
/** Retired presets remain valid for saved projects; new choices use the active catalog. */
export const EFFECT_PRESETS = ['fade', 'frame-shrink', ...TIMED_EFFECT_PRESETS, ...TRANSITION_PRESETS] as const;
export type EffectPreset = typeof EFFECT_PRESETS[number];
export type SolidColorSettings = { color: string; width: number; height: number; x: number; y: number; opacity: number };
export type CinematicBarSettings = { size: number; speed: number };
export type FrameShrinkSettings = { size: number; speed: number };
export type ZoomSettings = { direction: 'in' | 'out'; amount: number; speed: number; centerX: number; centerY: number };

// clip-transitions
export const TRANSITION_DIRECTIONS = ['clockwise', 'counter-clockwise'] as const;
export type TransitionDirection = typeof TRANSITION_DIRECTIONS[number];
export const WIPE_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export const IRIS_SHAPES = ['circle', 'ellipse'] as const;
export type TransitionWipeSettings = { wipeDirection: typeof WIPE_DIRECTIONS[number]; softness: number; centerX: number; centerY: number; shape: typeof IRIS_SHAPES[number] };
export type ClipTransition = { fromClipId: string; toClipId: string; direction: TransitionDirection } & Partial<TransitionWipeSettings>;

// visual-effects
export type ColorGrade = { enabled: boolean; exposure: number; contrast: number; saturation: number; temperature: number; tint: number; vibrance: number };
export type ZoomBlur = { enabled: boolean; amount: number; centerX: number; centerY: number };
export type Glitch = { enabled: boolean; intensity: number; blockSize: number; rgbSplit: number };
export type InvertColors = { enabled: boolean; amount: number };
export type Dither = { enabled: boolean; amount: number; levels: number; size: number; shadowColor?: string; highlightColor?: string };
export type FrameDistortion = { enabled: boolean; horizontal: number; vertical: number; skew: number; bend?: number };
export type FrameCorners = { enabled: boolean; amount: number };
export type SoftBlur = { enabled: boolean; amount: number };
export type LensDistortion = { enabled: boolean; amount: number; centerX: number; centerY: number; fringing: number };
export type FilmOverlay = { enabled: boolean; amount: number; grain: number; dust: number; scratches: number; vignette: number; flicker: number; warmth: number };
export type Vhs = { enabled: boolean; amount: number; scanlines: number; noise: number; bleed: number; tracking: number; speed: number };
/** Position travels clockwise around the edge: left 0, top .25, right .5, bottom .75. */
export type LightLeak = { enabled: boolean; amount: number; color: string; position: number; spread: number; speed: number };
export type DirectionalBlur = { enabled: boolean; amount: number; angle: number };
export type TurbulentDisplace = { enabled: boolean; amount: number; scale: number; speed: number };
export type LightSweep = { enabled: boolean; amount: number; color: string; angle: number; position: number; width: number; speed: number };
/** Glow around highlights: brightness above `threshold` spreads over `radius` pixels (at 1080p). */
export type Bloom = { enabled: boolean; amount: number; threshold: number; radius: number };

// audio-settings
export const AUDIO_ROLES=['original','voice','music'] as const;
export type AudioRole=typeof AUDIO_ROLES[number];
export type AudioDucking={enabled:boolean;amount:number;attack:number;release:number};
export type AudioSettings={role:AudioRole;fadeIn:number;fadeOut:number;ducking:AudioDucking};

// visual-fades
export type VisualFadeSettings = { fadeIn: number; fadeOut: number };

// motion-effect-settings
export type FlashSettings = { strength: number; attack: number; release: number };
export type PunchSettings = { amount: number; speed: number; centerX: number; centerY: number; attack?: number; release?: number };
export type ShakeSettings = { strength: number; speed: number; direction: 'both' | 'horizontal' | 'vertical' };
export type PopSettings = { startScale: number; bounce: number; speed: number };

// smooth-zoom-settings, camera-motion-settings
export type SmoothZoomSettings = { start: number; inDuration: number; holdDuration: number; outDuration: number; scale: number; centerX: number; centerY: number; framing?: 'anchor' | 'center'; easing: NamedMotionEasing };
export type CameraMotionSettings = { blurAmount?:number; keyframes: { time: number; scale: number; centerX: number; centerY: number; easing: SmoothZoomSettings['easing'] }[] };

// effect-keyframes
export type EffectKey = { time: number; value: number };
export type EffectKeyframeLane = { control: string; keys: EffectKey[] };

// audio-reactive
export type ReactiveTarget = { property: string; amount: number };
export type AudioReactive = { rate: number; start: number; levels: string; targets: ReactiveTarget[] };

// masks
export const MASK_SHAPES = ['rectangle', 'ellipse', 'polygon', 'text'] as const;
export type MaskShape = typeof MASK_SHAPES[number];
export type MaskGeometry = { x: number; y: number; width: number; height: number; rotation: number; feather: number };
export type MaskKey = MaskGeometry & { time: number };
export type ClipMask = { shape: MaskShape; invert?: boolean; radius?: number; points?: number[][]; text?: string; active?: { start: number; end: number }; keys: MaskKey[] };

// clip-outline
/** A stroke and glow traced around a clip's visible pixels. On a cut-out (alpha video)
 * it follows the subject's silhouette. Pixel sizes are measured at 1080 output height. */
export type ClipOutline = { enabled: boolean; color: string; width: number; glow: number };

// scene-layers
/** A TypeScript module that builds HTML once and animates it on a GSAP timeline; the composition seeks it to clip-local time. */
/** A project image a scene uses, by the name its code reads from `media`. */
export type SceneMedia = { name: string; assetId: string };
/** A brand's UI rebuilt as a scene module with named parts, mounted inside a scene with blueprint(name, container). */
export type SceneBlueprint = { name: string; code: string; codeRef?: string };
/**
 * A film is one scene module whose animation runs on film time; its beat clips share that code and each shows
 * its own window: `sourceStart` is where the clip starts in the film, and every clip gets the film's whole
 * duration. So motion flows across clip edges, and an edit to the code changes every beat at once.
 */
export type SceneFilm = { duration: number; builtThrough?: number; referenceAssetId?: string; referenceStart?: number };
export type SceneSource = { title: string; code: string; codeRef?: string; brand?: SceneBrand; media?: SceneMedia[]; blueprints?: SceneBlueprint[]; film?: SceneFilm };

// Pixel tracking: how a clip follows a tracked point (lib/media-analysis/pixel-track holds the tracker's wire format).
export type PixelTrackReference = { trackId: string; token: string };
export type TrackGeometry = Pick<Clip, 'id' | 'kind' | 'assetId' | 'start' | 'duration' | 'sourceStart' | 'playbackRate' | 'speedRamp' | 'focus' | 'transform' | 'crop' | 'fit' | 'motion' | 'motionOffset' | 'cameraMotion' | 'smoothZoom'>;
export type TrackMaskSettings = { shape: MaskShape; width: number; height: number; feather?: number; invert?: boolean; radius?: number; text?: string };
type BindingBase = { reference: PixelTrackReference; footage: TrackGeometry; width: number; height: number; aspectRatio: AspectRatio; attachedStart: number; attachedDuration: number; attachedMotionOffset: number; smoothing: number; followTransform: boolean };
export type PixelTrackBinding = BindingBase & ({ mode: 'move'; offsetX: number; offsetY: number } | { mode: 'mask'; target: TrackGeometry; mask: TrackMaskSettings });

// preview-segments
export type SourceRange = { start: number; end: number };
export type PreviewSegment = SourceRange & { url: string; size: number };

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
  normalizedAudio?: {assetId:string;key:string;targetLufs:number;truePeak:number;offset?:number;outputLufs?:number;measuredTruePeak?:number};
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
  /** Source seconds of measured camera/speaker switches retained with the crop. */
  framingCuts?: number[];
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
  duration?: number; width?: number; height?: number; size?: number; url: string | null; thumbnailUrl?:string|null;
  previewUrl?: string | null; previewSize?: number; previewWidth?: number; previewHeight?: number; previewFps?: number; previewVersion?: number;
  previewOriginalPlayable?: boolean;
  previewSegments?: PreviewSegment[];
  audioAssetId?: string; audioExtracted?: boolean;
  /** Set on a background-removed copy (VP9 with alpha) of cutoutOf, on the same source timeline; frames before cutoutStart are transparent. */
  cutoutOf?: string; cutoutStart?: number;
  /** Set on a processed copy of derivedOf: a freeze still, or slow-motion/upscaled video on the same source timeline. */
  derivedOf?: string; derivedStart?: number; derivation?: 'freeze' | 'slowmo' | 'upscale' | 'parallax';
  analysisKinds?: string[];
  footageProgress?: number;
  preparation?: {status:'processing'|'failed';message:string};
  waveform?: AudioWaveform;
  analysis?: {
    highlights?: string;
    facecam?: import('../media-analysis/clipping').FacecamAnalysis;
    speakers?: import('../media-analysis/clipping').SpeakerAnalysis;
    transcript?: Transcript;
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
  // The short side is `resolution`; the long side rounds to an even pixel count.
  const shape = ASPECT_RATIO_SHAPES.find(([name]) => name === ratio);
  if (!shape || shape[1] === shape[2]) return { width: resolution, height: resolution };
  const [, width, height] = shape;
  return width < height ? { width: resolution, height: even(resolution * height / width) } : { width: even(resolution * width / height), height: resolution };
}
/** The project frame closest to a source's shape, so new footage fills the frame it was shot for. */
export function aspectRatioForSize(width: number, height: number): AspectRatio {
  const shapes = ASPECT_RATIO_SHAPES.map(([name, width, height]): [AspectRatio, number] => [name, width / height]);
  const ratio = width / height;
  return shapes.reduce((best, shape) => Math.abs(Math.log(shape[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? shape : best)[0];
}
export function formatTime(time: number, frames = false, fps = 30) {
  // The composition clock rounds seconds to seven decimals. Tolerate that
  // precision at frame boundaries so 1.0333333 displays frame 01 at 30 fps.
  const seconds = Math.max(0, time) + (frames ? 1e-7 : 0);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}${frames ? ':' + Math.floor(seconds % 1 * fps).toString().padStart(2, '0') : ''}`;
}
