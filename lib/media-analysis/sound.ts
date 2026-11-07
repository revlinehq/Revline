import { roundTo } from '../math';
/** What a timeline range sounds like, measured from its decoded mix and each sounding clip: where sounds start
 * (onsets), how loud each tenth of a second is, which clips play and which words are spoken, and, for checkSound,
 * whether each sound effect lands on something that happens in the picture. */

import { changed } from './pacing';
import { MUSIC_ENERGY_STEP, type MusicEnergy } from './beat-map';

export const SOUND_RATE = 48000;

export type SoundKind = 'sfx' | 'voice' | 'music' | 'footage';
export type SoundEvent = { clipId: string; name: string; kind: SoundKind; start: number; end: number; gain: number };
export type SoundOnset = { time: number; level: number; sources: string[] };
export type SoundWord = { text: string; start: number; end: number };
export type SoundFlag = { start: number; end: number; kind: 'no-sound' | 'no-visual' | 'offset' | 'over-word' | 'clipping' | 'count'; reason: string };
export type VisualHit = { time: number; size: number };
export type SoundResult = {
  start: number; end: number;
  loudness: { integrated: number | null; peak: number };
  /** Momentary loudness (LUFS over 0.4 s) and sample peak (dBFS) at the end of each 0.1 s. */
  levels: number[]; peaks: number[];
  events: SoundEvent[]; onsets: SoundOnset[]; words: SoundWord[]; silences: { start: number; end: number }[];
  check?: { fps: number; visualHits: VisualHit[]; effectOnsets: { time: number; clipId: string; name: string }[]; flags: SoundFlag[] };
};
/** One sounding clip decoded over its part of the range, gain applied; `offset` is its first sample in the range. */
export type DecodedTrack = { event: SoundEvent; offset: number; left: Float32Array; right: Float32Array };

const HOP = 480, WINDOW = 1024;
// A sound starts where spectral flux rises this far above its local median.
const ONSET_RATIO = 1.8, ONSET_MIN_GAP = .06, ONSET_FLOOR_DB = -50;
const SILENCE_DB = -50, SILENCE_LENGTH = .5;
// A sound and a picture change this close are the same moment.
const MATCH = .25;
const CLIP_DB = -.1;
// A share of changed pixels this large starts a visual hit; a strong one should usually be heard.
const HIT = .003, STRONG_HIT = .025;
// A change that puts the picture back as it was this soon (a button pressed and released) is the same hit.
const RETURN = .5;
// Onsets this far under a clip's loudest are its tail or a cut edge, not a new sound.
const FAINT_DB = 20;

const at = (seconds: number) => `${roundTo(seconds, 2)}s`;
const db = (amplitude: number) => amplitude > 0 ? 20 * Math.log10(amplitude) : -120;

/** In-place radix-2 FFT of a power-of-two length. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k, b = a + size / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Seconds (from the first sample) where a sound starts: peaks of log spectral flux above an adaptive threshold,
 * each moved to the first sample where the sound reaches half its level, with that level in dBFS. */
export function detectOnsets(mono: Float32Array, rate = SOUND_RATE) {
  const frames = Math.max(0, Math.floor((mono.length - WINDOW) / HOP) + 1);
  const hann = Float64Array.from({ length: WINDOW }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / WINDOW));
  const flux = new Float64Array(frames), energy = new Float64Array(frames);
  let previous = new Float64Array(WINDOW / 2);
  const re = new Float64Array(WINDOW), im = new Float64Array(WINDOW);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < WINDOW; i++) { const sample = mono[f * HOP + i]; re[i] = sample * hann[i]; im[i] = 0; sum += sample * sample; }
    energy[f] = sum / WINDOW;
    fft(re, im);
    const magnitude = new Float64Array(WINDOW / 2);
    let rise = 0;
    for (let k = 1; k < WINDOW / 2; k++) { magnitude[k] = Math.log1p(100 * Math.hypot(re[k], im[k])); rise += Math.max(0, magnitude[k] - previous[k]); }
    flux[f] = f ? rise : 0;
    previous = magnitude;
  }
  const mean = flux.reduce((sum, value) => sum + value, 0) / Math.max(1, frames);
  const onsets: { time: number; level: number }[] = [];
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    const local = Array.from(flux.subarray(Math.max(0, f - 10), Math.min(frames, f + 11))).sort((a, b) => a - b), median = local[local.length >> 1];
    const loud = Math.max(...energy.subarray(f, Math.min(frames, f + 5)));
    if (flux[f] < median * ONSET_RATIO + mean * .3 || 10 * Math.log10(loud || 1e-12) < ONSET_FLOOR_DB) continue;
    // The flux peaks when the sound has entered the window; its start is the first sample at half the level that follows.
    const from = Math.max(0, (f - 1) * HOP), to = Math.min(mono.length, f * HOP + WINDOW + Math.round(.05 * rate));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(mono[i]));
    let first = from;
    while (first < to && Math.abs(mono[first]) < peak / 2) first++;
    const time = first / rate;
    if (onsets.length && time - onsets[onsets.length - 1].time < ONSET_MIN_GAP) { if (db(peak) > onsets[onsets.length - 1].level) onsets[onsets.length - 1] = { time: onsets[onsets.length - 1].time, level: roundTo(db(peak), 1) }; continue; }
    onsets.push({ time, level: roundTo(db(peak), 1) });
  }
  return onsets;
}

/** ITU-R BS.1770 K-weighting at 48 kHz: a high shelf, then a high pass. */
function kWeighted(channel: Float32Array) {
  const stages = [
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, .73248077421585] },
    { b: [1, -2, 1], a: [-1.99004745483398, .99007225036621] },
  ];
  let input: ArrayLike<number> = channel;
  for (const { b, a } of stages) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const output = new Float64Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const x = input[i], y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; output[i] = y;
    }
    input = output;
  }
  return input as Float64Array;
}

/** Momentary loudness and sample peak each 0.1 s, integrated loudness (gated as BS.1770), and silent stretches. */
function measureLoudness(left: Float32Array, right: Float32Array, rate = SOUND_RATE) {
  const block = Math.round(rate / 10), blocks = Math.floor(left.length / block);
  const [kl, kr] = [kWeighted(left), kWeighted(right)];
  const power: number[] = [], peaks: number[] = [];
  for (let n = 0; n < blocks; n++) {
    let sum = 0, peak = 0;
    for (let i = n * block; i < (n + 1) * block; i++) { sum += kl[i] * kl[i] + kr[i] * kr[i]; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); }
    power.push(sum / block); peaks.push(peak);
  }
  const lufs = (value: number) => value > 0 ? -.691 + 10 * Math.log10(value) : -120;
  const momentary = power.map((_, n) => { const window = power.slice(Math.max(0, n - 3), n + 1); return window.reduce((sum, value) => sum + value, 0) / window.length; });
  const gated = momentary.filter(value => lufs(value) > -70), relative = gated.length ? lufs(gated.reduce((sum, value) => sum + value, 0) / gated.length) - 10 : -70;
  const kept = gated.filter(value => lufs(value) > relative);
  const silences: { start: number; end: number }[] = [];
  for (let n = 0; n < blocks;) {
    if (db(peaks[n]) >= SILENCE_DB) { n++; continue; }
    let m = n; while (m + 1 < blocks && db(peaks[m + 1]) < SILENCE_DB) m++;
    if ((m - n + 1) / 10 >= SILENCE_LENGTH) silences.push({ start: n / 10, end: (m + 1) / 10 });
    n = m + 1;
  }
  return {
    integrated: kept.length ? roundTo(lufs(kept.reduce((sum, value) => sum + value, 0) / kept.length), 1) : null,
    peak: roundTo(db(Math.max(0, ...peaks)), 1),
    levels: momentary.map(value => Math.max(-70, Math.round(lufs(value)))), peaks: peaks.map(value => Math.max(-70, Math.round(db(value)))), silences,
  };
}

/** A song's energy over time, for finding where it builds and hits: each MUSIC_ENERGY_STEP seconds the loudness (LUFS of
 * the K-weighted power over that step), the low band under about 150 Hz (dBFS RMS, where kick and bass live) and how many
 * sounds start. Fed interleaved stereo at SOUND_RATE in chunks of any size, so a whole song is never held twice. */
export function musicEnergy() {
  const rate = SOUND_RATE, step = Math.round(rate * MUSIC_ENERGY_STEP);
  const loudness: number[] = [], low: number[] = [];
  // K-weighting runs sample by sample; same stages as kWeighted.
  const stages = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, .73248077421585], [1, -2, 1, -1.99004745483398, .99007225036621]];
  const state = [new Float64Array(8), new Float64Array(8)];
  const weigh = (x: number, s: Float64Array) => {
    for (let k = 0; k < 2; k++) {
      const [b0, b1, b2, a1, a2] = stages[k], o = k * 4, y = b0 * x + b1 * s[o] + b2 * s[o + 1] - a1 * s[o + 2] - a2 * s[o + 3];
      s[o + 1] = s[o]; s[o] = x; s[o + 3] = s[o + 2]; s[o + 2] = y; x = y;
    }
    return x;
  };
  // One-pole low pass twice over (12 dB per octave) at 150 Hz.
  const alpha = 1 - Math.exp(-2 * Math.PI * 150 / rate);
  let a = 0, b = 0, power = 0, bass = 0, filled = 0, pair = 0, half = 0;
  // Onsets are found on a half-rate mono copy (pairs averaged), a quarter of the stereo input's size.
  let mono = new Float32Array(rate * 30), length = 0;
  return {
    push(interleaved: Float32Array) {
      for (let i = 0; i + 1 < interleaved.length; i += 2) {
        const left = interleaved[i], right = interleaved[i + 1], l = weigh(left, state[0]), r = weigh(right, state[1]), sample = (left + right) / 2;
        power += l * l + r * r;
        a += alpha * (sample - a); b += alpha * (a - b); bass += b * b;
        pair += sample;
        if (++half === 2) { if (length === mono.length) { const grown = new Float32Array(mono.length * 2); grown.set(mono); mono = grown; } mono[length++] = pair / 2; pair = 0; half = 0; }
        if (++filled === step) {
          loudness.push(Math.max(-70, roundTo(power > 0 ? -.691 + 10 * Math.log10(power / step) : -120, 1)));
          low.push(Math.max(-90, roundTo(db(Math.sqrt(bass / step)), 1)));
          power = 0; bass = 0; filled = 0;
        }
      }
    },
    finish(): MusicEnergy {
      const onsets = new Array<number>(loudness.length).fill(0);
      for (const onset of detectOnsets(mono.subarray(0, length), rate / 2)) { const n = Math.floor(onset.time / MUSIC_ENERGY_STEP); if (n < onsets.length) onsets[n]++; }
      return { step: MUSIC_ENERGY_STEP, loudness, low, onsets };
    },
  };
}

/** Starts of picture changes in steadily sampled frames: a step that changes HIT or more of the frame after
 * steps that changed under a third of it. A change that soon puts the picture back as it was before the previous
 * hit (a press and its release, a flash) belongs to that hit. */
export function visualHits(frames: Uint8Array[], start: number, fps: number): VisualHit[] {
  const change = frames.slice(1).map((next, i) => changed(frames[i], next)), hits: (VisualHit & { step: number })[] = [];
  for (let i = 0; i < change.length; i++) {
    const before = Math.max(change[i - 1] ?? 0, change[i - 2] ?? 0, .0005);
    if (change[i] < HIT || change[i] < before * 3) continue;
    const previous = hits[hits.length - 1], size = change.slice(i, i + 3).reduce((sum, share) => sum + share, 0);
    if (previous && (i - previous.step) / fps <= RETURN && changed(frames[previous.step], frames[Math.min(frames.length - 1, i + 3)]) < previous.size * .25) continue;
    hits.push({ time: roundTo(start + (i + 1) / fps, 3), size: roundTo(size, 3), step: i });
  }
  return hits.map(({ time, size }) => ({ time, size }));
}

// Silence ahead of each clip, so a sound on its very first sample still rises out of quiet.
const LEAD = WINDOW + HOP;
const mono = (track: DecodedTrack) => { const out = new Float32Array(LEAD + track.left.length); for (let i = 0; i < track.left.length; i++) out[LEAD + i] = (track.left[i] + track.right[i]) / 2; return out; };
const loudest = <T extends { level: number }>(onsets: T[]) => { const top = Math.max(...onsets.map(onset => onset.level)); return onsets.filter(onset => onset.level >= top - FAINT_DB); };

/** Sum the tracks into the range's mix as export does (amix of every track, restored to unity) and report it. */
export function analyzeSound(tracks: DecodedTrack[], words: SoundWord[], range: { start: number; end: number }, masterGain = 1, check?: { fps: number; timelineFps: number; hits: VisualHit[] }): SoundResult {
  const length = Math.max(1, Math.round((range.end - range.start) * SOUND_RATE)), left = new Float32Array(length), right = new Float32Array(length);
  for (const track of tracks) for (let i = 0; i < track.left.length && track.offset + i < length; i++) { left[track.offset + i] += track.left[i] * masterGain; right[track.offset + i] += track.right[i] * masterGain; }
  const loudness = measureLoudness(left, right);
  const perTrack = tracks.map(track => ({ track, onsets: loudest(detectOnsets(mono(track))).map(onset => ({ ...onset, time: range.start + (track.offset - LEAD) / SOUND_RATE + onset.time })) }));
  // A mix onset comes from the clips that start a sound within 30 ms of it, else from whatever is playing then.
  const onsets = loudest(detectOnsets(Float32Array.from(left, (sample, i) => (sample + right[i]) / 2))).map(onset => {
    const time = range.start + onset.time, starting = perTrack.filter(item => item.onsets.some(other => Math.abs(other.time - time) < .03));
    const playing = starting.length ? starting.map(item => item.track) : tracks.filter(track => time >= track.event.start && time < track.event.end);
    return { time: roundTo(time, 3), level: onset.level, sources: [...new Set(playing.map(track => track.event.name))] };
  });
  const offsetTime = (value: { start: number; end: number }) => ({ start: roundTo(range.start + value.start, 2), end: roundTo(range.start + value.end, 2) });
  const result: SoundResult = {
    start: range.start, end: range.end, loudness: { integrated: loudness.integrated, peak: loudness.peak }, levels: loudness.levels, peaks: loudness.peaks,
    events: tracks.map(track => track.event), onsets, words, silences: loudness.silences.map(offsetTime),
  };
  if (!check) return result;

  const flags: SoundFlag[] = [];
  const effectOnsets = perTrack.filter(item => item.track.event.kind === 'sfx').flatMap(item => item.onsets.map(onset => ({ time: roundTo(onset.time, 3), clipId: item.track.event.clipId, name: item.track.event.name }))).sort((a, b) => a.time - b.time);
  // One to one, closest pairs first.
  const pairs = effectOnsets.flatMap((sound, s) => check.hits.map((hit, h) => ({ s, h, distance: Math.abs(sound.time - hit.time) }))).filter(pair => pair.distance <= MATCH).sort((a, b) => a.distance - b.distance);
  const soundMatch = new Map<number, number>(), hitMatch = new Map<number, number>();
  for (const pair of pairs) if (!soundMatch.has(pair.s) && !hitMatch.has(pair.h)) { soundMatch.set(pair.s, pair.h); hitMatch.set(pair.h, pair.s); }
  // Frames are sampled at check.fps, so a picture change is only known to within one sample.
  const tolerance = Math.max(2 / check.timelineFps, 1 / check.fps) + .005;
  for (const [s, sound] of effectOnsets.entries()) {
    const h = soundMatch.get(s);
    // A second sound inside one effect right after a matched one (a press and release, a double click) is the count flag's to explain.
    const partOf = effectOnsets.some((other, o) => o < s && other.clipId === sound.clipId && soundMatch.has(o) && sound.time - other.time < .4);
    if (h === undefined && partOf) continue;
    if (h === undefined) { flags.push({ start: sound.time, end: roundTo(sound.time + .1, 2), kind: 'no-visual', reason: `"${sound.name}" sounds at ${at(sound.time)} but nothing changes in the picture within ${MATCH} s: move it onto the motion it belongs to, or remove it.` }); continue; }
    const offset = sound.time - check.hits[h].time;
    if (Math.abs(offset) > tolerance) flags.push({ start: roundTo(Math.min(sound.time, check.hits[h].time), 2), end: roundTo(Math.max(sound.time, check.hits[h].time), 2), kind: 'offset', reason: `"${sound.name}" lands ${roundTo(Math.abs(offset), 3)} s (${Math.round(Math.abs(offset) * check.timelineFps)} frames) ${offset > 0 ? 'after' : 'before'} the picture change at ${at(check.hits[h].time)}: move it to ${at(check.hits[h].time)}.` });
  }
  if (effectOnsets.length) for (const [h, hit] of check.hits.entries()) {
    if (hitMatch.has(h) || hit.size < STRONG_HIT) continue;
    flags.push({ start: hit.time, end: roundTo(hit.time + .1, 2), kind: 'no-sound', reason: `${Math.round(hit.size * 100)}% of the picture changes at ${at(hit.time)} with no sound effect: if this moment should land (a click, a hit, a cut), give it one.` });
  }
  // Moments where sounds and picture changes cluster: their counts should agree (two clicks on screen, two click sounds).
  const moments = [...effectOnsets.map(sound => ({ time: sound.time, sound: true, name: sound.name })), ...check.hits.map(hit => ({ time: hit.time, sound: false, name: '' }))].sort((a, b) => a.time - b.time);
  for (let i = 0; i < moments.length;) {
    let j = i; while (j + 1 < moments.length && moments[j + 1].time - moments[j].time < .5) j++;
    const group = moments.slice(i, j + 1), heard = group.filter(item => item.sound), sounds = heard.length, hits = group.length - sounds;
    const repeated = [...new Set(heard.map(item => item.name))].filter(name => heard.filter(item => item.name === name).length > 1);
    const inside = repeated.length ? ` ("${repeated.join('", "')}" itself makes ${repeated.map(name => heard.filter(item => item.name === name).length).join(', ')} sounds: a press and release or a double click; trim it to one, or pick a single-hit sound)` : '';
    if (sounds && hits && sounds !== hits) flags.push({ start: roundTo(group[0].time, 2), end: roundTo(group[group.length - 1].time, 2), kind: 'count', reason: `${sounds} sounds but ${hits} picture change${hits > 1 ? 's' : ''} between ${at(group[0].time)} and ${at(group[group.length - 1].time)}${inside}: each visible action gets exactly one sound.` });
    i = j + 1;
  }
  for (const sound of effectOnsets) {
    const word = words.find(item => sound.time >= item.start && sound.time < item.end);
    if (word) flags.push({ start: roundTo(word.start, 2), end: roundTo(word.end, 2), kind: 'over-word', reason: `"${sound.name}" at ${at(sound.time)} lands on the spoken word "${word.text}" (${at(word.start)}-${at(word.end)}) and can mask it: move it between words or lower it.` });
  }
  for (let n = 0; n < loudness.peaks.length;) {
    if (loudness.peaks[n] < CLIP_DB) { n++; continue; }
    let m = n; while (m + 1 < loudness.peaks.length && loudness.peaks[m + 1] >= CLIP_DB) m++;
    flags.push({ start: roundTo(range.start + n / 10, 2), end: roundTo(range.start + (m + 1) / 10, 2), kind: 'clipping', reason: `The mix reaches full scale (${loudness.peak} dBFS) here and will distort: lower the loudest clips playing (music or effects) until peaks stay under -1 dBFS.` });
    n = m + 1;
  }
  return { ...result, check: { fps: check.fps, visualHits: check.hits, effectOnsets, flags: flags.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind)) } };
}
