import { roundTo } from '../math';
import type { BeatMap, MusicEnergy } from './beat-map';

/** A song read from its measured beat map and energy: bars on the downbeats, each bar's loudness, the sections
 * where the energy changes at a bar line, the moments where it gets good, and the best windows for an edit length.
 * Everything here is in SOURCE seconds of the song. */

export type SectionKind = 'low' | 'mid' | 'build' | 'peak' | 'drop' | 'outro';
export type MusicBar = { bar: number; start: number; end: number; lufs: number; low: number; onsetsPerSecond: number };
export type MusicSection = { kind: SectionKind; start: number; end: number; bars: string; lufs: number; confidence: number; why: string };
export type MusicMoment = { rank: number; time: number; bar: number; score: number; jumpDb: number; lowJumpDb: number; onsetsPerSecond: { before: number; after: number }; why: string; sung?: string };
export type MusicWindow = { target: number; start: number; end: number; seconds: number; bars: string; score: number; opensOn: string; endsOn: string };
export type MusicStructure = {
  bpm: number; beatsPerBar: number; barSeconds: number; beatConfidence: number;
  loudLufs: number; quietLufs: number;
  bars: MusicBar[]; sections: MusicSection[]; moments: MusicMoment[]; windows: MusicWindow[];
  measuredUntil: number;
};
export type MusicWord = { text: string; start: number; end: number };

// A bar line where loudness changes this much (dB, 2 bars after against 2 before) starts a new section.
const SECTION_JUMP_DB = 2.5;
// Sections are at least this many bars, except the last.
const MIN_SECTION_BARS = 4;
// A section this close to the song's loud level (90th percentile bar) is a peak; this far under it is low.
const PEAK_DB = -2.5, LOW_DB = -6;
// A peak entered with a jump this large (loudness, or the low band where kick and bass sit) is a drop.
const DROP_JUMP_DB = 5, DROP_LOW_JUMP_DB = 8;
// A section rising at least this much per bar is a build.
const BUILD_SLOPE_DB = .4;
// A bar line is a candidate moment when loudness jumps this much into it.
const MOMENT_JUMP_DB = 3;
// Two moments closer than this many bars are the same arrival; the stronger one stays.
const MOMENT_SPACING_BARS = 8;
const MAX_MOMENTS = 5, MAX_WINDOWS = 3;
// An edit length within this share of a whole 4-bar phrase count uses the phrase count.
const PHRASE_TOLERANCE = .15;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : 0; };
const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : 0; };
/** Mean of dB values as power, back in dB. */
const powerMean = (values: number[]) => values.length ? 10 * Math.log10(values.reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length) : -70;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(roundTo(value, 1))}`;

/** Bar lines: the tracker's downbeats, or every fourth beat when it found none. */
function barLines(map: BeatMap) {
  const downbeats = (map.downbeats?.length ?? 0) >= 2 ? map.downbeats! : map.beats.filter((_, index) => index % 4 === 0);
  const perBar = downbeats.slice(1).map((time, index) => map.beats.filter(beat => beat >= downbeats[index] - .02 && beat < time - .02).length).filter(count => count > 0);
  return { downbeats, beatsPerBar: perBar.length ? median(perBar) : 4 };
}

function measureBars(downbeats: number[], barSeconds: number, energy: MusicEnergy, duration: number): MusicBar[] {
  const measured = energy.loudness.length * energy.step;
  return downbeats.flatMap((start, index) => {
    const end = Math.min(downbeats[index + 1] ?? start + barSeconds, duration);
    if (end - start < barSeconds / 2 || end > measured + energy.step) return [];
    const from = Math.floor(start / energy.step), to = Math.max(from + 1, Math.min(energy.loudness.length, Math.round(end / energy.step)));
    const steps = to - from, onsets = energy.onsets.slice(from, to).reduce((sum, count) => sum + count, 0);
    return [{ bar: index + 1, start: roundTo(start, 3), end: roundTo(end, 3), lufs: roundTo(powerMean(energy.loudness.slice(from, to)), 1), low: roundTo(powerMean(energy.low.slice(from, to)), 1), onsetsPerSecond: roundTo(onsets / (steps * energy.step), 1) }];
  });
}

const span = (bars: MusicBar[], from: number, to: number) => bars.slice(Math.max(0, from), Math.max(0, Math.min(bars.length, to)));
const level = (bars: MusicBar[]) => powerMean(bars.map(bar => bar.lufs));
const lowLevel = (bars: MusicBar[]) => powerMean(bars.map(bar => bar.low));
const density = (bars: MusicBar[]) => bars.length ? bars.reduce((sum, bar) => sum + bar.onsetsPerSecond, 0) / bars.length : 0;
/** Loudness change at bar line i: the `width` bars after against the `width` before. */
const jumpAt = (bars: MusicBar[], i: number, width: number, of = level) => i <= 0 ? 0 : of(span(bars, i, i + width)) - of(span(bars, i - width, i));
const slope = (values: number[]) => {
  if (values.length < 2) return 0;
  const mean = (values.length - 1) / 2, average = values.reduce((sum, value) => sum + value, 0) / values.length;
  let covariance = 0, variance = 0;
  values.forEach((value, x) => { covariance += (x - mean) * (value - average); variance += (x - mean) ** 2; });
  return covariance / variance;
};

function findSections(bars: MusicBar[], loud: number, beatConfidence: number): MusicSection[] {
  const scored = bars.map((_, i) => ({ i, score: Math.max(Math.abs(jumpAt(bars, i, 2)), .6 * Math.abs(jumpAt(bars, i, 2, lowLevel))) }))
    .filter(item => item.i >= MIN_SECTION_BARS && item.i <= bars.length - 2 && item.score >= SECTION_JUMP_DB).sort((a, b) => b.score - a.score);
  const cuts: number[] = [];
  for (const { i } of scored) if (cuts.every(cut => Math.abs(cut - i) >= MIN_SECTION_BARS)) cuts.push(i);
  const edges = [0, ...cuts.sort((a, b) => a - b), bars.length];
  const parts = edges.slice(0, -1).map((from, k) => ({ from, to: edges[k + 1], bars: bars.slice(from, edges[k + 1]) }));
  return parts.map((part, k) => {
    const lufs = level(part.bars), rel = lufs - loud, trend = slope(part.bars.map(bar => bar.lufs));
    const entry = k ? lufs - level(parts[k - 1].bars) : 0, lowEntry = k ? lowLevel(part.bars) - lowLevel(parts[k - 1].bars) : 0;
    const next = parts[k + 1], nextRel = next ? level(next.bars) - loud : -Infinity;
    const risesInto = !!next && nextRel >= PEAK_DB && level(part.bars.slice(-2)) - level(part.bars.slice(0, 2)) >= 2;
    let kind: SectionKind, strength: number;
    if (!next && k && rel < -3 && entry <= -2) { kind = 'outro'; strength = clamp01(-entry / 6); }
    else if (rel >= PEAK_DB && k && (entry >= DROP_JUMP_DB || lowEntry >= DROP_LOW_JUMP_DB)) { kind = 'drop'; strength = clamp01(Math.max(entry / 8, lowEntry / 12)); }
    else if (rel >= PEAK_DB) { kind = 'peak'; strength = clamp01((rel + 4) / 4); }
    else if (trend >= BUILD_SLOPE_DB || risesInto) { kind = 'build'; strength = clamp01(Math.max(trend, risesInto ? .6 : 0)); }
    else if (rel <= LOW_DB) { kind = 'low'; strength = clamp01((-rel - 4) / 6); }
    else { kind = 'mid'; strength = .3; }
    const why = [`${signed(rel)} dB against the song's loud level`, k ? `enters ${signed(entry)} dB (low band ${signed(lowEntry)} dB)` : 'opens the song', Math.abs(trend) >= .2 ? `${signed(trend)} dB per bar` : '', `${roundTo(density(part.bars), 1)} onsets/s`].filter(Boolean).join(', ');
    return { kind, start: part.bars[0].start, end: part.bars[part.bars.length - 1].end, bars: `${part.bars[0].bar}-${part.bars[part.bars.length - 1].bar}`, lufs: roundTo(lufs, 1), confidence: roundTo(clamp01((.35 + .65 * strength) * (.6 + .4 * beatConfidence)), 2), why };
  });
}

function sungAt(words: MusicWord[], from: number, to: number) {
  const first = words.findIndex(word => word.start >= from && word.start < to);
  if (first < 0) return undefined;
  const line = [words[first]];
  for (let i = first + 1; i < words.length && line.length < 8 && words[i].start - words[i - 1].end < .6; i++) line.push(words[i]);
  return line.map(word => word.text).join(' ');
}

function findMoments(bars: MusicBar[], sections: MusicSection[], loud: number, words: MusicWord[]): MusicMoment[] {
  const sectionStarts = new Set(sections.slice(1).filter(section => section.kind === 'peak' || section.kind === 'drop').map(section => section.start));
  const candidates = bars.flatMap((bar, i) => {
    const jump = jumpAt(bars, i, 4), lowJump = jumpAt(bars, i, 4, lowLevel), after = level(span(bars, i, i + 4)) - loud;
    if (i && jump < MOMENT_JUMP_DB && !sectionStarts.has(bar.start)) return [];
    if (after < LOW_DB) return [];
    const before = density(span(bars, i - 4, i)), next = density(span(bars, i, i + 4));
    const sung = sungAt(words, bar.start - .3, bar.start + 2 * (bar.end - bar.start));
    const score = .35 * clamp01(jump / 8) + .25 * clamp01(lowJump / 12) + .3 * clamp01((after + 6) / 6) + .1 * clamp01((next - before) / (before + 1)) + (sung ? .05 : 0);
    const why = [i ? `${signed(jump)} dB over the 4 bars before` : 'the song opens here', i && Math.abs(lowJump) >= 1 ? `low band ${signed(lowJump)} dB` : '', `onsets ${roundTo(before, 1)} → ${roundTo(next, 1)}/s`, `${signed(after)} dB against the loud level`, sectionStarts.has(bar.start) ? 'starts a loud section' : ''].filter(Boolean).join(', ');
    return [{ i, moment: { rank: 0, time: bar.start, bar: bar.bar, score: roundTo(Math.min(1, score), 2), jumpDb: roundTo(jump, 1), lowJumpDb: roundTo(lowJump, 1), onsetsPerSecond: { before: roundTo(before, 1), after: roundTo(next, 1) }, why, ...(sung ? { sung } : {}) } }];
  }).sort((a, b) => b.moment.score - a.moment.score);
  const kept: typeof candidates = [];
  for (const candidate of candidates) if (kept.length < MAX_MOMENTS && kept.every(other => Math.abs(other.i - candidate.i) >= MOMENT_SPACING_BARS)) kept.push(candidate);
  return kept.map((item, index) => ({ ...item.moment, rank: index + 1 }));
}

/** Whole bars closest to a length, preferring whole 4-bar phrases. */
export function barsForLength(seconds: number, barSeconds: number) {
  const phrases = Math.max(4, Math.round(seconds / barSeconds / 4) * 4);
  return Math.abs(phrases * barSeconds - seconds) <= PHRASE_TOLERANCE * seconds ? phrases : Math.max(1, Math.round(seconds / barSeconds));
}

function findWindows(bars: MusicBar[], sections: MusicSection[], moments: MusicMoment[], loud: number, barSeconds: number, targets: number[]): MusicWindow[] {
  const boundaries = new Set(sections.map(section => section.end));
  return targets.flatMap(target => {
    const count = Math.min(bars.length, barsForLength(target, barSeconds));
    const options = bars.slice(0, bars.length - count + 1).map((first, i) => {
      const inside = bars.slice(i, i + count), last = inside[inside.length - 1];
      const opening = moments.find(moment => moment.bar === first.bar);
      const section = sections.find(item => Math.abs(item.start - first.start) < 1e-3);
      const endsOnSection = boundaries.has(last.end), phraseEnd = count % 4 === 0;
      const score = .45 * clamp01((level(inside) - loud + 8) / 8) + .4 * (opening?.score ?? (section ? .3 : 0)) + .15 * (endsOnSection ? 1 : phraseEnd ? .5 : 0);
      return {
        target, start: first.start, end: last.end, seconds: roundTo(last.end - first.start, 3), bars: `${first.bar}-${last.bar}`, score: roundTo(score, 2),
        opensOn: opening ? `moment ${opening.rank} (bar ${opening.bar})` : section ? `start of a ${section.kind} section` : `bar ${first.bar}`,
        endsOn: endsOnSection ? `the end of a section at ${clock(last.end)}` : phraseEnd ? `the end of its ${count}-bar phrase` : `bar ${last.bar} (${count} bars, not a whole phrase)`,
      };
    }).sort((a, b) => b.score - a.score);
    const kept: MusicWindow[] = [];
    for (const option of options) if (kept.length < MAX_WINDOWS && kept.every(other => Math.abs(other.start - option.start) >= 4 * barSeconds - 1e-3)) kept.push(option);
    return kept;
  });
}

/** Read the song. Needs a beat map with energy; `words` (a saved transcript) names the sung line at a moment. */
export function musicStructure(map: BeatMap & { energy: MusicEnergy }, duration: number, words: MusicWord[] = [], targets: number[] = [15, 30]): MusicStructure {
  const { downbeats, beatsPerBar } = barLines(map);
  if (downbeats.length < 4) throw new Error('This audio has too few measured bars to read its structure (it may be speech, silence or free time).');
  const barSeconds = median(downbeats.slice(1).map((time, index) => time - downbeats[index]));
  const bars = measureBars(downbeats, barSeconds, map.energy, duration);
  if (bars.length < 4) throw new Error('This audio has too few measured bars to read its structure.');
  const loud = percentile(bars.map(bar => bar.lufs), .9), quiet = percentile(bars.map(bar => bar.lufs), .1);
  const sections = findSections(bars, loud, map.confidence);
  const moments = findMoments(bars, sections, loud, words);
  return {
    bpm: roundTo(map.bpm, 1), beatsPerBar, barSeconds: roundTo(barSeconds, 3), beatConfidence: roundTo(map.confidence, 2),
    loudLufs: roundTo(loud, 1), quietLufs: roundTo(quiet, 1),
    bars, sections, moments, windows: findWindows(bars, sections, moments, loud, barSeconds, targets),
    measuredUntil: roundTo(Math.min(duration, map.energy.loudness.length * map.energy.step), 2),
  };
}

/** The downbeat nearest a source second, for starting a song on a bar line. */
export function nearestDownbeat(map: BeatMap, time: number) {
  const { downbeats } = barLines(map);
  return downbeats.reduce((best, beat) => Math.abs(beat - time) < Math.abs(best - time) ? beat : best, downbeats[0] ?? time);
}
