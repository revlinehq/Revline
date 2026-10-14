import type { Clip } from './types';
import { DEFAULT_ZOOM_BLUR, validateVisualEffects } from './visual-effects';
import { textTemplateTimingPatch, validateRemotionTextTemplate } from './remotion-text';
import { validatePlaybackRate } from './playback-rate';
import { isTransitionPreset, TRANSITION_PRESETS, validateTransitionSettings } from './clip-transitions';
import { validateTextStyle } from './text-style';
import { audioFadeTimingPatch,validateAudioSettings } from './audio-settings';
import { textAnimationTimingPatch,validateTextAnimationTiming } from './text-animation-timing';

export const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay', 'plus-lighter', 'difference'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export type MotionKeyframe = { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; brightness: number };
export const MOTION_PRESETS = ['none', 'fade', 'punch', 'shake', 'flash', 'pop'] as const;
export type MotionPreset = typeof MOTION_PRESETS[number];
export const TIMED_EFFECT_PRESETS = ['fade', 'punch', 'shake', 'flash', 'pop', 'cinematic-bars', 'quick-zoom-in', 'quick-zoom-out', 'zoom-blur', 'solid-color'] as const;
export const EFFECT_PRESETS = [...TIMED_EFFECT_PRESETS, ...TRANSITION_PRESETS] as const;
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
export const NEUTRAL_MOTION = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 };
const key = (time: number, changes: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, ...NEUTRAL_MOTION, ...changes });
export function cinematicBarSettings(clip: Pick<Clip, 'cinematicBars'>): CinematicBarSettings { return clip.cinematicBars ?? DEFAULT_CINEMATIC_BARS; }
/** Clip length controls hold/end time; speed alone controls the entrance and exit. */
export function cinematicBarKeyframes(duration: number, speed = 1): MotionKeyframe[] {
  const movement = Math.min(.4 / speed, duration / 2);
  return [key(0, { opacity: 0 }), key(movement), key(duration - movement), key(duration, { opacity: 0 })].filter((frame, index, frames) => index === 0 || frame.time > frames[index - 1].time);
}
export const EFFECT_CATALOG: Record<EffectPreset, { label: string; duration: number; keyframes: (duration: number) => MotionKeyframe[] }> = {
  crossfade: { label: 'Crossfade', duration: .6, keyframes: () => [] },
  'spin-zoom': { label: 'Spin zoom', duration: .6, keyframes: () => [] },
  'blur-dissolve': { label: 'Blur dissolve', duration: .6, keyframes: () => [] },
  fade: { label: 'Fade in / out', duration: 1, keyframes: d => { const fade = Math.min(.3, d / 3); return [key(0, { opacity: 0 }), key(fade), key(d - fade), key(d, { opacity: 0 })]; } },
  punch: { label: 'Punch zoom', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0), key(hit * .3, { scale: 1.2 }), key(hit), key(d)]; } },
  shake: { label: 'Impact shake', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0, { scale: 1.08 }), key(hit * .15, { x: .018, y: -.01, rotation: 1.2, scale: 1.08 }), key(hit * .35, { x: -.014, y: .008, rotation: -.9, scale: 1.08 }), key(hit * .6, { x: .008, y: -.004, rotation: .4, scale: 1.08 }), key(hit, { scale: 1.08 }), key(d, { scale: 1.08 })]; } },
  flash: { label: 'Flash', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0), key(hit * .2, { brightness: 3 }), key(hit), key(d)]; } },
  pop: { label: 'Pop in', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0, { scale: .7, opacity: 0 }), key(hit * .65, { scale: 1.08 }), key(hit), key(d)]; } },
  'solid-color': { label: 'Solid color', duration: 2, keyframes: d => [key(0), key(d)] },
  'cinematic-bars': { label: 'Cinematic bars', duration: 2, keyframes: d => cinematicBarKeyframes(d) },
  'quick-zoom-in': { label: 'Quick zoom in', duration: .5, keyframes: d => [key(0), key(d, { scale: 1.2 })] },
  'zoom-blur': { label: 'Zoom blur', duration: .6, keyframes: d => { const fade = Math.min(.18, d / 2); return [key(0, {opacity:0}), key(fade), ...(d-fade > fade ? [key(d-fade)] : []), key(d, {opacity:0})]; } },
  'quick-zoom-out': { label: 'Quick zoom out', duration: .5, keyframes: d => [key(0, { scale: 1.2 }), key(d)] },
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
  validateTransitionSettings(clip);
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
  if ((preset === 'cinematic-bars' || preset === 'zoom-blur' || preset === 'solid-color' || isTransitionPreset(preset)) && clip.kind !== 'effect') throw new Error('Add this preset as an effect clip.');
  if (isTransitionPreset(preset) && !clip.transition) throw new Error('Choose the two neighboring clips for this transition.');
  const motion = preset === 'none' ? [] : preset === 'cinematic-bars' ? cinematicBarKeyframes(clip.duration, cinematicBarSettings(clip).speed) : EFFECT_CATALOG[preset].keyframes(clip.duration);
  return { motion, motionOffset: 0, ...(clip.kind === 'effect' ? { effectPreset: preset, transition: isTransitionPreset(preset) ? clip.transition : undefined, solidColor: preset === 'solid-color' ? { ...solidColorSettings(clip) } : undefined, cinematicBars: preset === 'cinematic-bars' ? { ...cinematicBarSettings(clip) } : undefined, zoomBlur: preset === 'zoom-blur' ? {...DEFAULT_ZOOM_BLUR,...clip.zoomBlur,enabled:true} : undefined } : {}), ...(clip.kind === 'caption' || clip.kind === 'graphic' ? { animation: 'none' as const,textAnimationTiming:undefined } : {}) };
}

export function offsetClipMotion(clip: Clip, delta: number): Partial<Clip> {
  return { ...(clip.motion?.length ? { motionOffset: (clip.motionOffset ?? 0) + delta } : {}), ...textTemplateTimingPatch(clip, delta),...textAnimationTimingPatch(clip,delta),...audioFadeTimingPatch(clip,delta) };
}

/** Effect handles stretch the currently visible pulse, including a previously split segment. */
export function resizeEffectMotion(clip: Clip, duration: number): Partial<Clip> {
  if (clip.effectPreset === 'cinematic-bars') return { motion: cinematicBarKeyframes(duration, cinematicBarSettings(clip).speed), motionOffset: 0 };
  return { motion: visibleMotion(clip).map(key => ({ ...key, time: key.time / clip.duration * duration })), motionOffset: 0 };
}
