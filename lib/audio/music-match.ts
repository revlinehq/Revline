import { roundTo } from '../math';
import type { BeatMap } from '../media-analysis/beat-map';
import type { AudioWaveform } from '../editor/types';
import { decodeWaveform } from '../editor/audio-waveform';
import type { MusicFeel } from './music-bed';
import { STOCK_MUSIC_CATALOG, type StockMusic } from '../editor/stock-music';

// Measuring a reference's music to match it: tempo and beat grid from its beat map, an energy curve from its
// waveform, a feel from both; then the phase that puts a new track's downbeats on the film's main moments.

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : 0; };

/** Loudness 0..1 per window of `seconds`, relative to the loud parts of the track. */
export function energyCurve(waveform: AudioWaveform, duration: number, seconds: number, from = 0) {
  const { samples, samplesPerSecond } = decodeWaveform(waveform);
  const windows = Math.max(1, Math.ceil((duration - from) / seconds));
  const raw = Array.from({ length: windows }, (_, index) => {
    const a = Math.max(0, Math.floor((from + index * seconds) * samplesPerSecond)), b = Math.min(samples.length, Math.ceil((from + (index + 1) * seconds) * samplesPerSecond));
    let sum = 0; for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    return b > a ? Math.sqrt(sum / (b - a)) : 0;
  });
  const loud = [...raw].sort((x, y) => x - y)[Math.floor(raw.length * .9)] || 1;
  return { values: raw.map(value => roundTo(Math.min(1, value / loud), 2)), level: roundTo(median(raw) / 255, 3) };
}

export function feelOf(bpm: number, energy: number[]): MusicFeel {
  const average = energy.reduce((sum, value) => sum + value, 0) / Math.max(1, energy.length);
  if (bpm < 85) return average > .75 ? 'warm' : 'calm';
  if (bpm < 112) return average > .7 ? 'upbeat' : 'warm';
  return bpm >= 135 && average > .65 ? 'driving' : 'upbeat';
}

/** The reference's grid: beat period from the median beat interval, first downbeat, and its bpm. */
export function beatGrid(beats: BeatMap) {
  const intervals = beats.beats.slice(1).map((time, index) => time - beats.beats[index]).filter(value => value > .2 && value < 2);
  let period = intervals.length ? median(intervals) : 60 / beats.bpm;
  // The tracker's frames are 20 ms, so one interval is quantized: fit one period through every beat (counting skipped ones).
  const first = beats.beats[0] ?? 0, index = beats.beats.map(time => Math.round((time - first) / period));
  const meanIndex = index.reduce((sum, value) => sum + value, 0) / Math.max(1, index.length), meanTime = beats.beats.reduce((sum, value) => sum + value, 0) / Math.max(1, beats.beats.length);
  const spread = index.reduce((sum, value) => sum + (value - meanIndex) ** 2, 0);
  if (spread > 0) period = index.reduce((sum, value, i) => sum + (value - meanIndex) * (beats.beats[i] - meanTime), 0) / spread;
  const bar = period * 4;
  // The phase that best fits the measured downbeats (or beats, every 4th) on a constant grid.
  const anchors = beats.downbeats?.length ? beats.downbeats : beats.beats.filter((_, index) => index % 4 === 0);
  const phase = anchors.length ? circularMean(anchors.map(time => ((time % bar) + bar) % bar), bar) : 0;
  return { period: roundTo(period, 4), bar: roundTo(bar, 4), phase: roundTo(phase, 3), bpm: roundTo(60 / period, 2) };
}

function circularMean(values: number[], cycle: number) {
  const x = values.reduce((sum, value) => sum + Math.cos(2 * Math.PI * value / cycle), 0), y = values.reduce((sum, value) => sum + Math.sin(2 * Math.PI * value / cycle), 0);
  const angle = Math.atan2(y, x);
  return ((angle / (2 * Math.PI)) * cycle + cycle) % cycle;
}

/** The phase (first downbeat, 0..bar) that puts downbeats closest to the given moments; beats count at half weight. */
export function phaseForMoments(moments: number[], period: number) {
  const bar = period * 4;
  let best = { phase: 0, cost: Infinity };
  for (let step = 0; step < 200; step++) {
    const phase = bar * step / 200;
    const cost = moments.reduce((sum, time) => {
      const toDownbeat = Math.abs(((time - phase) % bar + bar * 1.5) % bar - bar / 2);
      const toBeat = Math.abs(((time - phase) % period + period * 1.5) % period - period / 2);
      return sum + Math.min(toDownbeat, toBeat + period * .15);
    }, 0);
    if (cost < best.cost) best = { phase, cost };
  }
  return roundTo(best.phase, 3);
}

/** How far each moment sits from the nearest downbeat and beat of a grid. */
export function momentFit(moments: number[], period: number, phase: number) {
  const bar = period * 4, off = (time: number, cycle: number) => roundTo(((time - phase) % cycle + cycle * 1.5) % cycle - cycle / 2, 3);
  return moments.map(time => ({ time, fromDownbeat: off(time, bar), fromBeat: off(time, period) }));
}

/** Library tracks ranked for a reference: tempo first (allowing half and double time, up to 8% of speed change),
 * then the same feel from tempo and energy, then genre and mood words. */
export function rankStockMusic(target: { bpm: number; energy: number[]; level?: number; style?: string; trackId?: string }) {
  const words = (target.style ?? '').toLowerCase().split(/[^a-z0-9&-]+/).filter(word => word.length > 2);
  const feel = feelOf(target.bpm, target.energy), feels: MusicFeel[] = ['calm', 'warm', 'upbeat', 'driving'];
  const tracks = target.trackId ? STOCK_MUSIC_CATALOG.filter(track => track.id === target.trackId) : STOCK_MUSIC_CATALOG;
  return tracks.map(track => {
    const rate = [1, 2, .5].map(multiple => target.bpm / (track.bpm * multiple)).reduce((best, value) => Math.abs(Math.log(value)) < Math.abs(Math.log(best)) ? value : best);
    const tempo = Math.exp(-Math.abs(Math.log(rate)) / .03);
    const trackFeel = feelOf(track.bpm, energyCurve(track.waveform, track.duration, 1).values);
    const sameFeel = 1 - Math.abs(feels.indexOf(trackFeel) - feels.indexOf(feel)) / 3;
    const haystack = [track.genre, ...track.tags].join(' ').toLowerCase();
    const style = words.length ? words.filter(word => haystack.includes(word)).length / words.length : .5;
    return { track, rate: Math.round(rate * 10000) / 10000, fits: Math.abs(rate - 1) <= .08, score: roundTo(.55 * tempo + .25 * sameFeel + .2 * style, 3) };
  }).sort((a, b) => Number(b.fits) - Number(a.fits) || b.score - a.score);
}

/** Where in a track to start so its downbeat lands on the reference's first downbeat (phase, reference seconds), at the
 * playback rate that locks the tempo: the downbeat whose following stretch best follows the reference's energy. */
export function placeStockMusic(track: StockMusic, rate: number, phase: number, duration: number, energy: number[]) {
  const trackEnergy = energyCurve(track.waveform, track.duration, 1).values;
  const downbeats = track.downbeats.length ? track.downbeats : track.beats.filter((_, index) => index % 4 === 0);
  let best = { sourceStart: 0, score: -Infinity };
  for (const downbeat of downbeats) {
    const sourceStart = downbeat - phase * rate;
    if (sourceStart < 0) continue;
    const room = Math.min(1, (track.duration - sourceStart) / (duration * rate));
    const seconds = Math.max(1, Math.floor(duration));
    const a = Array.from({ length: seconds }, (_, t) => trackEnergy[Math.min(trackEnergy.length - 1, Math.floor(sourceStart + t * rate))] ?? 0);
    const b = Array.from({ length: seconds }, (_, t) => energy[t] ?? energy.at(-1) ?? .5);
    const score = (energy.length ? correlation(a, b) : 0) + 2 * (room - 1) - .15 * sourceStart / track.duration;
    if (score > best.score) best = { sourceStart, score };
  }
  return { sourceStart: roundTo(best.sourceStart, 3), rate: Math.abs(rate - 1) < .004 ? 1 : rate };
}

function correlation(a: number[], b: number[]) {
  const ma = a.reduce((sum, value) => sum + value, 0) / a.length, mb = b.reduce((sum, value) => sum + value, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
