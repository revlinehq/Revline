/** Shared motion values, easing, sampling and evaluation for camera and object paths. */
export type MotionKeyframe = { time: number; x: number; y: number; scale: number; rotation: number; opacity: number; brightness: number };
export const NEUTRAL_MOTION = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 };
export const MOTION_PROPERTIES = ['x', 'y', 'scale', 'rotation', 'opacity', 'brightness'] as const;
export const MOTION_EASINGS = ['linear', 'ease-in-out', 'ease-out', 'focused-spring'] as const;
export type NamedMotionEasing = typeof MOTION_EASINGS[number];
/** A CSS-style cubic-bézier [x1, y1, x2, y2]: x within 0..1, y may overshoot (-1..2) for anticipation or bounce. */
export type CubicBezier = [number, number, number, number];
export type MotionEasing = NamedMotionEasing | CubicBezier;
export const isCubicBezier = (easing: unknown): easing is CubicBezier => Array.isArray(easing) && easing.length === 4 && easing.every(Number.isFinite) && easing[0] >= 0 && easing[0] <= 1 && easing[2] >= 0 && easing[2] <= 1 && easing[1] >= -1 && easing[1] <= 2 && easing[3] >= -1 && easing[3] <= 2;
export const isMotionEasing = (easing: unknown): easing is MotionEasing => MOTION_EASINGS.includes(easing as NamedMotionEasing) || isCubicBezier(easing);

/** y for a given x on a cubic-bézier curve: Newton steps on x(t), bisection fallback. */
function cubicBezierAt([x1, y1, x2, y2]: CubicBezier, x: number) {
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (t: number, a: number, b: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  let t = x;
  for (let i = 0; i < 8; i++) { const dx = bez(t, x1, x2) - x, d = slope(t, x1, x2); if (Math.abs(dx) < 1e-7) return bez(t, y1, y2); if (Math.abs(d) < 1e-6) break; t -= dx / d; }
  let low = 0, high = 1; t = x;
  for (let i = 0; i < 40; i++) { const value = bez(t, x1, x2); if (Math.abs(value - x) < 1e-7) break; if (value < x) low = t; else high = t; t = (low + high) / 2; }
  return bez(t, y1, y2);
}

export function motionEase(progress: number, easing: MotionEasing) {
  const p = Math.max(0, Math.min(1, progress));
  if (Array.isArray(easing)) return p === 0 || p === 1 ? p : cubicBezierAt(easing, p);
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
    if (!isMotionEasing(anchor.easing)) throw new Error('Choose a supported motion easing, or a cubic-bézier [x1, y1, x2, y2] with x1/x2 in 0..1.');
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

