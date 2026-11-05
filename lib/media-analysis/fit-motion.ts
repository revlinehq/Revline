// Fit timing and signed progress together, including the holds on either side of a move.
export type TrackSample = { time: number; x: number; y: number; w: number; h: number; scale: number; scaleX?: number; scaleY?: number; corners?: number[][]; registrationBox?: { x: number; y: number; w: number; h: number }; rotation: number; confidence: number; visible?: boolean; opacity?: number; opacityConfidence?: number; sharpness?: number };
type Pose = { x: number; y: number; scale: number; scaleX?: number; scaleY?: number; rotation: number; opacity?: number };
export type FittedMove = { start: number; end: number; duration: number; from: Pose; to: Pose; ease: string; fit: number; gsap: string };
type Curve = { name: string; at: (t: number, extra: number[]) => number; initial: number[]; bounds: [number, number][] };
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const round = (v: number, n = 6) => Math.round(v * 10 ** n) / 10 ** n;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const curves: Curve[] = [{ name: 'none', at: t => t, initial: [], bounds: [] }];
for (const base of ['power1', 'power2', 'power3', 'power4', 'expo', 'circ', 'sine', 'back']) for (const direction of ['in', 'out', 'inOut']) {
  const inside = (t: number, extra: number[]) => {
    if (base.startsWith('power')) return t ** (Number(base.slice(-1)) + 1);
    // GSAP blends Expo at its endpoint (see the installed gsap-core), rather than raw 2**t.
    if (base === 'expo') return 2 ** (10 * (t - 1)) * t + t ** 6 * (1 - t);
    if (base === 'circ') return 1 - Math.sqrt(Math.max(0, 1 - t * t));
    if (base === 'sine') return 1 - Math.cos(t * Math.PI / 2);
    const s = extra[0];
    return t * t * ((s + 1) * t - s);
  };
  curves.push({ name: `${base}.${direction}`, at: (t, extra) => t === 0 || t === 1 ? t : direction === 'in' ? inside(t, extra) : direction === 'out' ? 1 - inside(1 - t, extra) : t < .5 ? inside(t * 2, extra) / 2 : 1 - inside(2 - t * 2, extra) / 2, initial: base === 'back' ? [1.70158] : [], bounds: base === 'back' ? [[0, 6]] : [] });
}
const cubic: Curve = { name: 'cubic-bezier', initial: [.25, .1, .75, .9], bounds: [[0, 1], [-2, 3], [0, 1], [-2, 3]], at: (x, [x1, y1, x2, y2]) => {
  if (x === 0 || x === 1) return x;
  const b = (t: number, a: number, c: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * c + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (b(mid, x1, x2) < x) low = mid; else high = mid; }
  return b((low + high) / 2, y1, y2);
} };
const curveName = (curve: Curve, extra: number[]) => curve.name === 'cubic-bezier' ? `cubic-bezier(${extra.map(v => round(v, 5)).join(',')})` : curve.name.startsWith('back') ? `${curve.name}(${round(extra[0], 5)})` : curve.name;
/** Use a CustomEase expression for measured Beziers; named GSAP eases stay strings. */
export function gsapEase(name: string) {
  if (!name.startsWith('cubic-bezier(')) return `'${name}'`;
  const [x1, y1, x2, y2] = name.slice(13, -1).split(',');
  return `CustomEase.create("measured", "M0,0 C${x1},${y1} ${x2},${y2} 1,1")`;
}
/** Bounded Nelder–Mead; offsets and amplitudes are solved analytically outside this search. */
function minimize(fn: (p: number[]) => number, seed: number[], bounds: [number, number][], steps: number[], iterations = 240) {
  const point = (p: number[]) => { const q = p.map((v, i) => clamp(v, ...bounds[i])); return { p: q, error: fn(q) }; };
  let simplex = [point(seed), ...seed.map((_, i) => point(seed.map((v, j) => v + (i === j ? steps[j] : 0))))];
  for (let k = 0; k < iterations; k++) {
    simplex.sort((a, b) => a.error - b.error);
    if (k > 25 && Math.max(...simplex.slice(1).map(p => Math.max(...p.p.map((v, i) => Math.abs(v - simplex[0].p[i]) / (bounds[i][1] - bounds[i][0]))))) < 1e-7) break;
    const worst = simplex[seed.length], center = seed.map((_, i) => simplex.slice(0, -1).reduce((s, p) => s + p.p[i], 0) / seed.length);
    const reflected = point(center.map((v, i) => 2 * v - worst.p[i]));
    if (reflected.error < simplex[0].error) {
      const expanded = point(center.map((v, i) => v + 2 * (reflected.p[i] - v)));
      simplex[seed.length] = expanded.error < reflected.error ? expanded : reflected;
    } else if (reflected.error < simplex[seed.length - 1].error) simplex[seed.length] = reflected;
    else {
      const outside = reflected.error < worst.error, target = outside ? reflected : worst;
      const contracted = point(center.map((v, i) => v + .5 * (target.p[i] - v)));
      if (contracted.error < (outside ? reflected.error : worst.error)) simplex[seed.length] = contracted;
      else simplex = [simplex[0], ...simplex.slice(1).map(p => point(p.p.map((v, i) => (v + simplex[0].p[i]) / 2)))];
    }
  }
  return simplex.sort((a, b) => a.error - b.error)[0];
}
function regression(xs: number[], ys: number[]) {
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let cov = 0, variance = 0;
  xs.forEach((x, i) => { cov += (x - mx) * (ys[i] - my); variance += (x - mx) ** 2; });
  const amplitude = variance > 1e-10 ? cov / variance : 0, offset = my - amplitude * mx;
  const error = ys.reduce((s, y, i) => s + (y - offset - amplitude * xs[i]) ** 2, 0) / ys.length;
  return { offset, amplitude, error };
}
/** Closest named ease for callers that already have normalized time/progress (transitions). */
export function bestEase(points: { u: number; p: number }[]) {
  let best = { name: 'none', error: Infinity };
  for (const curve of curves) {
    const error = (extra: number[]) => points.reduce((s, p) => s + (curve.at(clamp(p.u), extra) - p.p) ** 2, 0) / Math.max(1, points.length);
    const found = curve.initial.length ? minimize(error, curve.initial, curve.bounds, [.2], 80) : { p: [], error: error([]) };
    if (found.error < best.error ** 2) best = { name: curveName(curve, found.p), error: Math.sqrt(found.error) };
  }
  return best;
}
function jointFit(times: number[], values: number[]) {
  const first = times[0], span = times.at(-1)! - first, dt = median(times.slice(1).map((t, i) => t - times[i]));
  const lo = Math.min(...values), range = Math.max(...values) - lo;
  if (!range || span <= 0) return null;
  const ys = values.map(v => (v - lo) / range), ts = times.map(t => (t - first) / span), minimum = Math.min(.5, dt / span);
  const solve = (curve: Curve, p: number[]) => regression(ts.map(t => curve.at(clamp((t - p[0]) / p[1]), p.slice(2))), ys);
  const search = (curve: Curve, seed?: number[]) => {
    const bounds: [number, number][] = [[0, 1 - minimum], [minimum, 1.5], ...curve.bounds];
    const error = (p: number[]) => p[0] + p[1] > 1 + minimum ? 10 + p[0] + p[1] : solve(curve, p).error;
    const starts = seed ? [seed] : [[0, .9], [.15, .6], [.35, .5]].map(p => [...p, ...curve.initial]);
    return starts.map(p => minimize(error, p, bounds, [.04, .08, ...curve.initial.map(() => .2)], curve === cubic ? 450 : 220)).sort((a, b) => a.error - b.error)[0];
  };
  let best = { curve: curves[0], ...search(curves[0]) };
  for (const curve of curves.slice(1)) { const result = search(curve); if (result.error < best.error - 1e-10) best = { curve, ...result }; }
  const namedError = Math.sqrt(best.error);
  if (Math.sqrt(best.error) > .008) {
    const result = search(cubic, [...best.p.slice(0, 2), ...cubic.initial]);
    if (result.error < best.error * .8) best = { curve: cubic, ...result };
  }
  const progress = ts.map(t => best.curve.at(clamp((t - best.p[0]) / best.p[1]), best.p.slice(2)));
  return { start: first + best.p[0] * span, end: first + (best.p[0] + best.p[1]) * span, ease: curveName(best.curve, best.p.slice(2)), error: Math.sqrt(best.error), namedError, progress };
}
const pose = (s: TrackSample): Pose => {
  const box = s.registrationBox ?? s;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, scale: s.scale, scaleX: s.scaleX ?? s.scale, scaleY: s.scaleY ?? s.scale, rotation: s.rotation };
};
function fitRun(samples: TrackSample[], span: number, opacity: boolean, depth = 0, channel?: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation'): FittedMove[] {
  if (samples.length < 5) return [];
  const axes = samples.some(s => s.scaleX !== undefined && s.scaleY !== undefined && Math.abs(s.scaleX - s.scaleY) > .01);
  if (axes && !opacity && !channel) return (['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const).flatMap(field => fitRun(samples, span, false, depth, field));
  const fields = channel ? [channel] : opacity ? ['opacity'] as const : ['x', 'y', 'scale', 'rotation'] as const;
  const poses = samples.map(s => opacity ? { opacity: s.opacity! } : pose(s));
  const channels = fields.map(field => poses.map(p => (p as Record<string, number>)[field]));
  const ranges = channels.map(v => Math.max(...v) - Math.min(...v));
  const weights = channel ? [channel === 'x' || channel === 'y' ? 1 / span : channel === 'rotation' ? 1 / 90 : 1] : opacity ? [1] : [1 / span, 1 / span, 1, 1 / 90];
  const dominant = ranges.map((v, i) => v * weights[i]).reduce((best, v, i, all) => v > all[best] ? i : best, 0);
  if (ranges[dominant] * weights[dominant] < (opacity ? .02 : .002)) return [];
  const times = samples.map(s => s.time), values = channels[dominant], fit = jointFit(times, values);
  if (!fit) return [];
  // Try separate moves only after the full signed curve fails. An overshoot is never split at its turn.
  if (fit.namedError > .035 && depth < 6 && samples.length >= 15) {
    const range = ranges[dominant], window = Math.max(5, Math.round(.25 / median(times.slice(1).map((t, i) => t - times[i]))));
    const holds: { first: number; last: number }[] = [];
    for (let i = window; i < values.length - window * 2; i++) {
      const hold = values.slice(i, i + window), level = median(hold);
      if (Math.max(...hold) - Math.min(...hold) > range * .004) continue;
      if (Math.max(...values.slice(0, i).map(v => Math.abs(v - level))) < range * .1 || Math.max(...values.slice(i + window).map(v => Math.abs(v - level))) < range * .1) continue;
      const previous = holds.at(-1);
      if (previous && i <= previous.last) previous.last = i + window;
      else holds.push({ first: i, last: i + window });
    }
    const hold = holds.sort((a, b) => (b.last - b.first) - (a.last - a.first))[0];
    if (hold) {
      // Keep the entire easing tail and some hold on both sides of the split.
      const split = Math.floor((hold.first + hold.last) / 2);
      return [...fitRun(samples.slice(0, split + 1), span, opacity, depth + 1, channel), ...fitRun(samples.slice(split), span, opacity, depth + 1, channel)];
    }
  }
  // A box can reverse direction while its independent dimensions continue growing.
  // Keep measured segments when one easing curve cannot describe that channel.
  if (channel && fit.error > .015 && depth < 6 && samples.length >= 10) {
    const split = Math.floor(samples.length / 2);
    return [...fitRun(samples.slice(0, split + 1), span, opacity, depth + 1, channel), ...fitRun(samples.slice(split), span, opacity, depth + 1, channel)];
  }
  // Very poor tracks do not become authoritative tweens.
  if (fit.error > .12) return [];
  const a: Record<string, number> = {}, b: Record<string, number> = {};
  channels.forEach((v, i) => { const reg = regression(fit.progress, v); a[fields[i]] = round(reg.offset); b[fields[i]] = round(reg.offset + reg.amplitude); });
  const confidence = samples.reduce((s, p) => s + (opacity ? p.opacityConfidence ?? 0 : p.confidence), 0) / samples.length;
  const start = round(fit.start), end = round(fit.end), duration = round(end - start);
  const text = (p: Record<string, number>) => fields.filter((f, i) => opacity || f === 'x' || f === 'y' || Math.abs(b[f] - a[f]) * weights[i] >= .001).map(f => `${f}: ${p[f]}`).join(', ');
  const from = opacity ? { ...pose(samples[0]), opacity: a.opacity } : { ...pose(samples[0]), ...a }, to = opacity ? { ...pose(samples.at(-1)!), opacity: b.opacity } : { ...pose(samples.at(-1)!), ...b };
  return [{ start, end, duration, from, to, ease: fit.ease, fit: round((1 - fit.error) * confidence, 3), gsap: `tl.fromTo(el, { ${text(a)} }, { ${text(b)}, duration: ${duration}, ease: ${gsapEase(fit.ease)} }, ${start})` }];
}
/** All callers share this fitter. Confidence gaps split runs; invisible geometry never joins two moves. */
export function fitMotion(track: TrackSample[], size: { width: number; height: number }): FittedMove[] {
  const moves: FittedMove[] = [], dt = track.length > 1 ? median(track.slice(1).map((s, i) => s.time - track[i].time)) : 0;
  for (const opacity of [false, true]) {
    let run: TrackSample[] = [];
    const flush = () => { moves.push(...fitRun(run, Math.max(size.width, size.height), opacity)); run = []; };
    for (const sample of track) {
      const usable = opacity ? sample.opacity !== undefined && (sample.opacityConfidence ?? 0) >= .5 : sample.visible !== false && sample.confidence >= .5;
      if (!usable || run.length && sample.time - run.at(-1)!.time > dt * 1.6) flush();
      if (usable) run.push(sample);
    }
    flush();
  }
  return moves.sort((a, b) => a.start - b.start);
}
