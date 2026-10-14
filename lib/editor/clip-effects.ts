import type { Clip } from './types';
import { DEFAULT_ZOOM_BLUR, validateVisualEffects } from './visual-effects';
import { textTemplateTimingPatch, validateRemotionTextTemplate } from './remotion-text';
import { validatePlaybackRate } from './playback-rate';
import { isTransitionPreset, TRANSITION_PRESETS, validateTransitionSettings } from './clip-transitions';
import { validateTextStyle } from './text-style';
import { audioFadeTimingPatch,validateAudioSettings } from './audio-settings';
import { textAnimationTimingPatch,validateTextAnimationTiming } from './text-animation-timing';
import {validateVisualFade,visualFadeTimingPatch} from './visual-fades';

export const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay', 'plus-lighter', 'difference'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export type MotionKeyframe = { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; brightness: number };
export const MOTION_PRESETS = ['none', 'fade', 'punch', 'shake', 'flash', 'pop'] as const;
export type MotionPreset = typeof MOTION_PRESETS[number];
export const TIMED_EFFECT_PRESETS = ['punch', 'shake', 'flash', 'pop', 'cinematic-bars', 'frame-shrink', 'quick-zoom-in', 'quick-zoom-out', 'zoom-blur', 'solid-color'] as const;
export type TimedEffectPreset=typeof TIMED_EFFECT_PRESETS[number];
/** Saved legacy fade FX remains renderable; new fades belong to footage/audio settings. */
export const EFFECT_PRESETS = ['fade', ...TIMED_EFFECT_PRESETS, ...TRANSITION_PRESETS] as const;
export type EffectPreset = typeof EFFECT_PRESETS[number];
export type SolidColorSettings = { color: string; width: number; height: number; x: number; y: number; opacity: number };
export const DEFAULT_SOLID_COLOR: SolidColorSettings = { color: '#2563eb', width: 1, height: 1, x: .5, y: .5, opacity: 1 };
export const SOLID_COLOR_LIMITS = { width: [.01, 2], height: [.01, 2], x: [0, 1], y: [0, 1], opacity: [0, 1] } as const;
export function solidColorSettings(clip: Pick<Clip, 'solidColor'>): SolidColorSettings { return clip.solidColor ?? DEFAULT_SOLID_COLOR; }
export function solidColorPatch(clip:Clip,changes:Partial<SolidColorSettings>):Pick<Clip,'solidColor'>{
  const solidColor={...solidColorSettings(clip),...changes};
  validateClipEffects({...clip,solidColor});
  return {solidColor};
}
export type CinematicBarSettings = { size: number; speed: number };
export const DEFAULT_CINEMATIC_BARS: CinematicBarSettings = { size: .12, speed: 1 };
export const CINEMATIC_BAR_LIMITS = { size: [0, .5], speed: [.25, 4] } as const;
export type FrameShrinkSettings = { size: number; speed: number };
export const DEFAULT_FRAME_SHRINK: FrameShrinkSettings = { size: .12, speed: 1 };
export const FRAME_SHRINK_LIMITS = { size: [0, .45], speed: [.25, 4] } as const;
export type ZoomSettings = { direction: 'in' | 'out'; amount: number; speed: number; centerX: number; centerY: number };
export const ZOOM_LIMITS = { amount: [1, 3], speed: [.25, 4], centerX: [0, 1], centerY: [0, 1] } as const;
export function isZoomPreset(preset: unknown): preset is 'quick-zoom-in' | 'quick-zoom-out' { return preset === 'quick-zoom-in' || preset === 'quick-zoom-out'; }
export function zoomSettings(clip: Pick<Clip, 'effectPreset' | 'zoom' | 'motion'>): ZoomSettings {
  return clip.zoom ?? { direction: clip.effectPreset === 'quick-zoom-out' ? 'out' : 'in', amount: isZoomPreset(clip.effectPreset) && clip.motion?.length ? Math.max(1, ...clip.motion.map(frame => frame.scale)) : 1.2, speed: 1, centerX: .5, centerY: .5 };
}
/** One editable zoom recipe; speed adjusts its progression within the FX range. */
export function zoomKeyframes(duration: number, settings: ZoomSettings): MotionKeyframe[] {
  const steps = 16;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const time = duration * index / steps, progress = Math.min(1, index / steps * settings.speed);
    const scale = settings.direction === 'in' ? 1 + (settings.amount - 1) * progress : settings.amount + (1 - settings.amount) * progress;
    return key(time, { scale, x: (.5 - settings.centerX) * (scale - 1), y: (.5 - settings.centerY) * (scale - 1) });
  });
}
export const NEUTRAL_MOTION = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 };
const key = (time: number, changes: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, ...NEUTRAL_MOTION, ...changes });
export function cinematicBarSettings(clip: Pick<Clip, 'cinematicBars'>): CinematicBarSettings { return clip.cinematicBars ?? DEFAULT_CINEMATIC_BARS; }
/** Clip length controls hold/end time; speed alone controls the entrance and exit. */
export function cinematicBarKeyframes(duration: number, speed = 1): MotionKeyframe[] {
  const movement = Math.min(.4 / speed, duration / 2);
  return [key(0, { opacity: 0 }), key(movement), key(duration - movement), key(duration, { opacity: 0 })].filter((frame, index, frames) => index === 0 || frame.time > frames[index - 1].time);
}
export function frameShrinkSettings(clip: Pick<Clip, 'frameShrink'>): FrameShrinkSettings { return clip.frameShrink ?? DEFAULT_FRAME_SHRINK; }
/** Insets every side by size; sampled smoothstep uses the existing motion clock. */
export function frameShrinkKeyframes(duration:number,settings:FrameShrinkSettings=DEFAULT_FRAME_SHRINK):MotionKeyframe[]{
  const movement=Math.min(.4/settings.speed,duration/2),scale=Math.max(.1,1-2*settings.size),steps=8;
  const smooth=(p:number)=>p*p*(3-2*p),bounded=(value:number)=>Math.max(scale,Math.min(1,value));
  return [...Array.from({length:steps+1},(_,index)=>key(movement*index/steps,{scale:bounded(1+(scale-1)*smooth(index/steps))})),key(duration-movement,{scale}),...Array.from({length:steps},(_,index)=>key(duration-movement+movement*(index+1)/steps,{scale:bounded(scale+(1-scale)*smooth((index+1)/steps))}))]
    .filter((frame,index,frames)=>index===0||frame.time>frames[index-1].time);
}
export const EFFECT_CATALOG: Record<EffectPreset, { label: string; description: string; duration: number; keyframes: (duration: number) => MotionKeyframe[] }> = {
  crossfade: { label: 'Crossfade', description: "Dissolve between two neighboring clips with complementary opacity weights, retaining transparent/cropped content and original audio timing.", duration: .6, keyframes: () => [] },
  'spin-zoom': { label: 'Spin zoom', description: "Dissolve while the outgoing frame rotates and zooms away and the incoming frame settles from an opposite tilt/zoom. Clockwise or counter-clockwise; rotation of 18 degrees and zoom up to 1.55.", duration: .6, keyframes: () => [] },
  'blur-dissolve': { label: 'Blur dissolve', description: "Dissolve as outgoing footage blurs and incoming footage comes into focus. Blur reaches 20 reference pixels and scales with output resolution.", duration: .6, keyframes: () => [] },
  fade: { label: 'Fade in / out', description: "Fade the underlying footage in and out with a held middle section; does not fade audio.", duration: 1, keyframes: d => { const fade = Math.min(.3, d / 3); return [key(0, { opacity: 0 }), key(fade), key(d - fade), key(d, { opacity: 0 })]; } },
  punch: { label: 'Punch zoom', description: "A quick 1.2\u00d7 visual punch toward the center, followed by a return to the original framing.", duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0), key(hit * .3, { scale: 1.2 }), key(hit), key(d)]; } },
  shake: { label: 'Impact shake', description: "Brief horizontal/vertical offsets and small rotation jitter with a slight inset zoom; preserves the original cut and audio timing.", duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0, { scale: 1.08 }), key(hit * .15, { x: .018, y: -.01, rotation: 1.2, scale: 1.08 }), key(hit * .35, { x: -.014, y: .008, rotation: -.9, scale: 1.08 }), key(hit * .6, { x: .008, y: -.004, rotation: .4, scale: 1.08 }), key(hit, { scale: 1.08 }), key(d, { scale: 1.08 })]; } },
  flash: { label: 'Flash', description: "A brief brightness pulse over the footage that settles back to normal; does not add a new media source.", duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0), key(hit * .2, { brightness: 3 }), key(hit), key(d)]; } },
  pop: { label: 'Pop in', description: "Scale footage from 0.7\u00d7 through a small overshoot while fading in, then settle to normal size.", duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0, { scale: .7, opacity: 0 }), key(hit * .65, { scale: 1.08 }), key(hit), key(d)]; } },
  'solid-color': { label: 'Solid color', description: "A solid color frame or normalized adjustable rectangle with editable width, height, center and opacity.", duration: 2, keyframes: d => [key(0), key(d)] },
  'cinematic-bars': { label: 'Cinematic bars', description: "Black top/bottom bars slide in, hold and slide out; size controls their fraction of frame height and speed controls entry/exit.", duration: 2, keyframes: d => cinematicBarKeyframes(d) },
  'frame-shrink': { label: 'Frame shrink', description: "Shrink the visual composition smoothly toward canvas center, hold with black space on all four sides, then return to its original framing. Size is the inset fraction per side; speed controls entrance/exit. Moves the footage itself without adding a rectangle or masking it; preserves audio and source timing.", duration: 2, keyframes: d => frameShrinkKeyframes(d) },
  'quick-zoom-in': { label: 'Quick zoom in', description: "A smooth visual push from normal framing to 1.2\u00d7 over the chosen interval.", duration: .5, keyframes: d => [key(0), key(d, { scale: 1.2 })] },
  'zoom-blur': { label: 'Zoom blur', description: "A timed radial blur pulse with editable strength and normalized blur center, fading in and out over underlying footage.", duration: .6, keyframes: d => { const fade = Math.min(.18, d / 2); return [key(0, {opacity:0}), key(fade), ...(d-fade > fade ? [key(d-fade)] : []), key(d, {opacity:0})]; } },
  'quick-zoom-out': { label: 'Quick zoom out', description: "A smooth visual pull from 1.2\u00d7 to normal framing over the chosen interval.", duration: .5, keyframes: d => [key(0, { scale: 1.2 }), key(d)] },
};
export function effectClipLabel(clip: Pick<Clip, 'effectPreset'>) { return clip.effectPreset && clip.effectPreset !== 'none' ? EFFECT_CATALOG[clip.effectPreset].label : 'Custom effect'; }
const bounds = { x: [-1, 1], y: [-1, 1], scale: [0.1, 5], rotation: [-360, 360], opacity: [0, 1], brightness: [0, 4] } as const;

export function validateClipEffects(clip: Clip) {
  validatePlaybackRate(clip);
  validateVisualEffects(clip);
  validateRemotionTextTemplate(clip);
  validateTextStyle(clip);
  validateAudioSettings(clip);
  validateTextAnimationTiming(clip);
  validateVisualFade(clip);
  validateTransitionSettings(clip);
  if (clip.zoom !== undefined) {
    if (clip.kind !== 'effect' || !isZoomPreset(clip.effectPreset)) throw new Error('Zoom controls belong to Zoom effect clips.');
    if (!['in', 'out'].includes(clip.zoom.direction) || clip.effectPreset !== `quick-zoom-${clip.zoom.direction}`) throw new Error('Choose a matching Zoom direction.');
    for (const property of Object.keys(ZOOM_LIMITS) as (keyof typeof ZOOM_LIMITS)[]) {
      const [min, max] = ZOOM_LIMITS[property], value = clip.zoom[property];
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Zoom ${property} must be between ${min} and ${max}.`);
    }
  }
  if (clip.solidColor !== undefined) {
    if (clip.kind !== 'effect' || clip.effectPreset !== 'solid-color') throw new Error('Solid color settings belong to solid color effect clips.');
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
  if (clip.kind === 'effect') {
    if (clip.assetId !== undefined || clip.linkedClipId !== undefined || clip.audioSeparated !== undefined || clip.volume !== undefined || clip.sourceStart !== 0) throw new Error('Effect clips cannot reference media or audio.');
    if (clip.blendMode !== undefined || clip.transform !== undefined || clip.crop !== undefined || clip.fit !== undefined || clip.focus !== undefined || clip.text !== undefined || clip.animation !== undefined) throw new Error('Use motion keyframes to animate an effect clip.');
  }
  if (clip.blendMode !== undefined && !BLEND_MODES.includes(clip.blendMode)) throw new Error('Choose a supported blend mode.');
  if ((clip.motion?.length || clip.blendMode) && clip.kind === 'audio') throw new Error('Visual effects cannot be applied to audio.');
  if (clip.motionOffset !== undefined && (!Number.isFinite(clip.motionOffset))) throw new Error('Invalid motion offset.');
  if (!clip.motion) return;
  if (clip.motion.length > 120) throw new Error('Use at most 120 motion keyframes per clip.');
  for (const [index, key] of clip.motion.entries()) {
    if (!Number.isFinite(key.time) || key.time < 0 || (index > 0 && key.time <= clip.motion[index - 1].time)) throw new Error('Motion keyframes need finite, increasing nonnegative times.');
    for (const property of Object.keys(bounds) as (keyof typeof bounds)[]) {
      const [min, max] = bounds[property];
      if (!Number.isFinite(key[property]) || key[property] < min || key[property] > max) throw new Error(`Motion ${property} is out of range.`);
    }
  }
}

/** Local-time keyframes travel with the clip; trims and splits retain their phase. */
export function motionAt(keys: MotionKeyframe[], time: number): MotionKeyframe {
  const after = keys.findIndex(key => key.time >= time);
  if (after <= 0) return { ...(keys[after === -1 ? keys.length - 1 : 0] ?? NEUTRAL_MOTION), time };
  const a = keys[after - 1], b = keys[after], mix = (time - a.time) / (b.time - a.time);
  const result = { ...a, time };
  for (const property of Object.keys(bounds) as (keyof typeof bounds)[]) result[property] = a[property] + (b[property] - a[property]) * mix;
  return result;
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
  const motion = preset === 'none' ? [] : zoom ? zoomKeyframes(clip.duration, zoom) : preset === 'cinematic-bars' ? cinematicBarKeyframes(clip.duration, cinematicBarSettings(clip).speed) : preset==='frame-shrink'?frameShrinkKeyframes(clip.duration,frameShrinkSettings(clip)):EFFECT_CATALOG[preset].keyframes(clip.duration);
  return { motion, motionOffset: 0, ...(clip.kind === 'effect' ? { effectPreset: preset, zoom, transition: isTransitionPreset(preset) ? clip.transition : undefined, solidColor: preset === 'solid-color' ? { ...solidColorSettings(clip) } : undefined, cinematicBars: preset === 'cinematic-bars' ? { ...cinematicBarSettings(clip) } : undefined, frameShrink:preset==='frame-shrink'?{...frameShrinkSettings(clip)}:undefined, zoomBlur: preset === 'zoom-blur' ? {...DEFAULT_ZOOM_BLUR,...clip.zoomBlur,enabled:true} : undefined } : {}), ...(clip.kind === 'caption' || clip.kind === 'graphic' ? { animation: 'none' as const,textAnimationTiming:undefined } : {}) };
}

export function offsetClipMotion(clip: Clip, delta: number): Partial<Clip> {
  return { ...(clip.motion?.length ? { motionOffset: (clip.motionOffset ?? 0) + delta } : {}), ...textTemplateTimingPatch(clip, delta),...textAnimationTimingPatch(clip,delta),...audioFadeTimingPatch(clip,delta),...visualFadeTimingPatch(clip,delta) };
}

/** Effect handles stretch the currently visible pulse, including a previously split segment. */
export function resizeEffectMotion(clip: Clip, duration: number): Partial<Clip> {
  if (isZoomPreset(clip.effectPreset) && clip.zoom) return { motion: zoomKeyframes(duration, clip.zoom), motionOffset: 0 };
  if (clip.effectPreset === 'cinematic-bars') return { motion: cinematicBarKeyframes(duration, cinematicBarSettings(clip).speed), motionOffset: 0 };
  if(clip.effectPreset==='frame-shrink')return {motion:frameShrinkKeyframes(duration,frameShrinkSettings(clip)),motionOffset:0};
  return { motion: visibleMotion(clip).map(key => ({ ...key, time: key.time / clip.duration * duration })), motionOffset: 0 };
}

/** Presets are editable starting points; requested controls never change footage or neighboring FX. */
export function configureTimedEffectPatch(clip:Clip,changes:{preset?:TimedEffectPreset;duration?:number;cinematicBars?:Partial<CinematicBarSettings>;frameShrink?:Partial<FrameShrinkSettings>;zoom?:Partial<ZoomSettings>}):Partial<Clip>{
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
  validateClipEffects({...clip,...patch});return patch;
}
