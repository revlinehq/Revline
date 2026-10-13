import type { Clip } from './types';
import { validateVisualEffects } from './visual-effects';

export const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay', 'plus-lighter'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export type MotionKeyframe = { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; brightness: number };
export const MOTION_PRESETS = ['none', 'fade', 'punch', 'shake', 'flash', 'pop'] as const;
export type MotionPreset = typeof MOTION_PRESETS[number];
export const EFFECT_PRESETS = ['fade', 'punch', 'shake', 'flash', 'pop', 'cinematic-bars'] as const;
export type EffectPreset = typeof EFFECT_PRESETS[number];
export const NEUTRAL_MOTION = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 };
const key = (time: number, changes: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, ...NEUTRAL_MOTION, ...changes });
export const EFFECT_CATALOG: Record<EffectPreset, { label: string; duration: number; keyframes: (duration: number) => MotionKeyframe[] }> = {
  fade: { label: 'Fade in / out', duration: 1, keyframes: d => { const fade = Math.min(.3, d / 3); return [key(0, { opacity: 0 }), key(fade), key(d - fade), key(d, { opacity: 0 })]; } },
  punch: { label: 'Punch zoom', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0), key(hit * .3, { scale: 1.2 }), key(hit), key(d)]; } },
  shake: { label: 'Impact shake', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0, { scale: 1.08 }), key(hit * .15, { x: .018, y: -.01, rotation: 1.2, scale: 1.08 }), key(hit * .35, { x: -.014, y: .008, rotation: -.9, scale: 1.08 }), key(hit * .6, { x: .008, y: -.004, rotation: .4, scale: 1.08 }), key(hit, { scale: 1.08 }), key(d, { scale: 1.08 })]; } },
  flash: { label: 'Flash', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0), key(hit * .2, { brightness: 3 }), key(hit), key(d)]; } },
  pop: { label: 'Pop in', duration: .5, keyframes: d => { const hit = Math.min(.35, d / 2); return [key(0, { scale: .7, opacity: 0 }), key(hit * .65, { scale: 1.08 }), key(hit), key(d)]; } },
  'cinematic-bars': { label: 'Cinematic bars', duration: 2, keyframes: d => [key(0, { opacity: 0 }), key(d * .2), key(d * .8), key(d, { opacity: 0 })] },
};
export function effectClipLabel(clip: Pick<Clip, 'effectPreset'>) { return clip.effectPreset && clip.effectPreset !== 'none' ? EFFECT_CATALOG[clip.effectPreset].label : 'Custom effect'; }
const bounds = { x: [-1, 1], y: [-1, 1], scale: [0.1, 5], rotation: [-360, 360], opacity: [0, 1], brightness: [0, 4] } as const;

export function validateClipEffects(clip: Clip) {
  validateVisualEffects(clip);
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
  if (!clip.motion?.length) return [];
  const from = clip.motionOffset ?? 0, end = from + clip.duration;
  return [motionAt(clip.motion, from), ...clip.motion.filter(key => key.time > from && key.time < end), motionAt(clip.motion, end)].map(key => ({ ...key, time: key.time - from }));
}

export function motionPreset(clip: Clip, preset: MotionPreset | EffectPreset): Partial<Clip> {
  if (preset === 'cinematic-bars' && clip.kind !== 'effect') throw new Error('Add cinematic bars as an effect clip.');
  const motion = preset === 'none' ? [] : EFFECT_CATALOG[preset].keyframes(clip.duration);
  return { motion, motionOffset: 0, ...(clip.kind === 'effect' ? { effectPreset: preset } : {}), ...(clip.kind === 'caption' || clip.kind === 'graphic' ? { animation: 'none' as const } : {}) };
}

export function offsetClipMotion(clip: Clip, delta: number): Partial<Clip> {
  return clip.motion?.length ? { motionOffset: (clip.motionOffset ?? 0) + delta } : {};
}

/** Effect handles stretch the currently visible pulse, including a previously split segment. */
export function resizeEffectMotion(clip: Clip, duration: number): Partial<Clip> {
  return { motion: visibleMotion(clip).map(key => ({ ...key, time: key.time / clip.duration * duration })), motionOffset: 0 };
}
