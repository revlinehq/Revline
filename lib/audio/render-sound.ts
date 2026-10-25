import { SR, TAU, type Mono, type Stereo, both, each, echo, fade, noise, peakOf, pink, put, reverb, silence, soft, sweptBiquad } from './dsp';
import { renderPreset } from './presets';
import { parseSoundRecipe, type Curve, type SoundLayer, type SoundRecipe } from './sound-recipe';

/** Rendered sounds peak here, like the library files, so clip gain means the same thing for both. */
export const GENERATED_SOUND_PEAK = 10 ** (-3 / 20);

/** Sample a curve at layer-local time t (seconds) for a layer `length` seconds long. */
export function curveAt(curve: Curve, t: number, length: number, geometric = false): number {
  if (typeof curve === 'number') return curve;
  if ('points' in curve) {
    const points = [...curve.points].sort((a, b) => a.time - b.time);
    if (t <= points[0].time) return points[0].value;
    for (let i = 1; i < points.length; i++) if (t <= points[i].time) {
      const { time: t0, value: v0 } = points[i - 1], { time: t1, value: v1 } = points[i], x = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return geometric && v0 > 0 && v1 > 0 ? v0 * (v1 / v0) ** x : v0 + (v1 - v0) * x;
    }
    return points[points.length - 1].value;
  }
  const x = Math.min(Math.max(length > 0 ? t / length : 1, 0), 1) ** (curve.power ?? 1), exponential = (curve.shape ?? (geometric ? 'exponential' : 'linear')) === 'exponential';
  return exponential && curve.from > 0 && curve.to > 0 ? curve.from * (curve.to / curve.from) ** x : curve.from + (curve.to - curve.from) * x;
}

// PolyBLEP keeps square and saw oscillators from aliasing at high pitches.
function blep(phase: number, step: number) {
  if (phase < step) { const x = phase / step; return x + x - x * x - 1; }
  if (phase > 1 - step) { const x = (phase - 1) / step; return x * x + x + x + 1; }
  return 0;
}
function synthesize(layer: Extract<SoundLayer, { source: unknown }>): Mono {
  const n = Math.max(1, Math.round(layer.length * SR)), y = new Float64Array(n);
  if (layer.source === 'white' || layer.source === 'pink') y.set((layer.source === 'white' ? noise : pink)(n, layer.seed ?? 1));
  else {
    let cycles = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, f = Math.min(curveAt(layer.frequency!, t, layer.length, true), SR * .45), step = Math.max(f, 0) / SR;
      const angle = TAU * cycles + (layer.fm ? curveAt(layer.fm.index, t, layer.length) * Math.sin(TAU * cycles * layer.fm.ratio) : 0);
      if (layer.source === 'sine') y[i] = layer.partials ? layer.partials.reduce((sum, p) => sum + p.gain * Math.sin(angle * p.ratio) * (p.decay ? Math.exp(-t / p.decay) : 1), 0) : Math.sin(angle);
      else if (layer.source === 'triangle') y[i] = 2 / Math.PI * Math.asin(Math.sin(angle));
      else {
        const p = ((angle / TAU) % 1 + 1) % 1;
        y[i] = layer.source === 'saw' ? 2 * p - 1 - blep(p, step) : (p < .5 ? 1 : -1) + blep(p, step) - blep((p + .5) % 1, step);
      }
      cycles += step;
    }
  }
  const { attack = .005, hold = 0, decay, release = .01 } = layer.envelope ?? {};
  for (let i = 0; i < n; i++) {
    const t = i / SR, rise = attack > 0 ? Math.min(1, t / attack) : 1, after = t - attack - hold;
    const tremolo = layer.tremolo ? 1 - layer.tremolo.depth * (.5 - .5 * Math.cos(TAU * curveAt(layer.tremolo.rate, t, layer.length) * t)) : 1;
    y[i] *= rise * (decay && after > 0 ? Math.exp(-after / decay) : 1) * tremolo;
  }
  return fade(y, 0, release);
}
function balance(signal: Stereo, curve: Curve, length: number): Stereo {
  return both(signal, (c, ch) => each(c, (v, i) => { const p = Math.min(Math.max(curveAt(curve, i / SR, length), -1), 1); return v * (ch === 0 ? Math.min(1, 1 - p) : Math.min(1, 1 + p)); }));
}
function renderLayer(layer: SoundLayer): Stereo {
  let signal: Stereo = 'preset' in layer ? renderPreset(layer.preset, layer.params) : (() => { const m = synthesize(layer); return [m, Float64Array.from(m)] as Stereo; })();
  const length = signal[0].length / SR;
  for (const filter of layer.filters ?? []) {
    const kind = filter.type === 'lowpass' ? 'low' : filter.type === 'highpass' ? 'high' : 'band';
    signal = both(signal, c => sweptBiquad(c, i => curveAt(filter.frequency, i / SR, length, true), kind, filter.q));
  }
  if (layer.distortion) signal = both(signal, c => soft(c, layer.distortion! + .01));
  if (layer.gain) signal = both(signal, c => each(c, v => v * 10 ** (layer.gain! / 20)));
  if (layer.pan !== undefined) signal = balance(signal, layer.pan, length);
  if (layer.delay) signal = echo(signal, layer.delay.time, { feedback: layer.delay.feedback, wet: layer.delay.wet, taps: layer.delay.taps });
  if (layer.reverb) signal = reverb(signal, layer.reverb);
  return signal;
}

/** Render a recipe to exactly `duration` seconds of stereo, peak-normalized to -3 dBFS. Deterministic. */
export function renderSound(input: unknown): { recipe: SoundRecipe; samples: Stereo } {
  const recipe = parseSoundRecipe(input);
  let mix = silence(recipe.duration);
  for (const layer of recipe.layers) put(mix, renderLayer(layer), layer.at);
  if (recipe.reverb) mix = both(reverb(mix, recipe.reverb), c => c.subarray(0, mix[0].length));
  const peak = peakOf(mix);
  if (!Number.isFinite(peak)) throw new Error('This recipe produced invalid samples. Simplify its curves or effects.');
  if (peak < 1e-5) throw new Error('This recipe renders silence. Check layer times, gains and filters.');
  const scale = GENERATED_SOUND_PEAK / peak;
  return { recipe, samples: both(mix, c => fade(each(c, v => v * scale), .001, .01)) };
}

/** 16-bit PCM WAV with deterministic TPDF dither. */
export function encodeWav([left, right]: Stereo): Uint8Array<ArrayBuffer> {
  const n = left.length, bytes = new Uint8Array(44 + n * 4), view = new DataView(bytes.buffer), text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 4, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, SR, true); view.setUint32(28, SR * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, n * 4, true);
  let s = 0x9e3779b9;
  const dither = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 2; ch++) {
    const v = (ch === 0 ? left : right)[i] + (dither() - dither()) / 32768;
    view.setInt16(44 + i * 4 + ch * 2, Math.round(Math.min(1, Math.max(-1, v)) * 32767), true);
  }
  return bytes;
}

/** The editor's waveform: base64 bytes of the per-10 ms peak of the mono mix. */
export function soundWaveform([left, right]: Stereo) {
  const peaks = new Uint8Array(Math.ceil(left.length / 480));
  for (let bucket = 0; bucket < peaks.length; bucket++) {
    let level = 0;
    for (let i = bucket * 480; i < Math.min(left.length, (bucket + 1) * 480); i++) level = Math.max(level, Math.abs((left[i] + right[i]) / 2));
    peaks[bucket] = Math.min(255, Math.round(level * 255));
  }
  let binary = '';
  for (const byte of peaks) binary += String.fromCharCode(byte);
  return { peaks: btoa(binary), samplesPerSecond: 100 };
}
