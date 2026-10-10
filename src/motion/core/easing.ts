export const easingNames = ["cinematic", "ease-out", "linear", "spring"] as const;
export type Ease = typeof easingNames[number];
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;

// Solve x(t) first: evaluating y at progress directly does not produce a Bézier easing.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const sample = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return (progress: number) => {
    if (progress <= 0 || progress >= 1) return clamp(progress);
    let low = 0; let high = 1;
    for (let i = 0; i < 16; i++) { const t = (low + high) / 2; if (sample(t, x1, x2) < progress) low = t; else high = t; }
    return sample((low + high) / 2, y1, y2);
  };
}
const cinema = cubicBezier(.76, 0, .24, 1);
const out = cubicBezier(.22, 1, .36, 1);
export function ease(progress: number, curve: Ease = "cinematic") {
  const t = clamp(progress);
  if (t === 0 || t === 1) return t;
  if (curve === "linear") return t;
  if (curve === "ease-out") return out(t);
  if (curve === "spring") return 1 - Math.exp(-7 * t) * Math.cos(10 * t);
  return cinema(t);
}
export function progress(frame: number, start: number, duration: number, curve: Ease = "cinematic") {
  return ease((frame - start) / Math.max(1, duration), curve);
}
