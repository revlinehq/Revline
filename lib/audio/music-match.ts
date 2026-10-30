import type { BeatMap } from '../media-analysis/beat-map';
import type { AudioWaveform } from '../editor/types';
import { decodeWaveform } from '../editor/audio-waveform';
import type { MusicFeel } from './music-bed';

// Measuring a reference's music to match it: tempo and beat grid from its beat map, an energy curve from its
// waveform, a feel from both; then the phase that puts a new track's downbeats on the film's main moments.

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
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
  return { values: raw.map(value => round(Math.min(1, value / loud), 2)), level: round(median(raw) / 255, 3) };
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
  const period = intervals.length ? median(intervals) : 60 / beats.bpm;
  const bar = period * 4;
  // The phase that best fits the measured downbeats (or beats, every 4th) on a constant grid.
  const anchors = beats.downbeats?.length ? beats.downbeats : beats.beats.filter((_, index) => index % 4 === 0);
  const phase = anchors.length ? circularMean(anchors.map(time => ((time % bar) + bar) % bar), bar) : 0;
  return { period: round(period, 4), bar: round(bar, 4), phase: round(phase), bpm: round(60 / period, 2) };
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
  return round(best.phase);
}

/** How far each moment sits from the nearest downbeat and beat of a grid. */
export function momentFit(moments: number[], period: number, phase: number) {
  const bar = period * 4, off = (time: number, cycle: number) => round(((time - phase) % cycle + cycle * 1.5) % cycle - cycle / 2, 3);
  return moments.map(time => ({ time, fromDownbeat: off(time, bar), fromBeat: off(time, period) }));
}
