import { z } from 'zod';
import { SR, TAU, type Mono, type Stereo, both, bp, each, fade, fadeS, gain, hp, hz, lp, noise, put, reverb, rng, secs, silence, soft, stereo, sweep } from './dsp';

// Named sound designs ported from cstack's MIT designed.py (see ./dsp.ts). Each renders a stereo buffer
// from validated parameters; recipes place, filter and mix them. Durations are seconds, notes are names like
// 'F5' or frequencies in Hz.

const note = z.union([z.string().regex(/^[A-G](?:b|#)?-?\d$/), z.number().min(20).max(16000)]);
const seconds = (min: number, max: number) => z.number().min(min).max(max);
const seed = z.number().int().min(0).max(1_000_000);
const pan = z.number().min(-1).max(1);

const cumsum = (x: Mono) => { const out = new Float64Array(x.length); let acc = 0; for (let i = 0; i < x.length; i++) { acc += x[i]; out[i] = acc; } return out; };
const stereoNoise = (n: number, s: number): Stereo => [noise(n, s), noise(n, s + 1)];
/** A sweep f0 -> f1 over head seconds, then held at f1 until dur. */
function glide(f0: number, f1: number, head: number, dur: number, shape = 1) {
  const first = sweep(f0, f1, head, shape), t = secs(dur), ph = new Float64Array(t.length);
  ph.set(first.ph.subarray(0, t.length));
  for (let i = first.ph.length; i < t.length; i++) ph[i] = first.ph[first.ph.length - 1] + TAU * f1 * (i - first.ph.length) / SR;
  return { ph, t };
}
const normal = (u: () => number) => Math.sqrt(-2 * Math.log(u())) * Math.cos(TAU * u());
const hold = (n: number, every: number, value: () => number) => { const out = new Float64Array(n); let v = 0; for (let i = 0; i < n; i++) { if (i % every === 0) v = value(); out[i] = v; } return out; };

function subDrop({ duration = 2.2 }) {
  const { ph, t } = glide(120, 36, .5, duration), crack = lp(noise(t.length, 11), 700);
  const y = each(ph, (p, i) => (Math.sin(p) + .4 * Math.sin(2 * p) + .18 * Math.sin(3 * p)) * Math.exp(-t[i] / .55) + crack[i] * Math.exp(-t[i] / .12) * .7);
  return reverb(stereo(soft(fade(y, .002, .2), 1.5)), { decay: 1.8, wet: .15, bright: 1800 });
}
function thud({ frequency = 70, duration = .5 }) {
  const { ph, t } = glide(frequency * 2.6, frequency, .06, duration), click = hp(lp(noise(t.length, 12), 3000), 500);
  return stereo(fade(soft(each(ph, (p, i) => (Math.sin(p) + .35 * Math.sin(2 * p)) * Math.exp(-t[i] / .11) + click[i] * Math.exp(-t[i] / .012) * .5), 1.3), .001, .05));
}
function whoosh({ duration = .6, low = 300, high = 5000, panFrom = -.7, panTo = .7, seed: s = 3, peak = .55 }): Stereo {
  const n = Math.trunc(duration * SR), src = noise(n, s), bands = [0, 1, 2, 3].map(i => low * (high / low) ** (i / 3)).map(m => bp(src, m * .6, m * 1.6));
  const left = new Float64Array(n), right = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / SR / duration, env = Math.sin(Math.PI * Math.min(Math.max(x, 0), 1)) ** 2 * Math.exp(-Math.max(0, x - peak) * 2.5), pos = Math.sin(Math.PI * x) * 3;
    const y = bands.reduce((sum, band, k) => sum + band[i] * Math.min(Math.max(1 - Math.abs(pos - k), 0), 1), 0), a = (panFrom + (panTo - panFrom) * x + 1) * Math.PI / 4;
    left[i] = y * env * Math.cos(a); right[i] = y * env * Math.sin(a);
  }
  return [fade(left, .01, .03), fade(right, .01, .03)];
}
function riser({ duration = 1.6, from = 'F3' as string | number, to = 'F5' as string | number, seed: s = 4 }) {
  const { ph, t } = sweep(hz(from), hz(to), duration, 1.6), x = each(t, v => v / duration), rate = cumsum(each(x, v => 4 + 22 * v * v));
  const tone = stereo(each(ph, (p, i) => (Math.sin(p) + .5 * Math.sin(2 * p) + .25 * Math.sin(3 * p)) * (.6 + .4 * Math.sin(TAU * rate[i] / SR)) * x[i] ** 2)), air = stereoNoise(t.length, s);
  return fadeS(both(tone, (c, ch) => { const band = bp(air[ch], 1500, 9000); return each(c, (v, i) => v * .6 + band[i] * x[i] ** 3 * .5); }), .02, .012);
}
function slowDown({ duration = 1.8 }) {
  const { ph, t } = sweep(hz('F5'), hz('F2'), duration, .7), x = each(t, v => v / duration), rate = cumsum(each(x, v => 26 * (1 - v) ** 2 + 1.5));
  const y = each(ph, (p, i) => (Math.sin(p) + .4 * Math.sin(2 * p) + .2 * Math.sin(3 * p)) * (.55 + .45 * Math.sin(TAU * rate[i] / SR)) * (1 - x[i] ** 3));
  return reverb(gain(stereo(fade(lp(y, 2500), .01, .1)), .7), { decay: 1.6, wet: .25, bright: 2500 });
}
function lightZip({ duration = .55, panFrom = -.8, panTo = .8 }) {
  const n = Math.trunc(duration * SR), x = Float64Array.from({ length: n }, (_, i) => i / SR / duration);
  const ph = cumsum(each(x, v => TAU * hz('C7') * (1 - .3 / (1 + Math.exp(-(v - .45) * 22))) / SR)), env = each(x, v => Math.exp(-(((v - .45) / .2) ** 2))), air = bp(noise(n, 8), 3000, 12000);
  const y = each(ph, (p, i) => (Math.sin(p) + .5 * Math.sin(1.5 * p) + .3 * Math.sin(2 * p)) * env[i] * .5 + air[i] * env[i] ** 2 * .6);
  const a = each(x, v => (panFrom + (panTo - panFrom) * v + 1) * Math.PI / 4);
  return reverb([each(y, (v, i) => v * Math.cos(a[i])), each(y, (v, i) => v * Math.sin(a[i]))], { decay: 1, wet: .2, bright: 8000 });
}
function lightTone({ duration = 4, note: n = 'F5' as string | number }) {
  const t = secs(duration), f = hz(n), partials = [[1, 1], [1.5, .5], [2, .35], [3, .12]];
  const y = each(t, s => partials.reduce((sum, [r, a], i) => sum + a * Math.sin(TAU * f * r * s + 1.5 * Math.sin(TAU * (.31 + .07 * i) * s + i)), 0) * (.8 + .2 * Math.sin(TAU * 5.3 * s)));
  return fadeS(both(reverb(gain(stereo(y), .35), { decay: 2.5, wet: .5, bright: 9000 }), c => c.subarray(0, t.length)), .08, .3);
}
function blip({ note: n = 'C5' as string | number, duration = .3, velocity = 1 }) {
  const t = secs(duration), f = hz(n);
  const y = each(t, s => Math.sin(TAU * f * s + 1.1 * Math.sin(TAU * f * s) * Math.exp(-s / .05)) * Math.exp(-s / .07) + .3 * Math.sin(TAU * 2 * f * s) * Math.exp(-s / .03));
  return reverb(gain(stereo(fade(y, .002, .03)), velocity), { decay: .9, wet: .22, bright: 6000 });
}
function bell(f: number, duration: number, partials: number[][], decayScale: (d: number) => number) {
  const kept = partials.filter(([r]) => f * r < SR / 2.2), t = secs(duration);
  return each(t, s => kept.reduce((sum, [r, a, d]) => sum + a * Math.sin(TAU * f * r * s) * Math.exp(-s / decayScale(d)), 0));
}
function glassPing({ note: n = 'C7' as string | number, duration = 2.6 }) {
  const y = bell(hz(n), duration, [[1, 1, .7], [2.32, .4, .35], [4.25, .2, .18], [6.6, .1, .1]], d => d), sparkle = hp(noise(y.length, 9), 6000);
  return reverb(gain(stereo(fade(each(y, (v, i) => v + sparkle[i] * Math.exp(-i / SR / .004) * .4), .001, .1)), .6), { decay: 2.2, wet: .3, bright: 10000 });
}
function chime({ note: n = 'C5' as string | number, duration = 3 }) {
  return reverb(gain(stereo(fade(bell(hz(n), duration, [[1, 1, 1], [2, .45, .6], [2.76, .3, .45], [5.4, .16, .25]], d => duration * .25 * d), .002, .2)), .6), { decay: 2.6, wet: .35, bright: 6000 });
}
function dataChatter({ duration = 1.5, rate = 45, seed: s = 20, low = 'F5' as string | number, spread = 24, shape = 'flat' as 'flat' | 'up' | 'down' }) {
  const n = Math.trunc(duration * SR), out = silence(duration + .25), u = rng(s), scale = [0, 3, 5, 7, 10];
  for (let t = 0; t < duration;) {
    const x = t / duration, density = rate * (shape === 'flat' ? 1 : shape === 'up' ? .25 + .75 * x : 1 - .75 * x), step = Math.floor(u() * spread);
    const f = hz(low) * 2 ** ((12 * Math.floor(step / 5) + scale[step % 5]) / 12), g = Math.trunc((.004 + u() * .008) * SR), level = .4 + u() * .6;
    put(out, stereo(Float64Array.from({ length: g }, (_, i) => Math.sin(TAU * f * i / SR) * (.5 - .5 * Math.cos(TAU * i / (g - 1))) * level), u() * 1.6 - .8), t);
    t += -Math.log(1 - u()) / density;
  }
  return gain(fadeS(both(out, c => lp(c.subarray(0, n), 9000)), .01, .05), .5);
}
function tick({ pitch = 1 }) {
  const t = secs(.09), hiss = hp(noise(t.length, 13), 3000);
  const y = each(t, (s, i) => Math.sin(TAU * 2100 * pitch * s) * Math.exp(-s / .006) + .6 * Math.sin(TAU * 820 * pitch * s) * Math.exp(-s / .014) + hiss[i] * Math.exp(-s / .002) * .5);
  return reverb(gain(stereo(fade(y, .0005, .01)), .7), { decay: .5, wet: .12, bright: 5000 });
}
function counter({ duration = 2, startRate = 8, endRate = 40, startPitch = .8, endPitch = 1.6 }) {
  const out = silence(duration + .5);
  for (let t = 0; t < duration;) { const x = t / duration; put(out, tick({ pitch: startPitch * (endPitch / startPitch) ** x }), t, .5 + .5 * x); t += 1 / (startRate * (endRate / startRate) ** x); }
  return out;
}
function scramble({ duration = 1.4, seed: s = 30, reverse = false }): Stereo {
  const n = Math.trunc(duration * SR), u = rng(s), steps = Math.trunc(duration * 38) + 1, run = Math.trunc(n / steps) + 1, notes = ['F4', 'Ab4', 'Bb4', 'C5', 'Eb5', 'F5', 'Ab5', 'C6'].map(hz);
  const f = hold(n, run, () => notes[Math.floor(u() * notes.length)]), phase = cumsum(each(f, v => TAU * v / SR)), held = hold(n, 60, () => normal(u));
  const x = Float64Array.from({ length: n }, (_, i) => i / n), raw = each(phase, (p, i) => (Math.sign(Math.sin(p)) * .5 + held[i] * .5) * Math.sin(TAU * 31 * i / SR) * Math.sin(Math.PI * x[i]) ** .7);
  const low = bp(raw, 400, 3000), high = bp(raw, 3000, 11000), y = each(raw, (_, i) => (low[i] * (1 - x[i]) + high[i] * x[i]) * Math.SQRT1_2 * .5);
  let out: Stereo = [each(y, (v, i) => v * (1 - .6 * x[i])), each(y, (v, i) => v * (.4 + .6 * x[i]))];
  if (reverse) out = both(out, c => c.slice().reverse());
  return fadeS(out, .01, .04);
}
function unscramble({ duration = 1.6 }) {
  const t = secs(duration), chord = each(t, s => ['F4', 'A4', 'C5', 'F5'].reduce((sum, nn) => sum + Math.sin(TAU * hz(nn) * s), 0) / 4), noisy = scramble({ duration, seed: 31, reverse: true }), clean = stereo(chord);
  const y = both(noisy, (c, ch) => each(c, (v, i) => v * (1 - i / t.length) ** 1.5 * 1.3 + (clean[ch][i] ?? 0) * (i / t.length) ** 2 * .5));
  return reverb(fadeS(y, .01, .25), { decay: 2.2, wet: .3, bright: 6000 });
}
function glitch({ duration = .45, seed: s = 40 }) {
  const n = Math.trunc(duration * SR), u = rng(s), { ph } = sweep(260, 90, duration, .6), gate = hold(n, 900, () => u() > .35 ? 1 : 0), crackle = hp(noise(n, s), 2500), bursts = hold(n, 300, () => u() > .7 ? 1 : 0);
  const y = lp(each(ph.subarray(0, n), (p, i) => Math.sign(Math.sin(p)) * gate[i] * .5 + crackle[i] * bursts[i] * .7), 6000);
  return fadeS(stereo(each(y, (v, i) => v * (1 - i / SR / duration) ** .6 * .6)), .002, .03);
}
function alertLow({ note: n = 'Bb2' as string | number, duration = .42 }) {
  const t = secs(duration), f = hz(n), y = lp(each(t, s => [1, 1.059, 2].reduce((sum, d) => sum + 2 * ((f * d * s) % 1) - 1, 0) / 3), 900, 4);
  return reverb(gain(stereo(fade(each(y, (v, i) => v * Math.min(1, t[i] / .012) * Math.exp(-t[i] / .16)), .002, .05)), .9), { decay: .9, wet: .2, bright: 2000 });
}
function radioPulse({ duration = .4, carrier = 330, am = 27, seed: s = 50 }) {
  const { ph, t } = sweep(carrier * 1.25, carrier * .85, duration), static_ = bp(noise(t.length, s), 900, 3500);
  const y = each(ph, (p, i) => { const x = t[i] / duration, arc = Math.sin(Math.PI * x); return Math.sin(p) * (.5 + .5 * Math.sin(TAU * am * t[i])) * arc ** 1.5 * .7 + static_[i] * arc ** 3 * .25 * (.5 + .5 * Math.sin(TAU * am * 2 * t[i])); });
  return gain(fadeS(stereo(y), .01, .04), .7);
}
function convert({ up = true, duration = .38 }) {
  const { ph, t } = up ? sweep(280, 4200, duration, 1.5) : sweep(4200, 280, duration, .7);
  const chirp = each(ph, (p, i) => Math.sin(p + .8 * Math.sin(p * .5)) * (up ? (t[i] / duration) ** 1.5 : (1 - t[i] / duration) ** 1.2)), tp = secs(up ? .9 : .5), out = silence((chirp.length + tp.length) / SR);
  put(out, gain(stereo(up ? fade(chirp, .005, .004) : fade(chirp, .004, .01)), .5), 0);
  const tail = up ? each(tp, s => Math.sin(TAU * hz('C6') * s) * Math.exp(-s / .2) * .6) : each(tp, s => Math.sin(TAU * 330 * s) * (.5 + .5 * Math.sin(TAU * 27 * s)) * Math.exp(-s / .15) * .6);
  put(out, stereo(tail), (chirp.length - (up ? 0 : 400)) / SR);
  return reverb(out, { decay: 1.2, wet: .2, bright: 8000 });
}
function powerUp({ duration = .9 }) {
  const { ph, t } = sweep(hz('F2'), hz('F4'), duration, 1.3), x = each(t, v => v / duration), rate = cumsum(each(x, v => 6 + 30 * v)), out = silence(duration + 1);
  const y = lp(each(ph, (p, i) => { let saw = 0; for (let k = 1; k < 9; k++) saw += Math.sin(k * p) / k; return saw * x[i] ** 1.5 * (.7 + .3 * Math.sin(TAU * rate[i] / SR)); }), 5600);
  put(out, fadeS(gain(stereo(y), .45), .02, .01), 0);
  put(out, thud({ frequency: 55, duration: .6 }), duration - .01, .9);
  put(out, both(lightTone({ duration: .9, note: 'F5' }), c => c.subarray(0, Math.trunc(.9 * SR))), duration - .01, .8);
  return reverb(out, { decay: 1.5, wet: .2, bright: 6000 });
}
function sendWhoop({ duration = .16 }) {
  const { ph, t } = sweep(480, 1150, duration, .8), air = hp(noise(t.length, 60), 4000);
  const y = each(ph, (p, i) => { const arc = Math.sin(Math.PI * t[i] / duration); return (Math.sin(p) + .25 * Math.sin(2 * p)) * arc ** .8 + air[i] * arc ** 2 * .12; });
  return reverb(gain(stereo(fade(y, .004, .02)), .6), { decay: .6, wet: .15, bright: 7000 });
}
function receiveTone({ first = 'C6' as string | number, second = 'F6' as string | number }) {
  const out = silence(2.6);
  [first, second].forEach((nn, i) => {
    const t = secs(1.6), f = hz(nn);
    const y = each(t, s => (Math.sin(TAU * f * s) + .3 * Math.sin(TAU * 2 * f * s) * Math.exp(-s / .1) + .12 * Math.sin(TAU * 3.01 * f * s) * Math.exp(-s / .06)) * Math.exp(-s / .32));
    put(out, stereo(fade(y, .002, .1)), i * .13, i === 0 ? .6 : .5);
  });
  return reverb(out, { decay: 1.5, wet: .25, bright: 8000 });
}
function dive({ duration = 1.3, seed: s = 70 }) {
  const n = Math.trunc(duration * SR), src = stereoNoise(n, s), x = Float64Array.from({ length: n }, (_, i) => i / SR / duration), { ph } = sweep(hz('F3'), hz('C6'), duration, 2);
  const mids = [0, 1, 2, 3, 4, 5].map(i => 200 * (9000 / 200) ** (i / 5));
  const y = both(src, c => { const out = new Float64Array(n); mids.forEach((m, i) => { const band = bp(c, m * .8, m * 1.25); for (let j = 0; j < n; j++) out[j] += band[j] * Math.min(Math.max(1 - Math.abs(x[j] * 5 - i), 0), 1); }); return each(out, (v, j) => v * x[j] ** 1.5 * .8 + (Math.sin(ph[j] ?? 0) + .5 * Math.sin(2 * (ph[j] ?? 0))) * Math.SQRT1_2 * x[j] ** 2.5 * .3); });
  const d = Math.trunc(.0021 * SR);
  return fadeS(both(y, c => each(c, (v, i) => (v + (i >= d ? c[i - d] * .6 : 0)) * .6)), .02, .02);
}
function sputnik({ count = 3, gap = .3 }) {
  const out = silence(count * gap + 1.2), t = secs(.12), beep = fade(bp(each(t, s => Math.sin(TAU * 1480 * s + .6 * Math.sin(TAU * 41 * s)) * Math.sin(Math.PI * s / .12) ** .4), 900, 2400), .004, .01);
  for (let i = 0; i < count; i++) put(out, gain(stereo(beep, .3), .5), i * gap);
  const bed = Math.trunc(count * gap * SR);
  put(out, gain(both(stereoNoise(bed, 80), c => bp(c, 2000, 6000)), .015), 0);
  return reverb(out, { decay: 1.4, wet: .3, bright: 5000 });
}
const MORSE: Record<string, string> = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((c, i) => [c, '.- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --.. ----- .---- ..--- ...-- ....- ..... -.... --... ---.. ----.'.split(' ')[i]]));
function telegraph({ text = 'GLORY', unit = .075, seed: s = 90 }) {
  const clack = (up: boolean, r: number) => { const t = secs(.07), hiss = hp(noise(t.length, r), 2000); return gain(stereo(fade(each(t, (v, i) => Math.sin(TAU * (up ? 1250 : 880) * v) * Math.exp(-v / .006) + .7 * Math.sin(TAU * (up ? 2900 : 2300) * v) * Math.exp(-v / .003) + hiss[i] * Math.exp(-v / .0015) * .8), .0003, .01), -.1), up ? .6 : 1); };
  const u = rng(s), marks: [number, number][] = [];
  let t = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') { t += unit * 4; continue; }
    for (const sym of MORSE[ch] ?? '') { const d = unit * (sym === '-' ? 3 : 1); marks.push([t, d]); t += d + unit; }
    t += unit * 2;
  }
  const out = silence(t + .6);
  for (const [start, d] of marks) { const j = u() * .012 - .006; put(out, clack(false, Math.trunc(start * 1000)), start + j); put(out, clack(true, Math.trunc(start * 1000) + 1), start + d + j); }
  return gain(reverb(both(out, c => bp(c, 500, 6000)), { decay: .7, wet: .25, bright: 3500 }), .8);
}
function sonar({ note: n = 'Eb6' as string | number, duration = 3.2 }) {
  const t = secs(.5), y = each(t, s => Math.sin(TAU * hz(n) * s) * Math.min(1, s / .003) * Math.exp(-s / .09));
  return both(reverb(gain(stereo(y), .5), { decay: duration, wet: .9, bright: 4500, pre: .09 }), c => c.subarray(0, Math.trunc(duration * SR)));
}
function bubbles({ duration = 1.2, count = 26, seed: s = 100 }) {
  const out = silence(duration + .3), u = rng(s), between = (a: number, b: number) => a + (b - a) * u();
  for (let i = 0; i < count; i++) {
    const d = between(.02, .07), { ph, t } = sweep(between(350, 900), between(900, 2400), d, .6), p = between(-.7, .7), level = between(.2, .7);
    put(out, gain(stereo(each(ph, (v, j) => Math.sin(v) * Math.sin(Math.PI * t[j] / d) ** .5), p), level), between(0, duration) ** 1.4 / duration ** .4);
  }
  return gain(both(out, c => lp(c, 3500)), .6);
}
function pop({ frequency = 520 }) {
  const { ph, t } = sweep(frequency * 1.9, frequency, .05, .5);
  return gain(stereo(fade(each(ph, (p, i) => Math.sin(p) * Math.exp(-t[i] / .018)), .001, .01)), .6);
}
function laserCut({ duration = .34, seed: s = 110 }): Stereo {
  const { ph, t } = sweep(5200, 900, duration, .5), air = hp(noise(t.length, s), 5000);
  const y = each(ph, (p, i) => { const arc = Math.sin(Math.PI * t[i] / duration); return (Math.sign(Math.sin(p)) * .35 + Math.sin(p * .5) * .4) * arc ** .6 + air[i] * arc * .25; });
  const a = each(t, v => (-.8 + 1.6 * v / duration + 1) * Math.PI / 4);
  return [fade(each(y, (v, i) => v * Math.cos(a[i]) * .5), .004, .03), fade(each(y, (v, i) => v * Math.sin(a[i]) * .5), .004, .03)];
}
function swarm({ duration = 1.8, seed: s = 120 }) {
  const n = Math.trunc(duration * SR), t = Float64Array.from({ length: n }, (_, i) => i / SR), rate = cumsum(each(t, v => 17 + 16 * Math.sin(TAU * .9 * v)));
  const chatter = dataChatter({ duration, rate: 120, seed: s, low: 'F6', spread: 10 });
  return fadeS(both(stereoNoise(n, s), (c, ch) => { const band = bp(c, 700, 6000); return each(band, (v, i) => v * (.55 + .45 * Math.sin(TAU * rate[i] / SR)) * Math.sin(Math.PI * (t[i] / duration) ** .6) ** 1.5 * .5 + chatter[ch][i] * .5); }), .02, .2);
}
function crackle({ duration = 6, seed: s = 130 }) {
  const n = Math.trunc(duration * SR), u = rng(s), y = new Float64Array(n);
  for (let i = 0; i < Math.trunc(duration * 26); i++) y[Math.floor(u() * n)] = normal(u) * u() ** 3;
  const hiss = bp(noise(n, s + 1), 300, 3000), mixed = each(bp(y, 900, 7000), (v, i) => v * 6 + hiss[i] * .012), rolled = each(mixed, (_, i) => mixed[(i - 37 + n) % n]);
  const a = stereo(mixed, -.1), b = stereo(rolled, .2);
  return fadeS(both(a, (c, ch) => each(c, (v, i) => v * .5 + b[ch][i] * .3)), .2, .4);
}
function wind({ duration = 6, seed: s = 140 }) {
  const n = Math.trunc(duration * SR), t = Float64Array.from({ length: n }, (_, i) => i / SR);
  return fadeS(both(stereoNoise(n, s), c => { const lo = bp(c, 180, 700), mid = bp(c, 700, 2200); return each(c, (_, i) => (lo[i] * .8 + mid[i] * .25 * (.5 + .5 * Math.sin(TAU * .21 * t[i]))) * (.5 + .3 * Math.sin(TAU * .13 * t[i]) + .2 * Math.sin(TAU * .31 * t[i] + 1)) * .25); }), .6, .8);
}

type Preset = { description: string; params: z.ZodObject<z.ZodRawShape>; render: (params: never) => Stereo };
const preset = <S extends z.ZodRawShape>(description: string, shape: S, render: (params: z.infer<z.ZodObject<S>>) => Stereo): Preset => ({ description, params: z.object(shape).strict(), render: render as (params: never) => Stereo });

/** Named presets. Every parameter is optional; omitted ones keep the designed default. */
export const SOUND_PRESETS = {
  pop: preset('Soft pop: a bubble, card or icon appearing (~0.05 s).', { frequency: z.number().min(150).max(3000).optional() }, pop),
  tick: preset('One clock or UI tick (~0.09 s plus a short room). pitch scales it (1 = 2.1 kHz click).', { pitch: z.number().min(.25).max(4).optional() }, tick),
  counter: preset('A number running up: ticks that quicken and rise in pitch, then stop dead.', { duration: seconds(.2, 6).optional(), startRate: z.number().min(1).max(30).optional(), endRate: z.number().min(1).max(60).optional(), startPitch: z.number().min(.25).max(4).optional(), endPitch: z.number().min(.25).max(4).optional() }, counter),
  whoosh: preset('Air rushing past: a noise band sweeping up and down while panning. duration is the whole sweep; peak (0..1) is where it is loudest.', { duration: seconds(.08, 4).optional(), low: z.number().min(40).max(8000).optional(), high: z.number().min(200).max(16000).optional(), panFrom: pan.optional(), panTo: pan.optional(), seed: seed.optional(), peak: z.number().min(.05).max(.95).optional() }, whoosh),
  riser: preset('A rising tone with quickening tremolo and air that cuts off at its peak; end it on the reveal.', { duration: seconds(.2, 8).optional(), from: note.optional(), to: note.optional(), seed: seed.optional() }, riser),
  'sub-drop': preset('A deep falling hit with a short crack, for titles and big numbers. Long low tail.', { duration: seconds(.3, 5).optional() }, subDrop),
  impact: preset('Alias of sub-drop with a 1.2 s default: the hit at the end of a riser.', { duration: seconds(.3, 5).optional() }, ({ duration = 1.2 }) => subDrop({ duration })),
  thud: preset('A short soft thump: something landing or locking into place.', { frequency: z.number().min(30).max(400).optional(), duration: seconds(.1, 2).optional() }, thud),
  'slow-down': preset('Time stretching: a tone sinks while its flutter slows to a crawl.', { duration: seconds(.3, 5).optional() }, slowDown),
  'light-zip': preset('Something bright flying past: a high tone whose pitch drops as it passes, panning.', { duration: seconds(.15, 3).optional(), panFrom: pan.optional(), panTo: pan.optional() }, lightZip),
  'light-tone': preset('A pure glassy held tone for a recurring idea or highlight.', { duration: seconds(.3, 8).optional(), note: note.optional() }, lightTone),
  blip: preset('A hop: one soft round note. Chain several on beats for a melody.', { note: note.optional(), duration: seconds(.05, 2).optional(), velocity: z.number().min(0).max(1).optional() }, blip),
  'glass-ping': preset('A fine glass ting with a long ring.', { note: note.optional(), duration: seconds(.2, 5).optional() }, glassPing),
  chime: preset('A soft bell, for success or completion; three in a row make a motif.', { note: note.optional(), duration: seconds(.3, 6).optional() }, chime),
  'data-chatter': preset('Bits being handled: a stream of tiny pitched grains. shape flat, up or down changes density over time.', { duration: seconds(.1, 8).optional(), rate: z.number().min(2).max(200).optional(), seed: seed.optional(), low: note.optional(), spread: z.number().int().min(1).max(40).optional(), shape: z.enum(['flat', 'up', 'down']).optional() }, dataChatter),
  scramble: preset('Encryption: stepped, crunchy digital noise sweeping left to right.', { duration: seconds(.1, 6).optional(), seed: seed.optional(), reverse: z.boolean().optional() }, scramble),
  unscramble: preset('Decryption: digital noise clearing into a clean chord.', { duration: seconds(.2, 6).optional() }, unscramble),
  glitch: preset('A connection failing: a stuttering, sinking buzz with crackle.', { duration: seconds(.05, 3).optional(), seed: seed.optional() }, glitch),
  'alert-low': preset('Something missing or wrong: a low, soft, slightly sour double tone. Not a cartoon buzzer.', { note: note.optional(), duration: seconds(.1, 2).optional() }, alertLow),
  'radio-pulse': preset('One radio wavefront leaving an antenna.', { duration: seconds(.1, 2).optional(), carrier: z.number().min(60).max(4000).optional(), am: z.number().min(1).max(200).optional(), seed: seed.optional() }, radioPulse),
  convert: preset('A transformation: a fast chirp up into a bright ping (up true) or down into a low pulse (up false).', { up: z.boolean().optional(), duration: seconds(.1, 2).optional() }, convert),
  'power-up': preset('A charge that rises and lands with a push and a glow: a boost or a machine switching on.', { duration: seconds(.2, 4).optional() }, powerUp),
  'send-whoop': preset('A message sending: a quick soft upward whoop.', { duration: seconds(.05, 1).optional() }, sendWhoop),
  'receive-tone': preset('A message arriving: two soft bell notes 0.13 s apart.', { first: note.optional(), second: note.optional() }, receiveTone),
  dive: preset('Diving into something: a rising rush with a swept resonance, like a tunnel closing in.', { duration: seconds(.2, 5).optional(), seed: seed.optional() }, dive),
  sputnik: preset('A satellite: thin warbling beeps, count of them, gap seconds apart.', { count: z.number().int().min(1).max(20).optional(), gap: seconds(.05, 2).optional() }, sputnik),
  telegraph: preset('A telegraph key tapping text in Morse code.', { text: z.string().regex(/^[A-Za-z0-9 ]{1,24}$/).optional(), unit: seconds(.03, .2).optional(), seed: seed.optional() }, telegraph),
  sonar: preset('One sonar ping fading into the deep; duration is the tail length.', { note: note.optional(), duration: seconds(.5, 4).optional() }, sonar),
  bubbles: preset('A rush of bubbles.', { duration: seconds(.1, 6).optional(), count: z.number().int().min(1).max(120).optional(), seed: seed.optional() }, bubbles),
  'laser-cut': preset('A cut line sweeping through: a falling buzzy zap that pans left to right.', { duration: seconds(.05, 2).optional(), seed: seed.optional() }, laserCut),
  swarm: preset('Hundreds of small things taking off at once: a soft fluttering rush.', { duration: seconds(.2, 6).optional(), seed: seed.optional() }, swarm),
  crackle: preset('Old-recording crackle, to mark the past. A bed under a whole scene.', { duration: seconds(.5, 10).optional(), seed: seed.optional() }, crackle),
  wind: preset('Wind over open water. A bed under a whole scene.', { duration: seconds(.5, 10).optional(), seed: seed.optional() }, wind),
} satisfies Record<string, Preset>;
export type SoundPresetName = keyof typeof SOUND_PRESETS;
export const SOUND_PRESET_NAMES = Object.keys(SOUND_PRESETS) as [SoundPresetName, ...SoundPresetName[]];

export function renderPreset(name: SoundPresetName, params: Record<string, unknown> = {}): Stereo {
  const spec = SOUND_PRESETS[name], parsed = spec.params.safeParse(params);
  if (!parsed.success) throw new Error(`Preset ${name}: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'params'} ${issue.message}`).join('; ')}. Allowed: ${Object.keys(spec.params.shape).join(', ') || 'none'}.`);
  return spec.render(parsed.data as never);
}
