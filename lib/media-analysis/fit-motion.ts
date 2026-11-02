// Turns a tracked path into GSAP tweens: split it into moves where the object travels, then pick the
// GSAP ease whose curve best matches how far along the move the object is at each sampled moment.

export type TrackSample = { time: number; x: number; y: number; w: number; h: number; scale: number; rotation: number; confidence: number };
type Pose = { x: number; y: number; scale: number; rotation: number };
export type FittedMove = { start: number; end: number; duration: number; from: Pose; to: Pose; ease: string; fit: number; gsap: string };

const out = (f: (t: number) => number) => (t: number) => 1 - f(1 - t);
const inOut = (f: (t: number) => number) => (t: number) => t < .5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2;
const power = (n: number) => (t: number) => t ** n;
const expo = (t: number) => t === 0 ? 0 : 2 ** (10 * (t - 1));
const sine = (t: number) => 1 - Math.cos(t * Math.PI / 2);
const circ = (t: number) => 1 - Math.sqrt(1 - t * t);
const back = (s: number) => (t: number) => t * t * ((s + 1) * t - s);
/** GSAP's eases by their GSAP names (power1 is quad, power4 is quint). */
const EASES: Record<string, (t: number) => number> = { none: t => t };
for (const [name, f] of [['power1', power(2)], ['power2', power(3)], ['power3', power(4)], ['power4', power(5)], ['expo', expo], ['sine', sine], ['circ', circ]] as const) {
  EASES[`${name}.in`] = f; EASES[`${name}.out`] = out(f); EASES[`${name}.inOut`] = inOut(f);
}
EASES['back.out(1.7)'] = out(back(1.70158)); EASES['back.in(1.7)'] = back(1.70158); EASES['back.inOut(1.7)'] = inOut(back(1.70158 * 1.525));

/** The GSAP ease whose curve is closest to measured progress p at each share u of a move's time, and its RMS error. */
export function bestEase(points: { u: number; p: number }[]) {
  let best = { name: 'none', error: Infinity };
  for (const [name, ease] of Object.entries(EASES)) {
    const error = Math.sqrt(points.reduce((sum, point) => sum + (ease(point.u) - point.p) ** 2, 0) / points.length);
    if (error < best.error) best = { name, error };
  }
  return best;
}

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const pose = (sample: TrackSample): Pose => ({ x: Math.round(sample.x + sample.w / 2), y: Math.round(sample.y + sample.h / 2), scale: round(sample.scale), rotation: round(sample.rotation, 1) });

/** Moves in a tracked path, each with its from/to pose (box centers in source pixels), duration and best-fitting ease. */
export function fitMotion(track: TrackSample[], size: { width: number; height: number }): FittedMove[] {
  const usable = track.filter(sample => sample.confidence >= .5);
  if (usable.length < 3) return [];
  const span = Math.max(size.width, size.height);
  // How much the object changes between samples: travel as a share of the frame, plus scale and rotation.
  const change = (a: TrackSample, b: TrackSample) => { const pa = pose(a), pb = pose(b); return Math.hypot(pb.x - pa.x, pb.y - pa.y) / span + Math.abs(pb.scale - pa.scale) + Math.abs(pb.rotation - pa.rotation) / 90; };
  const steps = usable.slice(1).map((sample, index) => change(usable[index], sample));
  const moving = steps.map(step => step > .002);
  // Bridge single still samples inside a move (tracking jitter), then collect runs of movement.
  for (let index = 1; index < moving.length - 1; index++) if (!moving[index] && moving[index - 1] && moving[index + 1]) moving[index] = true;
  const moves: FittedMove[] = [];
  for (let index = 0; index < moving.length; index++) {
    if (!moving[index]) continue;
    let last = index; while (last + 1 < moving.length && moving[last + 1]) last++;
    const samples = usable.slice(index, last + 2), from = samples[0], to = samples[samples.length - 1];
    index = last;
    const total = change(from, to), duration = to.time - from.time;
    if (total < .01 || duration <= 0) continue;
    // Progress along the move at each sample, measured as the share of the straight change from start to end.
    const points = samples.map(sample => ({ u: (sample.time - from.time) / duration, p: Math.max(-.2, Math.min(1.2, 1 - change(sample, to) / total)) }));
    const best = bestEase(points);
    // A good ease match on a poorly tracked object is still a poor measurement, so fit carries the tracker's confidence across the move.
    const covered = track.filter(sample => sample.time >= from.time && sample.time <= to.time);
    const confidence = covered.reduce((sum, sample) => sum + sample.confidence, 0) / covered.length;
    const a = pose(from), b = pose(to), fields = (p: Pose) => `x: ${p.x}, y: ${p.y}${a.scale !== b.scale ? `, scale: ${p.scale}` : ''}${a.rotation !== b.rotation ? `, rotation: ${p.rotation}` : ''}`;
    moves.push({ start: round(from.time), end: round(to.time), duration: round(duration), from: a, to: b, ease: best.name, fit: round(Math.max(0, 1 - best.error) * confidence, 2), gsap: `tl.fromTo(el, { ${fields(a)} }, { ${fields(b)}, duration: ${round(duration)}, ease: '${best.name}' }, ${round(from.time)})` });
  }
  return moves;
}
