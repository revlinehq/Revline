import type { Clip } from './types';

export const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay', 'plus-lighter'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export type MotionKeyframe = { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; brightness: number };
export const MOTION_PRESETS = ['none', 'fade', 'punch', 'shake', 'flash', 'pop'] as const;
export type MotionPreset = typeof MOTION_PRESETS[number];
export const NEUTRAL_MOTION = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 };
const bounds = { x: [-1, 1], y: [-1, 1], scale: [0.1, 5], rotation: [-360, 360], opacity: [0, 1], brightness: [0, 4] } as const;

export function validateClipEffects(clip: Clip) {
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

export function motionPreset(clip: Clip, preset: MotionPreset): Partial<Clip> {
  const key = (time: number, changes: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, ...NEUTRAL_MOTION, ...changes });
  const d = clip.duration, hit = Math.min(0.35, d / 2);
  let motion: MotionKeyframe[] = [];
  if (preset === 'fade') { const fade = Math.min(0.3, d / 3); motion = [key(0, { opacity: 0 }), key(fade), key(d - fade), key(d, { opacity: 0 })]; }
  if (preset === 'punch') motion = [key(0), key(hit * 0.3, { scale: 1.2 }), key(hit), key(d)];
  if (preset === 'shake') motion = [key(0, { scale: 1.08 }), key(hit * 0.15, { x: 0.018, y: -0.01, rotation: 1.2, scale: 1.08 }), key(hit * 0.35, { x: -0.014, y: 0.008, rotation: -0.9, scale: 1.08 }), key(hit * 0.6, { x: 0.008, y: -0.004, rotation: 0.4, scale: 1.08 }), key(hit, { scale: 1.08 }), key(d, { scale: 1.08 })];
  if (preset === 'flash') motion = [key(0), key(hit * 0.2, { brightness: 3 }), key(hit), key(d)];
  if (preset === 'pop') motion = [key(0, { scale: 0.7, opacity: 0 }), key(hit * 0.65, { scale: 1.08 }), key(hit), key(d)];
  return { motion, motionOffset: 0, ...(clip.kind === 'caption' || clip.kind === 'graphic' ? { animation: 'none' as const } : {}) };
}

export function offsetClipMotion(clip: Clip, delta: number): Partial<Clip> {
  return clip.motion?.length ? { motionOffset: (clip.motionOffset ?? 0) + delta } : {};
}
