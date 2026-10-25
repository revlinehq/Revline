// Deterministic synthesis primitives for designed and generated sound effects. Stereo signals are
// [left, right] Float64Arrays at SR. Ported from cstack's skills/animated-video/templates/remotion-film/audio/dsp.py
// and parts/audio/designed.py (https://github.com/goodnight000/cstack), MIT License, Copyright (c) 2026 Charles Zheng.
// The full MIT notice is reproduced in scripts/author-library-audio.mjs and assets/audio-fx/LICENSE-Revline-designed.txt.
// Only erasable TypeScript syntax: Node scripts import this file directly.

export const SR = 48000, TAU = 2 * Math.PI;
export type Mono = Float64Array;
export type Stereo = [Float64Array, Float64Array];

const SEMIS: Record<string, number> = { C: 0, Db: 1, 'C#': 1, D: 2, Eb: 3, 'D#': 3, E: 4, F: 5, Gb: 6, 'F#': 6, G: 7, Ab: 8, 'G#': 8, A: 9, Bb: 10, 'A#': 10, B: 11 };
/** 'Ab3' -> frequency; a number passes through. */
export function hz(note: string | number): number {
  if (typeof note === 'number') return note;
  const match = /^([A-G](?:b|#)?)(-?\d)$/.exec(note);
  if (!match || SEMIS[match[1]] === undefined) throw new Error(`Unknown note "${note}". Use a name like F5 or a frequency in Hz.`);
  return 440 * 2 ** ((SEMIS[match[1]] + (Number(match[2]) - 4) * 12 - 9) / 12);
}
export const secs = (d: number) => Float64Array.from({ length: Math.round(d * SR) }, (_, i) => i / SR);
/** Deterministic uniform [0, 1) stream (xorshift32). */
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + .5) / 4294967296; };
}
/** Seeded standard-normal noise. */
export function noise(n: number, seed: number): Mono {
  const u = rng(seed), out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(-2 * Math.log(u())) * Math.cos(TAU * u());
  return out;
}
/** Seeded pink noise (Paul Kellet's filter), scaled near unit variance. */
export function pink(n: number, seed: number): Mono {
  const white = noise(n, seed), out = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = white[i];
    b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .2; b6 = w * .115926;
  }
  return out;
}

type FilterKind = 'low' | 'high' | 'band';
function coefficients(fc: number, kind: FilterKind, q: number) {
  fc = Math.min(Math.max(fc, 12), SR * .47);
  const w = TAU * fc / SR, c = Math.cos(w), a = Math.sin(w) / (2 * q), a0 = 1 + a;
  const b = kind === 'low' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : kind === 'high' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [a, 0, -a];
  return [b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - a) / a0] as const;
}
/** One second-order section (bilinear transform with prewarping; Q 1/√2 is Butterworth, as scipy's butter(2, ...)). */
export function biquad(x: Mono, fc: number, kind: FilterKind, q = Math.SQRT1_2): Mono {
  const [b0, b1, b2, a1, a2] = coefficients(fc, kind, q), y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
/** A biquad whose cutoff follows a per-sample curve; coefficients update every 16 samples. */
export function sweptBiquad(x: Mono, fc: (i: number) => number, kind: FilterKind, q = Math.SQRT1_2): Mono {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, k = coefficients(fc(0), kind, q);
  for (let i = 0; i < x.length; i++) {
    if (i % 16 === 0) k = coefficients(fc(i), kind, q);
    const v = k[0] * x[i] + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const cascade = (x: Mono, fc: number, kind: FilterKind, order: number) => { for (let i = 0; i < Math.max(1, order / 2); i++) x = biquad(x, fc, kind); return x; };
export const lp = (x: Mono, fc: number, order = 2) => cascade(x, fc, 'low', order);
export const hp = (x: Mono, fc: number, order = 2) => cascade(x, fc, 'high', order);
export const bp = (x: Mono, lo: number, hi: number, order = 2) => lp(hp(x, lo, order), hi, order);
export const each = (x: Mono, f: (v: number, i: number) => number) => Float64Array.from(x, f);
export const both = (s: Stereo, f: (c: Mono, ch: number) => Mono): Stereo => [f(s[0], 0), f(s[1], 1)];

/** Raised-cosine fade in over a seconds and out over r seconds. */
export function fade(x: Mono, a = .005, r = .02): Mono {
  x = Float64Array.from(x);
  const na = Math.min(x.length, Math.trunc(a * SR)), nr = Math.min(x.length, Math.trunc(r * SR)), ramp = (i: number, n: number) => .5 - .5 * Math.cos(Math.PI * (n > 1 ? i / (n - 1) : 0));
  for (let i = 0; i < na; i++) x[i] *= ramp(i, na);
  for (let i = 0; i < nr; i++) x[x.length - 1 - i] *= ramp(i, nr);
  return x;
}
export const fadeS = (s: Stereo, a = .005, r = .02): Stereo => both(s, c => fade(c, a, r));
/** Soft clip toward ±1. */
export const soft = (x: Mono, drive = 1) => each(x, v => Math.tanh(v * drive) / Math.tanh(drive));
/** Mono -> stereo with equal-power pan p in -1..1. */
export function stereo(m: Mono, p = 0): Stereo {
  const a = (Math.min(Math.max(p, -1), 1) + 1) * Math.PI / 4;
  return [each(m, v => v * Math.cos(a)), each(m, v => v * Math.sin(a))];
}
export const gain = (s: Stereo, g: number): Stereo => both(s, c => each(c, v => v * g));
export const silence = (seconds: number): Stereo => [new Float64Array(Math.round(seconds * SR)), new Float64Array(Math.round(seconds * SR))];
/** Mix x into buf starting at `at` seconds, clipped to the buffer. */
export function put(buf: Stereo, x: Stereo, at: number, g = 1) {
  let offset = Math.round(at * SR), skip = 0;
  if (offset < 0) { skip = -offset; offset = 0; }
  const n = Math.min(x[0].length - skip, buf[0].length - offset);
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < n; i++) buf[ch][offset + i] += x[ch][skip + i] * g;
}
/** Phase of a tone gliding f0 -> f1 (exponential in pitch) over dur seconds, and its time axis. */
export function sweep(f0: number, f1: number, dur: number, shape = 1) {
  const t = secs(dur), ph = new Float64Array(t.length);
  let acc = 0;
  for (let i = 0; i < t.length; i++) { acc += f0 * (f1 / f0) ** ((t[i] / dur) ** shape); ph[i] = TAU * acc / SR; }
  return { ph, t };
}

function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? TAU : -TAU) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr]; }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function convolve(x: Mono, h: Mono): Mono {
  let n = 1;
  while (n < x.length + h.length - 1) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(x); br.set(h); fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] - ai[i] * bi[i]; ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; }
  fft(ar, ai, true);
  return ar.subarray(0, x.length + h.length - 1);
}
export type ReverbOptions = { decay?: number; wet?: number; bright?: number; seed?: number; pre?: number; dry?: number };
/** Convolution reverb with a synthetic impulse: decaying, low-passed, decorrelated noise. Adds a decay * 1.6 s tail. */
export function reverb(x: Stereo, { decay = 3, wet = .3, bright = 5000, seed = 7, pre = .02, dry = 1 }: ReverbOptions = {}): Stereo {
  const n = Math.trunc(decay * 1.6 * SR), ramp = Math.trunc(.004 * SR);
  const ir = [seed, seed + 1].map(s => { const y = lp(each(noise(n, s), (v, i) => v * Math.exp(-6.9 * i / SR / decay)), bright); for (let i = 0; i < ramp; i++) y[i] *= i / (ramp - 1); return y; });
  const norm = ir.reduce((sum, c) => sum + Math.sqrt(c.reduce((e, v) => e + v * v, 0)), 0) / 2, offset = Math.trunc(pre * SR);
  return both(x, (c, ch) => { const out = new Float64Array(c.length + n + offset), tail = convolve(c, ir[ch]); for (let i = 0; i < c.length; i++) out[i] += c[i] * dry; for (let i = 0; i < tail.length; i++) out[offset + i] += tail[i] / norm * wet; return out; });
}
/** Ping-pong delay; each repeat is darker. Adds taps * time seconds. */
export function echo(x: Stereo, time: number, { feedback = .35, wet = .4, taps = 6, cut = 3500 } = {}): Stereo {
  const d = Math.trunc(time * SR), out = silence((x[0].length + d * taps) / SR);
  put(out, x, 0);
  let tap: Stereo = x;
  for (let i = 1; i <= taps; i++) { tap = gain([lp(tap[1], cut), lp(tap[0], cut)], i > 1 ? feedback : wet); put(out, tap, d * i / SR); }
  return out;
}
export const peakOf = (s: Stereo) => { let p = 0; for (const c of s) for (const v of c) p = Math.max(p, Math.abs(v)); return p; };
