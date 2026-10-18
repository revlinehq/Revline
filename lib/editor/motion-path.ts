/** Shared motion values, easing, sampling and evaluation for camera and object paths. */
export type MotionKeyframe = { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; brightness: number };
export const NEUTRAL_MOTION = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 };
export const MOTION_PROPERTIES = ['x', 'y', 'scale', 'rotation', 'opacity', 'brightness'] as const;
export const MOTION_EASINGS = ['linear', 'ease-in-out', 'ease-out', 'focused-spring'] as const;
export type MotionEasing = typeof MOTION_EASINGS[number];

export function motionEase(progress: number, easing: MotionEasing) {
  const p = Math.max(0, Math.min(1, progress));
  if (easing === 'focused-spring') {
    // Critically damped spring: fast response, smooth braking, no overshoot.
    // Normalize its finite window so preview/export land exactly on the target.
    return (1 - (1 + 9 * p) * Math.exp(-9 * p)) / (1 - 10 * Math.exp(-9));
  }
  return easing === 'ease-in-out' ? p * p * (3 - 2 * p) : easing === 'ease-out' ? 1 - (1 - p) ** 3 : p;
}

/** Local-time keyframes travel with the clip; trims and splits retain their phase. */
export function motionAt(keys: MotionKeyframe[], time: number): MotionKeyframe {
  const after = keys.findIndex(key => key.time >= time);
  if (after <= 0) return { ...(keys[after === -1 ? keys.length - 1 : 0] ?? NEUTRAL_MOTION), time };
  const a = keys[after - 1], b = keys[after], mix = (time - a.time) / (b.time - a.time);
  const result = { ...a, time };
  for (const property of MOTION_PROPERTIES) result[property] = a[property] + (b[property] - a[property]) * mix;
  return result;
}

export type EasedMotionAnchor = MotionKeyframe & { easing: MotionEasing };

/** Camera and object paths share one bounded, deterministic interpolation clock. */
export function sampleMotionAnchors(anchors: EasedMotionAnchor[], duration: number): MotionKeyframe[] {
  if (anchors.length < 2 || anchors.length > 9) throw new Error('Use between 2 and 9 motion anchors.');
  if (!Number.isFinite(duration) || duration < anchors.at(-1)!.time - 1e-6) throw new Error('Motion anchors must fit inside the clip.');
  for (const [index, anchor] of anchors.entries()) {
    if (!Number.isFinite(anchor.time) || anchor.time < 0 || index > 0 && anchor.time <= anchors[index - 1].time) throw new Error('Motion anchors need finite, increasing nonnegative times.');
    if (!MOTION_EASINGS.includes(anchor.easing)) throw new Error('Choose a supported motion easing.');
    if (Object.keys(NEUTRAL_MOTION).some(property => !Number.isFinite(anchor[property as keyof typeof NEUTRAL_MOTION]))) throw new Error('Motion anchor values must be finite.');
  }
  const { easing: _firstEasing, ...first } = anchors[0];
  const motion: MotionKeyframe[] = [first];
  const unchanged = (from: MotionKeyframe, to: MotionKeyframe) => MOTION_PROPERTIES.every(property => from[property] === to[property]);
  const curved = anchors.slice(1).filter((to, index) => to.easing !== 'linear' && !unchanged(anchors[index], to)).length;
  const fixed = anchors.length - 1 - curved;
  const segmentSteps = curved ? Math.min(32, Math.floor((118 - fixed) / curved)) : 1;
  for (let index = 1; index < anchors.length; index++) {
    const from = anchors[index - 1], to = anchors[index];
    // Match smooth zoom's 32 samples when possible, sharing the 120-key budget.
    const steps = to.easing === 'linear' || unchanged(from, to) ? 1 : segmentSteps;
    for (let step = 1; step <= steps; step++) {
      const progress = motionEase(step / steps, to.easing);
      const key = { time: from.time + (to.time - from.time) * step / steps, ...NEUTRAL_MOTION };
      for (const property of Object.keys(NEUTRAL_MOTION) as (keyof typeof NEUTRAL_MOTION)[]) key[property] = from[property] + (to[property] - from[property]) * progress;
      motion.push(key);
    }
  }
  if (duration > motion.at(-1)!.time + 1e-9) motion.push({ ...motion.at(-1)!, time: duration });
  return motion;
}

