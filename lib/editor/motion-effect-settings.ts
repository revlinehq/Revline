import type { Clip } from './types';
import type { MotionKeyframe } from './clip-effects';

export type FlashSettings = { strength: number; attack: number; release: number };
export type PunchSettings = { amount: number; speed: number; centerX: number; centerY: number; attack?: number; release?: number };
export type ShakeSettings = { strength: number; speed: number; direction: 'both' | 'horizontal' | 'vertical' };
export type PopSettings = { startScale: number; bounce: number; speed: number };
export type MotionEffectChanges = { flash?: Partial<FlashSettings>; punch?: Partial<PunchSettings>; shake?: Partial<ShakeSettings>; pop?: Partial<PopSettings> };
const PROPERTY_EFFECT_PRESETS = ['flash', 'punch', 'shake', 'pop'] as const;
export type PropertyEffectPreset = typeof PROPERTY_EFFECT_PRESETS[number];
const SHAKE_DIRECTIONS = ['both', 'horizontal', 'vertical'] as const;
const DEFAULT_FLASH: FlashSettings = { strength: 2 / 3, attack: .1, release: .4 };
const DEFAULT_PUNCH: PunchSettings = { amount: 1.2, speed: 1, centerX: .5, centerY: .5 };
const DEFAULT_SHAKE: ShakeSettings = { strength: .5, speed: 1, direction: 'both' };
const DEFAULT_POP: PopSettings = { startScale: .7, bounce: .08, speed: 1 };
const FLASH_LIMITS = { strength: [0, 1], attack: [.01, .99], release: [.01, .99] } as const;
export const PUNCH_LIMITS = { amount: [1, 3], speed: [.25, 4], centerX: [0, 1], centerY: [0, 1], attack: [.01, 30], release: [.01, 30] } as const;
const SHAKE_LIMITS = { strength: [0, 1], speed: [.25, 4] } as const;
const POP_LIMITS = { startScale: [.1, 1], bounce: [0, .5], speed: [.25, 4] } as const;
export function isPropertyEffectPreset(preset: unknown): preset is PropertyEffectPreset { return PROPERTY_EFFECT_PRESETS.includes(preset as PropertyEffectPreset); }
const key = (time: number, changes: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ time, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, ...changes });
const unique = (keys: MotionKeyframe[]) => keys.filter((frame, index) => !index || frame.time > keys[index - 1].time);

export function flashSettings(clip: Clip): FlashSettings {
  if (clip.flash) return clip.flash;
  if (clip.effectPreset !== 'flash' || !clip.motion?.length) return DEFAULT_FLASH;
  const peak = clip.motion.reduce((a, b) => a.brightness >= b.brightness ? a : b), offset = clip.motionOffset ?? 0;
  const end = clip.motion.find(frame => frame.time > peak.time && frame.brightness <= 1);
  const attack = Math.min(.99, Math.max(.01, (peak.time - offset) / clip.duration));
  return { strength: Math.min(1, Math.max(0, (peak.brightness - 1) / 3)), attack, release: Math.min(1 - attack, Math.max(.01, ((end?.time ?? clip.duration + offset) - peak.time) / clip.duration)) };
}
export function punchSettings(clip: Clip): PunchSettings {
  if (clip.punch) return clip.punch;
  if (clip.effectPreset !== 'punch' || !clip.motion?.length) return DEFAULT_PUNCH;
  const peak = clip.motion.reduce((a, b) => a.scale >= b.scale ? a : b);
  const end = clip.motion.find(frame => frame.time > peak.time && frame.scale <= 1);
  const amount = Math.max(1, Math.min(3, peak.scale));
  return { amount, speed: 1, centerX: amount > 1 ? Math.max(0, Math.min(1, .5 - peak.x / (amount - 1))) : .5, centerY: amount > 1 ? Math.max(0, Math.min(1, .5 - peak.y / (amount - 1))) : .5, attack: Math.max(.01, Math.min(30, peak.time)), release: Math.max(.01, Math.min(30, (end?.time ?? clip.motion.at(-1)!.time) - peak.time)) };
}
/** Optional seconds use the old speed multiplier; omitted timings preserve the legacy pulse exactly. */
function punchDurations(duration: number, settings: PunchSettings) {
  const legacy = Math.min(.35, duration / 2);
  if (settings.attack === undefined && settings.release === undefined) {
    const end = Math.min(duration, legacy / settings.speed), attack = end * .3;
    return { attack, release: end - attack, end };
  }
  const attack = (settings.attack ?? legacy * .3) / settings.speed, release = (settings.release ?? legacy * .7) / settings.speed;
  const fit = Math.min(1, duration / (attack + release));
  return { attack: attack * fit, release: release * fit, end: (attack + release) * fit };
}
export function shakeSettings(clip: Clip): ShakeSettings { return clip.shake ?? DEFAULT_SHAKE; }
export function popSettings(clip: Clip): PopSettings { return clip.pop ?? DEFAULT_POP; }
export function flashKeyframes(duration: number, settings: FlashSettings = DEFAULT_FLASH): MotionKeyframe[] {
  return unique([key(0), key(duration * settings.attack, { brightness: 1 + 3 * settings.strength }), key(duration * (settings.attack + settings.release)), key(duration)]);
}
export function punchKeyframes(duration: number, settings: PunchSettings = DEFAULT_PUNCH): MotionKeyframe[] {
  const timing = punchDurations(duration, settings);
  return unique([key(0), key(timing.attack, { scale: settings.amount, x: (.5 - settings.centerX) * (settings.amount - 1), y: (.5 - settings.centerY) * (settings.amount - 1) }), key(timing.end), key(duration)]);
}
export function popKeyframes(duration: number, settings: PopSettings = DEFAULT_POP): MotionKeyframe[] {
  const hit = Math.min(duration, Math.min(.35, duration / 2) / settings.speed);
  return unique([key(0, { scale: settings.startScale, opacity: 0 }), key(hit * .65, { scale: 1 + settings.bounce }), key(hit), key(duration)]);
}
export function shakeKeyframes(duration: number, settings: ShakeSettings = DEFAULT_SHAKE): MotionKeyframe[] {
  const steps = Math.min(119, Math.max(4, Math.ceil(duration * 12 * settings.speed * 4))), frequency = Math.min(12 * settings.speed, steps / duration / 4), edge = Math.min(.08, duration / 4);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const time = duration * index / steps;
    if (index === 0 || index === steps) return key(time);
    const envelope = Math.min(1, time / edge, (duration - time) / edge), amount = 2 * settings.strength * envelope, phase = time * frequency * 2 * Math.PI;
    return key(time, { x: settings.direction === 'vertical' ? 0 : .018 * amount * Math.sin(phase), y: settings.direction === 'horizontal' ? 0 : .01 * amount * Math.sin(phase * 1.7), rotation: settings.direction === 'both' ? 1.2 * amount * Math.sin(phase * 1.3) : 0, scale: 1 + .08 * amount });
  });
}

export function propertyEffectMotion(clip: Clip, duration = clip.duration): MotionKeyframe[] | undefined {
  if (clip.effectPreset === 'flash') return flashKeyframes(duration, flashSettings(clip));
  if (clip.effectPreset === 'punch') return punchKeyframes(duration, punchSettings(clip));
  if (clip.effectPreset === 'shake') return shakeKeyframes(duration, shakeSettings(clip));
  if (clip.effectPreset === 'pop') return popKeyframes(duration, popSettings(clip));
}
export function motionEffectPatch(clip: Clip, changes: MotionEffectChanges): Partial<Clip> {
  let next = clip;
  for (const preset of PROPERTY_EFFECT_PRESETS) {
    const update = changes[preset];
    if (!update) continue;
    if (clip.kind !== 'effect' || clip.effectPreset !== preset) throw new Error(`${preset} controls belong to that effect clip.`);
    if (!Object.values(update).some(value => value !== undefined)) throw new Error(`Specify a ${preset} control.`);
    const settings = preset === 'flash' ? flashSettings(clip) : preset === 'punch' ? punchSettings(clip) : preset === 'shake' ? shakeSettings(clip) : popSettings(clip);
    next = { ...next, [preset]: { ...settings, ...update } };
  }
  return { ...changes.flash && { flash: next.flash }, ...changes.punch && { punch: next.punch }, ...changes.shake && { shake: next.shake }, ...changes.pop && { pop: next.pop }, motion: propertyEffectMotion(next), motionOffset: 0 };
}
export function validateMotionEffectSettings(clip: Clip) {
  for (const preset of PROPERTY_EFFECT_PRESETS) {
    const settings = clip[preset];
    if (!settings) continue;
    if (clip.kind !== 'effect' || clip.effectPreset !== preset) throw new Error(`${preset} controls belong to that effect clip.`);
    const limits = preset === 'flash' ? FLASH_LIMITS : preset === 'punch' ? PUNCH_LIMITS : preset === 'shake' ? SHAKE_LIMITS : POP_LIMITS;
    for (const [property, [min, max]] of Object.entries(limits)) {
      const value = (settings as unknown as Record<string, unknown>)[property];
      if (preset === 'punch' && (property === 'attack' || property === 'release') && value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${preset} ${property} must be between ${min} and ${max}.`);
    }
    if (preset === 'flash' && clip.flash!.attack + clip.flash!.release > 1 + 1e-6) throw new Error('Flash attack and release must fit within its duration.');
    if (preset === 'shake' && !SHAKE_DIRECTIONS.includes(clip.shake!.direction)) throw new Error('Choose both, horizontal or vertical shake.');
  }
}
