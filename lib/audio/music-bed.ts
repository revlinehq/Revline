import { SR, TAU, both, each, fade, hp, hz, lp, noise, peakOf, put, reverb, silence, stereo, type Mono, type Stereo } from './dsp';
import { GENERATED_SOUND_PEAK } from './wav';

// A music bed rendered from scratch at a given tempo and beat phase, so its downbeats land where a reference's do.
// Deterministic synth (pads, bass, drums, a pluck), one chord per bar, each bar's density following an energy curve.
// Its beats and downbeats are known exactly, so the bed carries its own beat map for alignCutsToBeat.

export type MusicFeel = 'calm' | 'warm' | 'upbeat' | 'driving';
export type MusicBedSpec = {
  duration: number; bpm: number; feel: MusicFeel;
  /** Seconds of the first downbeat (may be negative: the grid started before the bed). */
  phase: number;
  /** Energy 0..1 per bar, from the first bar that touches the bed (the one holding second 0); missing bars use the feel's middle. */
  energy?: number[];
  key?: 'F minor' | 'C major' | 'A minor' | 'D minor' | 'G major';
  seed?: number;
};
export const MUSIC_BED_LIMITS = { duration: 180, minBpm: 60, maxBpm: 180 } as const;

const PROGRESSIONS: Record<NonNullable<MusicBedSpec['key']>, string[][]> = {
  'F minor': [['F3', 'Ab3', 'C4', 'Eb4'], ['Db3', 'F3', 'Ab3', 'C4'], ['Ab2', 'C3', 'Eb3', 'G3'], ['Eb3', 'G3', 'Bb3', 'Db4']],
  'A minor': [['A2', 'C3', 'E3', 'G3'], ['F2', 'A2', 'C3', 'E3'], ['C3', 'E3', 'G3', 'B3'], ['G2', 'B2', 'D3', 'F3']],
  'D minor': [['D3', 'F3', 'A3', 'C4'], ['Bb2', 'D3', 'F3', 'A3'], ['F2', 'A2', 'C3', 'E3'], ['C3', 'E3', 'G3', 'Bb3']],
  'C major': [['C3', 'E3', 'G3', 'B3'], ['A2', 'C3', 'E3', 'G3'], ['F2', 'A2', 'C3', 'E3'], ['G2', 'B2', 'D3', 'F3']],
  'G major': [['G2', 'B2', 'D3', 'F#3'], ['E2', 'G2', 'B2', 'D3'], ['C3', 'E3', 'G3', 'B3'], ['D3', 'F#3', 'A3', 'C4']],
};
/** Per feel: drum pattern density and the middle energy a bar has without a measured curve. */
const FEELS: Record<MusicFeel, { kick: number[]; snare: number[]; hats: number; pluck: number; swing: number; middle: number }> = {
  calm: { kick: [0], snare: [], hats: 0, pluck: 2, swing: 0, middle: .35 },
  warm: { kick: [0, 2.5], snare: [1, 3], hats: 2, pluck: 2, swing: .12, middle: .5 },
  upbeat: { kick: [0, 1, 2, 3], snare: [1, 3], hats: 2, pluck: 4, swing: 0, middle: .65 },
  driving: { kick: [0, 1, 2, 3], snare: [1, 3], hats: 4, pluck: 4, swing: 0, middle: .8 },
};

const env = (n: number, attack: number, decay: number) => { const a = Math.max(1, Math.round(attack * SR)); return Float64Array.from({ length: n }, (_, i) => i < a ? i / a : Math.exp(-(i - a) / SR / decay)); };
const mul = (x: Mono, y: Mono) => each(x, (v, i) => v * (y[i] ?? 0));

function kick(): Mono {
  const n = Math.round(.42 * SR), out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; phase += TAU * (46 + 90 * Math.exp(-t / .035)) / SR; out[i] = Math.sin(phase) * Math.exp(-t / .16); }
  const click = mul(hp(noise(n, 11), 2500), env(n, .0005, .004));
  return each(out, (v, i) => v + click[i] * .25);
}
const snare = (seed: number): Mono => { const n = Math.round(.25 * SR), body = Float64Array.from({ length: n }, (_, i) => Math.sin(TAU * 190 * i / SR) * Math.exp(-i / SR / .05)); const air = mul(lp(hp(noise(n, seed), 1200), 7000), env(n, .001, .07)); return each(air, (v, i) => v * .9 + body[i] * .35); };
const hat = (seed: number, open = false): Mono => { const n = Math.round((open ? .18 : .06) * SR); return mul(hp(noise(n, seed), 7000), env(n, .0008, open ? .06 : .018)); };
function pad(notes: string[], length: number, seed: number): Stereo {
  const n = Math.round(length * SR), left = new Float64Array(n), right = new Float64Array(n);
  notes.forEach((note, index) => {
    const f = hz(note);
    [-.08, .08].forEach((cents, side) => {
      const ratio = 2 ** (cents / 12), offset = (seed + index) * .37;
      const target = side ? right : left;
      for (let i = 0; i < n; i++) { const p = (f * ratio * i / SR + offset) % 1; target[i] += (2 * p - 1) * .18; }
    });
  });
  const shape = Float64Array.from({ length: n }, (_, i) => Math.min(1, i / (.35 * SR)) * Math.min(1, (n - i) / (.25 * SR)));
  return [mul(lp(left, 1100, 2), shape), mul(lp(right, 1100, 2), shape)];
}
function bass(note: string, length: number): Mono {
  const f = hz(note) / 2, n = Math.round(length * SR);
  return Float64Array.from({ length: n }, (_, i) => { const t = i / SR; return (Math.sin(TAU * f * t) + .25 * Math.sin(TAU * 2 * f * t)) * Math.min(1, t / .01) * Math.exp(-t / Math.max(.25, length * .6)) * Math.min(1, (n - i) / (.02 * SR)); });
}
function pluck(note: string, length: number): Mono {
  const f = hz(note) * 2, n = Math.round(length * SR);
  return Float64Array.from({ length: n }, (_, i) => { const t = i / SR, index = 2.2 * Math.exp(-t / .08); return Math.sin(TAU * f * t + index * Math.sin(TAU * f * 2 * t)) * Math.min(1, t / .003) * Math.exp(-t / .22); });
}

/** The bed and its exact beat map (beats, downbeats, bpm) in seconds of the bed. */
export function renderMusicBed(spec: MusicBedSpec): { samples: Stereo; beats: number[]; downbeats: number[]; bpm: number } {
  const duration = Math.min(MUSIC_BED_LIMITS.duration, Math.max(1, spec.duration));
  const bpm = Math.min(MUSIC_BED_LIMITS.maxBpm, Math.max(MUSIC_BED_LIMITS.minBpm, spec.bpm));
  const beat = 60 / bpm, bar = beat * 4, feel = FEELS[spec.feel], chords = PROGRESSIONS[spec.key ?? 'F minor'], seed = spec.seed ?? 3;
  // Bars on the grid that touch the bed: the first may start before 0.
  const firstBar = Math.floor(-spec.phase / bar), lastBar = Math.ceil((duration - spec.phase) / bar);
  const drums = silence(duration + 1), music = silence(duration + 1);
  const kickSound = stereo(kick()), beats: number[] = [], downbeats: number[] = [];
  // Sounds repeat bar after bar: render each variant once.
  const memo = new Map<string, Stereo>(), once = (key: string, make: () => Stereo) => { let sound = memo.get(key); if (!sound) memo.set(key, sound = make()); return sound; };
  for (let index = firstBar; index < lastBar; index++) {
    const start = spec.phase + index * bar, energy = Math.max(0, Math.min(1, spec.energy?.[index - firstBar] ?? feel.middle)), chord = chords[((index % 4) + 4) % 4];
    for (let b = 0; b < 4; b++) { const t = start + b * beat; if (t >= -1e-6 && t < duration) { beats.push(Math.round(t * 1000) / 1000); if (!b) downbeats.push(Math.round(t * 1000) / 1000); } }
    // The pad and bass always play; drums and pluck come in with the energy.
    put(music, once(`pad${index % 4}`, () => pad(chord, bar + .3, seed + index % 4)), start, .55 + .35 * energy);
    put(music, once(`bass${chord[0]}${energy > .55}`, () => stereo(bass(chord[0], beat * (energy > .55 ? 1 : 2) * .95))), start, .7);
    if (energy > .55) for (const b of [1, 2, 3]) { const note = chord[b === 2 ? 2 : 0]; put(music, once(`walk${note}`, () => stereo(bass(note, beat * .9))), start + b * beat, .45); }
    if (energy > .2) for (const at of feel.kick) put(drums, kickSound, start + at * beat, .9);
    if (energy > .4) for (const at of feel.snare) put(drums, once(`snare${(index + at) % 3}`, () => stereo(snare(seed + (index + at) % 3))), start + at * beat, .5);
    if (energy > .3 && feel.hats) for (let h = 0; h < 4 * feel.hats; h++) {
      const at = start + h * beat / feel.hats + (h % 2 ? feel.swing * beat / feel.hats : 0);
      const open = h % (feel.hats * 2) === feel.hats * 2 - 1;
      put(drums, once(`hat${h % 4}${open}`, () => stereo(hat(seed + h % 4, open), h % 2 ? .25 : -.25)), at, h % 2 ? .16 : .24);
    }
    if (energy > .15 && feel.pluck) for (let p = 0; p < 4 * feel.pluck / 2; p++) {
      const note = chord[[0, 2, 1, 3, 2, 1, 3, 2][p % 8]];
      put(music, once(`pluck${note}${p % 2}`, () => stereo(pluck(note, beat * 1.5), p % 2 ? .35 : -.35)), start + p * beat * 2 / feel.pluck, .16 + .1 * energy);
    }
  }
  const wet = reverb(music, { decay: 1.8, wet: .22, bright: 4500, seed: seed + 5 });
  const n = Math.round(duration * SR);
  const mix: Stereo = [new Float64Array(n), new Float64Array(n)];
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < n; i++) mix[ch][i] = wet[ch][i] * .8 + drums[ch][i];
  // Ends with the film: a short fade so the last frame is quiet, then normalized like generated sounds.
  const faded = both(mix, channel => fade(channel, .02, Math.min(1.2, duration / 4)));
  const scale = GENERATED_SOUND_PEAK / Math.max(1e-9, peakOf(faded));
  return { samples: both(faded, channel => each(channel, value => value * scale)), beats, downbeats, bpm: Math.round(bpm * 100) / 100 };
}
