import { motionEase, isMotionEasing, type MotionEasing } from './motion-path';
import { VISUAL_EFFECT_DEFAULTS, VISUAL_EFFECT_LIMITS, type VisualEffects } from './visual-effects';

/**
 * Keyframes for any numeric visual-effect control ("colorGrade.saturation", "softBlur.amount",
 * "lightLeak.amount", ...). Keys are baked and linear, in the clip's path time (the same clock as
 * `motion`, so trims and splits keep effects in step with movement through `motionOffset`).
 */
export type EffectKey = { time: number; value: number };
export type EffectKeyframeLane = { control: string; keys: EffectKey[] };
export type EffectAnchor = EffectKey & { easing?: MotionEasing };

const MAX_EFFECT_LANES = 16, MAX_EFFECT_KEYS = 120;
type Group = keyof typeof VISUAL_EFFECT_LIMITS;

/** Every numeric control that can be keyframed, with its allowed range. */
export function effectControlRange(control: string): readonly [number, number] | undefined {
  const [group, key, extra] = control.split('.');
  if (extra !== undefined || !(group in VISUAL_EFFECT_LIMITS)) return undefined;
  return (VISUAL_EFFECT_LIMITS[group as Group] as Record<string, readonly [number, number]>)[key];
}
export const EFFECT_KEYFRAME_CONTROLS: readonly string[] = Object.entries(VISUAL_EFFECT_LIMITS).flatMap(([group, limits]) => Object.keys(limits).map(key => `${group}.${key}`));

export function validateEffectKeyframes(lanes: EffectKeyframeLane[] | undefined) {
  if (lanes === undefined) return;
  if (!Array.isArray(lanes) || lanes.length > MAX_EFFECT_LANES) throw new Error(`Use at most ${MAX_EFFECT_LANES} keyframed effect controls per clip.`);
  if (new Set(lanes.map(lane => lane.control)).size !== lanes.length) throw new Error('Each effect control has one keyframe lane.');
  for (const lane of lanes) {
    const range = effectControlRange(lane.control);
    if (!range) throw new Error(`${lane.control} is not a keyframeable effect control.`);
    if (!lane.keys.length || lane.keys.length > MAX_EFFECT_KEYS) throw new Error(`Use 1 to ${MAX_EFFECT_KEYS} keys for ${lane.control}.`);
    lane.keys.forEach((key, index) => {
      if (!Number.isFinite(key.time) || index > 0 && key.time <= lane.keys[index - 1].time) throw new Error(`${lane.control} keys need finite, increasing times.`);
      if (!Number.isFinite(key.value) || key.value < range[0] || key.value > range[1]) throw new Error(`${lane.control} must stay between ${range[0]} and ${range[1]}.`);
    });
  }
}

/** Value of a baked lane at a path time: linear between keys, held outside them. */
function laneValueAt(keys: EffectKey[], time: number) {
  const after = keys.findIndex(key => key.time >= time);
  if (after === -1) return keys[keys.length - 1].value;
  if (after === 0) return keys[0].value;
  const a = keys[after - 1], b = keys[after];
  return a.value + (b.value - a.value) * (time - a.time) / (b.time - a.time);
}

/** The clip's effects at a path time: keyframed controls override their static values (and enable their group). */
export function effectsAt(effects: VisualEffects, lanes: EffectKeyframeLane[] | undefined, time: number): VisualEffects {
  if (!lanes?.length) return effects;
  const next: Record<string, Record<string, unknown>> = { ...effects } as never;
  for (const lane of lanes) {
    const [group, key] = lane.control.split('.') as [Group, string];
    next[group] = { ...VISUAL_EFFECT_DEFAULTS[group as keyof typeof VISUAL_EFFECT_DEFAULTS], ...(next[group] ?? {}), enabled: true, [key]: laneValueAt(lane.keys, time) };
  }
  return next as VisualEffects;
}

/** Bake eased anchors into linear keys (up to 32 steps per curved segment, within the key budget). */
function bakeEffectAnchors(anchors: EffectAnchor[], range: readonly [number, number]): EffectKey[] {
  if (!anchors.length || anchors.length > 9) throw new Error('Use between 1 and 9 effect anchors.');
  anchors.forEach((anchor, index) => {
    if (!Number.isFinite(anchor.time) || anchor.time < 0 || index > 0 && anchor.time <= anchors[index - 1].time) throw new Error('Effect anchors need finite, increasing nonnegative times.');
    if (anchor.easing !== undefined && !isMotionEasing(anchor.easing)) throw new Error('Choose a supported easing, or a cubic-bézier [x1, y1, x2, y2].');
  });
  const curved = anchors.slice(1).filter((anchor, index) => (anchor.easing ?? 'linear') !== 'linear' && anchor.value !== anchors[index].value).length;
  const steps = curved ? Math.max(1, Math.min(32, Math.floor((MAX_EFFECT_KEYS - anchors.length) / curved))) : 1;
  const clamp = (value: number) => Math.min(range[1], Math.max(range[0], value));
  const keys: EffectKey[] = [{ time: anchors[0].time, value: clamp(anchors[0].value) }];
  for (let index = 1; index < anchors.length; index++) {
    const from = anchors[index - 1], to = anchors[index], easing = to.easing ?? 'linear';
    const count = easing === 'linear' || from.value === to.value ? 1 : steps;
    for (let step = 1; step <= count; step++) keys.push({ time: from.time + (to.time - from.time) * step / count, value: clamp(from.value + (to.value - from.value) * motionEase(step / count, easing)) });
  }
  return keys;
}

/** Move every lane by `delta` seconds of path time (used when a motion path is rebased to 0). */
export function shiftEffectKeyframes(lanes: EffectKeyframeLane[] | undefined, delta: number) {
  return lanes?.map(lane => ({ ...lane, keys: lane.keys.map(key => ({ ...key, time: key.time + delta })) }));
}

/** Set (or with `anchors: null`, remove) one control's keyframes. Anchors use clip-local seconds. */
export function effectKeyframesPatch(clip: { kind: string; duration: number; motionOffset?: number; effectKeyframes?: EffectKeyframeLane[] }, control: string, anchors: EffectAnchor[] | null) {
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Effect keyframes apply to video or image clips.');
  const range = effectControlRange(control);
  if (!range) throw new Error(`${control} is not a keyframeable effect control. Use group.control, e.g. colorGrade.saturation.`);
  const others = (clip.effectKeyframes ?? []).filter(lane => lane.control !== control);
  if (anchors === null) return { effectKeyframes: others.length ? others : undefined };
  for (const anchor of anchors) if (anchor.time < 0 || anchor.time > clip.duration + 1e-6) throw new Error('Effect keyframes must fit inside the clip, in clip-local seconds.');
  // Store in path time, the clock shared with motion, so later trims and splits keep them aligned.
  const offset = clip.motionOffset ?? 0;
  const keys = bakeEffectAnchors(anchors, range).map(key => ({ ...key, time: key.time + offset }));
  const effectKeyframes = [...others, { control, keys }];
  validateEffectKeyframes(effectKeyframes);
  return { effectKeyframes };
}
