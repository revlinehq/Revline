import { DEFAULT_IMPACT, DEFAULT_OVERLAY, validateMontageVfx } from './montage-vfx';
import { validateTextGradient, textGradientTimingPatch } from './text-gradient';
import { flashSettings, punchSettings, shakeSettings, popSettings, flashKeyframes, punchKeyframes, shakeKeyframes, popKeyframes, isPropertyEffectPreset, propertyEffectMotion, motionEffectPatch, validateMotionEffectSettings, type MotionEffectChanges } from './motion-effect-settings';
import { BLEND_MODES, EFFECT_PRESETS, TIMED_EFFECT_PRESETS, type BlendMode, type CinematicBarSettings, type Clip, type EffectPreset, type FrameShrinkSettings, type SolidColorSettings, type TimedEffectPreset, type ZoomSettings } from './types';
import { DEFAULT_ZOOM_BLUR, validateVisualEffects } from './visual-effects';
import { textTemplateTimingPatch, validateRemotionTextTemplate } from './remotion-text';
import { validatePlaybackRate } from './playback-rate';
import { isTransitionPreset, validateTransitionSettings } from './clip-transitions';
import { validateTextStyle } from './text-style';
import { audioFadeTimingPatch,validateAudioSettings } from './audio-settings';
import { textAnimationTimingPatch,validateTextAnimationTiming } from './text-animation-timing';
import {validateVisualFade,visualFadeTimingPatch} from './visual-fades';
import { CAMERA_ZOOM_RANGE, validateSmoothZoom } from './smooth-zoom-settings';
import { validateCameraMotion } from './camera-motion-settings';
import { NEUTRAL_MOTION, motionAt, type MotionKeyframe } from './motion-path';
import { validateEffectKeyframes } from './effect-keyframes';
import { shiftSpeedRamp } from './speed-ramp';
import { validateMask } from './masks';
import { validateAudioReactive } from './audio-reactive';
import { validateColorFinish } from './color-finish';
// lib/ai/object-motion.ts still reads MotionKeyframe from here.
export type { MotionKeyframe } from './motion-path';

export { BLEND_MODES, EFFECT_PRESETS, TIMED_EFFECT_PRESETS };
export type { BlendMode, CinematicBarSettings, EffectPreset, FrameShrinkSettings, SolidColorSettings, TimedEffectPreset, ZoomSettings };
const MOTION_PRESETS = ['none', 'fade', 'punch', 'shake', 'flash', 'pop'] as const;
export type MotionPreset = typeof MOTION_PRESETS[number];
/** Presets offered for new edits; the rest stay renderable in saved projects. */
export const OFFERED_TIMED_EFFECT_PRESETS = ['punch', 'shake', 'flash', 'zoom-blur', 'quick-zoom-in', 'quick-zoom-out', 'solid-color', 'impact-frame', 'texture-overlay'] as const satisfies readonly TimedEffectPreset[];
export const DEFAULT_SOLID_COLOR: SolidColorSettings = { color: '#2563eb', width: 1, height: 1, x: .5, y: .5, opacity: 1 };
export const SOLID_COLOR_LIMITS = { width: [.01, 2], height: [.01, 2], x: [0, 1], y: [0, 1], opacity: [0, 1] } as const;
/** Saved FX rectangles retain their original compositing until explicitly moved to V. */
export function isSolidColorClip(clip: Pick<Clip, 'kind' | 'effectPreset'>) { return clip.kind === 'solid' || clip.kind === 'effect' && clip.effectPreset === 'solid-color'; }
export function solidColorSettings(clip: Pick<Clip, 'solidColor'>): SolidColorSettings { return clip.solidColor ?? DEFAULT_SOLID_COLOR; }
export function solidColorPatch(clip:Clip,changes:Partial<SolidColorSettings>):Pick<Clip,'solidColor'>{
  const solidColor={...solidColorSettings(clip),...changes};
  validateClipEffects({...clip,solidColor});
  return {solidColor};
}
const DEFAULT_CINEMATIC_BARS: CinematicBarSettings = { size: .12, speed: 1 };
const CINEMATIC_BAR_LIMITS = { size: [0, .5], speed: [.25, 4] } as const;
const DEFAULT_FRAME_SHRINK: FrameShrinkSettings = { size: .12, speed: 1 };
const FRAME_SHRINK_LIMITS = { size: [0, .45], speed: [.25, 4] } as const;
export const ZOOM_LIMITS = { amount: [1, 3], speed: [.25, 4], centerX: [0, 1], centerY: [0, 1] } as const;
export function isZoomPreset(preset: unknown): preset is 'quick-zoom-in' | 'quick-zoom-out' { return preset === 'quick-zoom-in' || preset === 'quick-zoom-out'; }
function zoomSettings(clip: Pick<Clip, 'effectPreset' | 'zoom' | 'motion'>): ZoomSettings {
  return clip.zoom ?? { direction: clip.effectPreset === 'quick-zoom-out' ? 'out' : 'in', amount: isZoomPreset(clip.effectPreset) && clip.motion?.length ? Math.max(1, ...clip.motion.map(frame => frame.scale)) : 1.2, speed: 1, centerX: .5, centerY: .5 };
}
/** One editable zoom recipe; speed adjusts its progression within the FX range. */
function zoomKeyframes(duration: number, settings: ZoomSettings): MotionKeyframe[] {
  const steps = 16;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const time = duration * index / steps, progress = Math.min(1, index / steps * settings.speed);
    const scale = settings.direction === 'in' ? 1 + (settings.amount - 1) * progress : settings.amount + (1 - settings.amount) * progress;
    return key(time, { scale, x: (.5 - settings.centerX) * (scale - 1), y: (.5 - settings.centerY) * (scale - 1) });
  });
}
const key = (time: number, changes: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, ...NEUTRAL_MOTION, ...changes });
export function cinematicBarSettings(clip: Pick<Clip, 'cinematicBars'>): CinematicBarSettings { return clip.cinematicBars ?? DEFAULT_CINEMATIC_BARS; }
/** Clip length controls hold/end time; speed alone controls the entrance and exit. */
function cinematicBarKeyframes(duration: number, speed = 1): MotionKeyframe[] {
  const movement = Math.min(.4 / speed, duration / 2);
  return [key(0, { opacity: 0 }), key(movement), key(duration - movement), key(duration, { opacity: 0 })].filter((frame, index, frames) => index === 0 || frame.time > frames[index - 1].time);
}
function frameShrinkSettings(clip: Pick<Clip, 'frameShrink'>): FrameShrinkSettings { return clip.frameShrink ?? DEFAULT_FRAME_SHRINK; }
/** Insets every side by size; sampled smoothstep uses the existing motion clock. */
function frameShrinkKeyframes(duration:number,settings:FrameShrinkSettings=DEFAULT_FRAME_SHRINK):MotionKeyframe[]{
  const movement=Math.min(.4/settings.speed,duration/2),scale=Math.max(.1,1-2*settings.size),steps=8;
  const smooth=(p:number)=>p*p*(3-2*p),bounded=(value:number)=>Math.max(scale,Math.min(1,value));
  return [...Array.from({length:steps+1},(_,index)=>key(movement*index/steps,{scale:bounded(1+(scale-1)*smooth(index/steps))})),key(duration-movement,{scale}),...Array.from({length:steps},(_,index)=>key(duration-movement+movement*(index+1)/steps,{scale:bounded(scale+(1-scale)*smooth((index+1)/steps))}))]
    .filter((frame,index,frames)=>index===0||frame.time>frames[index-1].time);
}
export const EFFECT_CATALOG: Record<EffectPreset, { label: string; description: string; duration: number; keyframes: (duration: number) => MotionKeyframe[] }> = {
  'impact-frame': { label: 'Impact frame', description: 'Timed inverted, black and white, posterized or manga ink hit with speed lines and flash.', duration: .1, keyframes: () => [] },
  'texture-overlay': { label: 'Texture overlay', description: 'Procedural light leak, film burn, flare, dust or grain blended over the composition.', duration: .6, keyframes: () => [] },
  crossfade: { label: 'Crossfade', description: "Dissolve between two neighboring clips with complementary opacity weights, retaining transparent/cropped content and original audio timing.", duration: .6, keyframes: () => [] },
  'spin-zoom': { label: 'Spin zoom', description: "Dissolve while the outgoing frame rotates and zooms away and the incoming frame settles from an opposite tilt/zoom. Clockwise or counter-clockwise; rotation of 18 degrees and zoom up to 1.55.", duration: .6, keyframes: () => [] },
  'blur-dissolve': { label: 'Blur dissolve', description: "Dissolve as outgoing footage blurs and incoming footage comes into focus. Blur reaches 20 reference pixels and scales with output resolution.", duration: .6, keyframes: () => [] },
  'gradient-wipe': { label: 'Gradient wipe', description: "Reveal the neighboring incoming clip with a moving gradient edge. Direction and softness are adjustable; complementary masks preserve cropped transparency and lower layers.", duration: .6, keyframes: () => [] },
  'iris-wipe': { label: 'Iris wipe', description: "Open a circular or elliptical iris into the neighboring incoming clip, with editable center and edge softness. Complementary masks preserve source transparency and lower layers.", duration: .6, keyframes: () => [] },
  'whip-pan': { label: 'Whip pan', description: "Both shots slide past like a fast camera whip, eased in and out, with a motion blur that peaks mid-move. Direction follows wipeDirection (left by default).", duration: .4, keyframes: () => [] },
  'zoom-through': { label: 'Zoom through', description: "Push into the outgoing shot until it blows past the camera while the incoming shot lands from behind, with blur at the peak.", duration: .5, keyframes: () => [] },
  'film-burn': { label: 'Film burn', description: "The cut burns out to warm, overexposed light like the end of a film reel, then the incoming shot develops back in.", duration: .7, keyframes: () => [] },
  fade: { label: 'Fade in / out', description: "Fade the underlying footage in and out with a held middle section; does not fade audio.", duration: 1, keyframes: d => { const fade = Math.min(.3, d / 3); return [key(0, { opacity: 0 }), key(fade), key(d - fade), key(d, { opacity: 0 })]; } },
  punch: { label: 'Zoom · Punch', description: 'The Punch preset in Zoom: a quick push in followed by a return to normal, with editable strength, attack, return time and center.', duration: .5, keyframes: d => punchKeyframes(d) },
  shake: { label: 'Impact shake', description: "Brief horizontal/vertical offsets and small rotation jitter with a slight inset zoom; preserves the original cut and audio timing.", duration: .5, keyframes: d => shakeKeyframes(d) },
  flash: { label: 'Flash', description: "A brief brightness pulse over the footage that settles back to normal; does not add a new media source.", duration: .5, keyframes: d => flashKeyframes(d) },
  pop: { label: 'Pop in', description: "Scale footage from 0.7\u00d7 through a small overshoot while fading in, then settle to normal size.", duration: .5, keyframes: d => popKeyframes(d) },
  'solid-color': { label: 'Solid color', description: "A solid color frame or normalized adjustable rectangle with editable width, height, center and opacity.", duration: 2, keyframes: d => [key(0), key(d)] },
  'cinematic-bars': { label: 'Cinematic bars', description: "Black top/bottom bars slide in, hold and slide out; size controls their fraction of frame height and speed controls entry/exit.", duration: 2, keyframes: d => cinematicBarKeyframes(d) },
  'frame-shrink': { label: 'Frame shrink', description: "Shrink the visual composition smoothly toward canvas center, hold with black space on all four sides, then return to its original framing. Size is the inset fraction per side; speed controls entrance/exit. Moves the footage itself without adding a rectangle or masking it; preserves audio and source timing.", duration: 2, keyframes: d => frameShrinkKeyframes(d) },
  'quick-zoom-in': { label: 'Zoom', description: "A smooth visual push from normal framing to 1.2\u00d7 over the chosen interval.", duration: .5, keyframes: d => [key(0), key(d, { scale: 1.2 })] },
  'zoom-blur': { label: 'Zoom blur', description: "A timed radial blur pulse with editable strength and normalized blur center, fading in and out over underlying footage.", duration: .6, keyframes: d => { const fade = Math.min(.18, d / 2); return [key(0, {opacity:0}), key(fade), ...(d-fade > fade ? [key(d-fade)] : []), key(d, {opacity:0})]; } },
  'quick-zoom-out': { label: 'Zoom', description: "A smooth visual pull from 1.2\u00d7 to normal framing over the chosen interval.", duration: .5, keyframes: d => [key(0, { scale: 1.2 }), key(d)] },
};
export function effectClipLabel(clip: Pick<Clip, 'effectPreset'>) { return clip.effectPreset && clip.effectPreset !== 'none' ? EFFECT_CATALOG[clip.effectPreset].label : 'Custom effect'; }
const bounds = { x: [-1, 1], y: [-1, 1], scale: [0.1, CAMERA_ZOOM_RANGE[1]], rotation: [-360, 360], opacity: [0, 1], brightness: [0, 4] } as const;

export function validateClipEffects(clip: Clip) {
  validateMontageVfx(clip);
  if (clip.pixelTracking) {
    const binding = clip.pixelTracking;
    if (!['video', 'image', 'caption', 'graphic', 'solid'].includes(clip.kind) || binding.mode === 'mask' && !['video', 'image'].includes(clip.kind)) throw new Error('Track a visual overlay or a source mask.');
    if (!(binding.width > 0 && binding.height > 0 && binding.attachedDuration > 0) || ![binding.width, binding.height, binding.attachedStart, binding.attachedDuration, binding.attachedMotionOffset, binding.smoothing].every(Number.isFinite) || binding.smoothing < 0 || binding.smoothing > 1 || !binding.reference.trackId || !binding.reference.token) throw new Error('Invalid pixel tracking reference.');
  }
  validatePlaybackRate(clip);
  validateVisualEffects(clip);
  validateEffectKeyframes(clip.effectKeyframes);
  validateMask(clip);
  validateAudioReactive(clip);
  validateColorFinish(clip);
  if (clip.motionBlur !== undefined && (!Number.isFinite(clip.motionBlur) || clip.motionBlur < 0 || clip.motionBlur > 1)) throw new Error('Motion blur must be between 0 and 1.');
  if (clip.effectKeyframes?.length && clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Effect keyframes apply to video or image clips.');
  validateRemotionTextTemplate(clip);
  validateTextStyle(clip);
  validateTextGradient(clip);
  validateAudioSettings(clip);
  validateTextAnimationTiming(clip);
  validateVisualFade(clip);
  validateTransitionSettings(clip);
  validateMotionEffectSettings(clip);
  validateSmoothZoom(clip);
  validateCameraMotion(clip);
  if (clip.zoom !== undefined) {
    if (clip.kind !== 'effect' || !isZoomPreset(clip.effectPreset)) throw new Error('Zoom controls belong to Zoom effect clips.');
    if (!['in', 'out'].includes(clip.zoom.direction) || clip.effectPreset !== `quick-zoom-${clip.zoom.direction}`) throw new Error('Choose a matching Zoom direction.');
    for (const property of Object.keys(ZOOM_LIMITS) as (keyof typeof ZOOM_LIMITS)[]) {
      const [min, max] = ZOOM_LIMITS[property], value = clip.zoom[property];
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Zoom ${property} must be between ${min} and ${max}.`);
    }
  }
  if (clip.solidColor !== undefined) {
    if (!isSolidColorClip(clip)) throw new Error('Solid color settings belong to solid color clips.');
    if (!/^#[\da-f]{6}$/i.test(clip.solidColor.color)) throw new Error('Choose a valid solid color.');
    for (const property of Object.keys(SOLID_COLOR_LIMITS) as (keyof typeof SOLID_COLOR_LIMITS)[]) {
      const [min, max] = SOLID_COLOR_LIMITS[property], value = clip.solidColor[property];
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Solid color ${property} must be between ${min} and ${max}.`);
    }
  }
  if (clip.cinematicBars !== undefined) {
    if (clip.kind !== 'effect' || clip.effectPreset !== 'cinematic-bars') throw new Error('Cinematic bar settings belong to cinematic bar effect clips.');
    for (const property of ['size', 'speed'] as const) {
      const [min, max] = CINEMATIC_BAR_LIMITS[property], value = clip.cinematicBars[property];
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Cinematic bar ${property} must be between ${min} and ${max}.`);
    }
  }
  if(clip.frameShrink!==undefined){
    if(clip.kind!=='effect'||clip.effectPreset!=='frame-shrink')throw new Error('Frame shrink settings belong to frame shrink effect clips.');
    for(const property of ['size','speed'] as const){
      const [min,max]=FRAME_SHRINK_LIMITS[property],value=clip.frameShrink[property];
      if(!Number.isFinite(value)||value<min||value>max)throw new Error(`Frame shrink ${property} must be between ${min} and ${max}.`);
    }
  }
  if (clip.effectPreset !== undefined && (clip.kind !== 'effect' || (clip.effectPreset !== 'none' && !EFFECT_PRESETS.includes(clip.effectPreset)))) throw new Error('Effect presets belong to effect clips.');
  if (clip.kind === 'solid') {
    if (clip.assetId !== undefined || clip.linkedClipId !== undefined || clip.audioSeparated !== undefined || clip.volume !== undefined || clip.sourceStart !== 0) throw new Error('Solid color clips cannot reference media or audio.');
    if (clip.transform !== undefined || clip.crop !== undefined || clip.fit !== undefined || clip.focus !== undefined || clip.text !== undefined || clip.animation !== undefined) throw new Error('Use solid color position and size controls for color layers.');
  }
  if (clip.kind === 'effect') {
    if (clip.assetId !== undefined || clip.linkedClipId !== undefined || clip.audioSeparated !== undefined || clip.volume !== undefined || clip.sourceStart !== 0) throw new Error('Effect clips cannot reference media or audio.');
    if (clip.blendMode !== undefined || clip.transform !== undefined || clip.crop !== undefined || clip.fit !== undefined || clip.focus !== undefined || clip.text !== undefined || clip.animation !== undefined) throw new Error('Use motion keyframes to animate an effect clip.');
  }
  if (clip.blendMode !== undefined && !BLEND_MODES.includes(clip.blendMode)) throw new Error('Choose a supported blend mode.');
  if ((clip.motion?.length || clip.blendMode) && clip.kind === 'audio') throw new Error('Visual effects cannot be applied to audio.');
  if (clip.motionOffset !== undefined && (!Number.isFinite(clip.motionOffset))) throw new Error('Invalid motion offset.');
  if (!clip.motion) return;
  for (const [index, key] of clip.motion.entries()) {
    if (!Number.isFinite(key.time) || key.time < 0 || (index > 0 && key.time <= clip.motion[index - 1].time)) throw new Error('Motion keyframes need finite, increasing nonnegative times.');
    for (const property of Object.keys(bounds) as (keyof typeof bounds)[]) {
      // Centering a zoomed edge target can legitimately translate by more than
      // one canvas width. Keep ordinary text/FX limits; allow the camera keys
      // room for the inverse of an existing small or rotated static transform.
      // Image and video object paths invert their parent transform; their public
      // canvas offsets stay bounded to one width/height before compilation.
      const [min, max] = property === 'x' || property === 'y' ? (clip.cameraMotion || clip.smoothZoom) ? [-16, 16] : (clip.kind === 'image' || clip.kind === 'video') ? [-32, 32] : bounds[property] : bounds[property];
      if (!Number.isFinite(key[property]) || key[property] < min || key[property] > max) throw new Error(`Motion ${property} is out of range.`);
    }
  }
}

export function visibleMotion(clip: Clip): MotionKeyframe[] {
  const from = clip.motionOffset ?? 0, end = from + clip.duration;
  const motion = clip.kind === 'effect' && clip.effectPreset === 'cinematic-bars'
    ? cinematicBarKeyframes(Math.max(end, clip.motion?.at(-1)?.time ?? end), cinematicBarSettings(clip).speed)
    : clip.motion;
  if (!motion?.length) return [];
  return [motionAt(motion, from), ...motion.filter(key => key.time > from && key.time < end), motionAt(motion, end)].map(key => ({ ...key, time: key.time - from }));
}

export function motionPreset(clip: Clip, preset: MotionPreset | EffectPreset): Partial<Clip> {
  if ((preset === 'cinematic-bars' || preset === 'frame-shrink' || preset === 'zoom-blur' || preset === 'solid-color' || isTransitionPreset(preset)) && clip.kind !== 'effect') throw new Error('Add this preset as an effect clip.');
  if (isTransitionPreset(preset) && !clip.transition) throw new Error('Choose the two neighboring clips for this transition.');
  const zoom = isZoomPreset(preset) ? { ...zoomSettings(clip), direction: preset === 'quick-zoom-in' ? 'in' as const : 'out' as const } : undefined;
  const propertyClip = { ...clip, effectPreset: preset, ...(clip.effectPreset !== preset ? { motion: undefined, motionOffset: 0 } : {}) };
  const motion = preset === 'none' ? [] : isPropertyEffectPreset(preset) ? propertyEffectMotion(propertyClip)! : zoom ? zoomKeyframes(clip.duration, zoom) : preset === 'cinematic-bars' ? cinematicBarKeyframes(clip.duration, cinematicBarSettings(clip).speed) : preset==='frame-shrink'?frameShrinkKeyframes(clip.duration,frameShrinkSettings(clip)):EFFECT_CATALOG[preset].keyframes(clip.duration);
  return { motion, motionOffset: 0, ...(clip.kind === 'effect' ? { effectPreset: preset, zoom, impact: preset === 'impact-frame' ? {...DEFAULT_IMPACT,...clip.impact} : undefined, overlay: preset === 'texture-overlay' ? {...DEFAULT_OVERLAY,...clip.overlay} : undefined, overlayTiming: preset === 'texture-overlay' ? {duration:clip.duration,offset:0} : undefined, flash: preset === 'flash' ? { ...flashSettings(propertyClip) } : undefined, punch: preset === 'punch' ? { ...punchSettings(clip) } : undefined, shake: preset === 'shake' ? { ...shakeSettings(clip) } : undefined, pop: preset === 'pop' ? { ...popSettings(clip) } : undefined, transition: isTransitionPreset(preset) ? clip.transition : undefined, solidColor: preset === 'solid-color' ? { ...solidColorSettings(clip) } : undefined, cinematicBars: preset === 'cinematic-bars' ? { ...cinematicBarSettings(clip) } : undefined, frameShrink:preset==='frame-shrink'?{...frameShrinkSettings(clip)}:undefined, zoomBlur: preset === 'zoom-blur' ? {...DEFAULT_ZOOM_BLUR,...clip.zoomBlur,enabled:true} : undefined } : {}), ...(clip.kind === 'caption' || clip.kind === 'graphic' ? { animation: 'none' as const,textAnimationTiming:undefined } : {}) };
}

/**
 * Clip settings that run on their own frozen `{duration, offset}` clock, keyed by the field that holds it.
 * Changing a clip's length freezes each clock (delta 0); moving its start shifts each offset by delta.
 * A text gradient is not here: its clock is an offset only (its animation loops on its own duration),
 * so a length change leaves it alone and only a moved start shifts it (see offsetClipMotion).
 */
export const OWN_CLOCK_SETTINGS = [
  ['textTemplate', textTemplateTimingPatch],
  ['textAnimationTiming', textAnimationTimingPatch],
  ['audioFadeTiming', audioFadeTimingPatch],
  ['visualFadeTiming', visualFadeTimingPatch],
] as const;
export type OwnClockSetting = typeof OWN_CLOCK_SETTINGS[number][0];

/** Freeze (delta 0) or shift every own-clock setting the clip carries, except those `keep` names. */
export function ownClockTimingPatch(clip: Clip, delta = 0, keep: (setting: OwnClockSetting) => boolean = () => false): Partial<Clip> {
  return Object.assign({}, ...OWN_CLOCK_SETTINGS.map(([setting, patch]) => keep(setting) ? {} : patch(clip, delta)));
}

export function offsetClipMotion(clip: Clip, delta: number): Partial<Clip> {
  return { ...(clip.speedRamp?.length ? { speedRamp: shiftSpeedRamp(clip.speedRamp, delta) } : {}), ...(clip.motion?.length || clip.effectKeyframes?.length || clip.mask || clip.parallax || clip.pixelTracking ? { motionOffset: (clip.motionOffset ?? 0) + delta } : {}), ...(clip.overlay ? {overlayTiming:{duration:clip.overlayTiming?.duration??clip.duration,offset:(clip.overlayTiming?.offset??0)+delta}} : {}), ...ownClockTimingPatch(clip, delta), ...textGradientTimingPatch(clip,delta) };
}

/** Effect handles stretch the currently visible pulse, including a previously split segment. */
export function resizeEffectMotion(clip: Clip, duration: number): Partial<Clip> {
  if(clip.effectPreset==='texture-overlay')return {overlayTiming:{duration,offset:0}};
  if (isZoomPreset(clip.effectPreset) && clip.zoom) return { motion: zoomKeyframes(duration, clip.zoom), motionOffset: 0 };
  if (clip.effectPreset === 'cinematic-bars') return { motion: cinematicBarKeyframes(duration, cinematicBarSettings(clip).speed), motionOffset: 0 };
  if (isPropertyEffectPreset(clip.effectPreset) && clip[clip.effectPreset]) return { motion: propertyEffectMotion(clip, duration), motionOffset: 0 };
  if(clip.effectPreset==='frame-shrink')return {motion:frameShrinkKeyframes(duration,frameShrinkSettings(clip)),motionOffset:0};
  return { motion: visibleMotion(clip).map(key => ({ ...key, time: key.time / clip.duration * duration })), motionOffset: 0 };
}

/** Presets are editable starting points; requested controls never change footage or neighboring FX. */
export function configureTimedEffectPatch(clip:Clip,changes:{preset?:TimedEffectPreset;duration?:number;cinematicBars?:Partial<CinematicBarSettings>;frameShrink?:Partial<FrameShrinkSettings>;zoom?:Partial<ZoomSettings>}&MotionEffectChanges):Partial<Clip>{
  if(clip.kind!=='effect'||isTransitionPreset(clip.effectPreset))throw new Error('Choose a timed FX clip; pair transitions have separate controls.');
  if(!Object.values(changes).some(value=>value!==undefined))throw new Error('Specify a timed effect control.');
  const duration=changes.duration??clip.duration;if(!Number.isFinite(duration)||duration<=0)throw new Error('Choose a positive timed effect duration.');
  let patch:Partial<Clip>={...(changes.duration!==undefined?{duration}:{}),...(changes.preset?motionPreset({...clip,duration},changes.preset):changes.duration!==undefined?resizeEffectMotion(clip,duration):{})};
  if(changes.cinematicBars){
    if((changes.preset??clip.effectPreset)!=='cinematic-bars')throw new Error('Size/speed controls belong to cinematic bars.');
    if(!Object.values(changes.cinematicBars).some(value=>value!==undefined))throw new Error('Specify a cinematic bars control.');
    const cinematicBars={...cinematicBarSettings(clip),...changes.cinematicBars};patch={...patch,cinematicBars,motion:cinematicBarKeyframes(duration,cinematicBars.speed),motionOffset:0};
  }
  if(changes.frameShrink){
    if((changes.preset??clip.effectPreset)!=='frame-shrink')throw new Error('Frame shrink size/speed controls belong to frame shrink.');
    if(!Object.values(changes.frameShrink).some(value=>value!==undefined))throw new Error('Specify a frame shrink control.');
    const frameShrink={...frameShrinkSettings(clip),...changes.frameShrink};patch={...patch,frameShrink,motion:frameShrinkKeyframes(duration,frameShrink),motionOffset:0};
  }
  if (changes.zoom) {
    const candidate = { ...clip, ...patch };
    if (!isZoomPreset(candidate.effectPreset)) throw new Error('Zoom controls belong to Zoom effect clips.');
    if (!Object.values(changes.zoom).some(value => value !== undefined)) throw new Error('Specify a Zoom control.');
    const zoom = { ...zoomSettings(candidate), ...changes.zoom };
    patch = { ...patch, effectPreset: zoom.direction === 'in' ? 'quick-zoom-in' : 'quick-zoom-out', zoom, motion: zoomKeyframes(duration, zoom), motionOffset: 0 };
  }
  if (changes.flash || changes.punch || changes.shake || changes.pop) patch = { ...patch, ...motionEffectPatch({ ...clip, ...patch, duration }, changes) };
  validateClipEffects({...clip,...patch});return patch;
}
