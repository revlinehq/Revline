import { TRANSIENT_FLAGS, describeFlags, lookBaseline, sampleFlags, type EyeFlag, type EyesPolicy, type LookSample } from '../../eyes';
import { playbackRateOf, sourceEndOf } from '../../../editor/playback-rate';
import type { Clip, Timeline } from '../../../editor/types';
import type { Transcript } from '../../../media-analysis/transcript';
import { wordAnchor } from './script';

/** The reel lane's use of the shared eyes: where a talking take is cut, what the speaker looks like there,
 * and the nearest clean frame inside the pause the cut sits in. Pure; the worker measures the frames. */

type Word = { text: string; start: number; end: number };
export type Range = { start: number; end: number };
export type Spot = {
  /** "<clipId>:in" or "<clipId>:out". */
  id: string;
  clipId: string;
  assetId: string;
  side: 'in' | 'out';
  /** The cut edge now, in SOURCE and timeline seconds. */
  source: number;
  timeline: number;
  /** The reel's very first or very last frame. */
  first: boolean;
  last: boolean;
  /** Where the adjacent retained word begins (in) or ends (out), and how far the edge may move without touching a word. */
  word: number;
  from: number;
  to: number;
};
export type SpotReading = {
  spot: Spot;
  flagged: boolean;
  /** What was measured at and around the cut, with source times. */
  seen: string[];
  /** The nearest clean frame the edge can move to; undefined when the pause holds none. */
  moveTo?: number;
  /** No frame of this edge was measured: it is unverified, never clean. */
  unmeasured?: boolean;
};
type SpeechAsset = { _id: string; audioAssetId?: string; duration?: number; analysis?: { transcript?: Transcript } };

const STEP = .125, REACH = .75, LEAD = .03, TAIL = .05, NATURAL_TAIL = .35;
const inside = (time: number, ranges: Range[], pad = 0) => ranges.some(range => time >= range.start - pad && time <= range.end + pad);
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The cut as its video pieces: an edge check stays valid while this is unchanged, whatever else is edited. */
export function cutKey(timeline: Timeline) {
  return timeline.clips.filter(clip => clip.kind === 'video' && clip.assetId).sort((a, b) => a.start - b.start)
    .map(clip => `${clip.assetId}:${clip.sourceStart.toFixed(2)}-${sourceEndOf(clip).toFixed(2)}`).join('|');
}

/** Start and end of every retained speech piece. Pieces without words (b-roll, silence) and edges inside b-roll have no speaker to judge. */
export function reelSpots(timeline: Timeline, assets: SpeechAsset[], broll: Record<string, Range[]> = {}): Spot[] {
  const pieces = timeline.clips.filter(clip => clip.kind === 'video' && clip.assetId && !clip.speedRamp?.length).sort((a, b) => a.start - b.start);
  const speech = pieces.flatMap(clip => {
    const asset = assets.find(item => item._id === clip.assetId), words: Word[] = asset?.analysis?.transcript?.words ?? [];
    const kept = words.filter(word => { const onset = wordAnchor(word); return onset >= clip.sourceStart && onset < sourceEndOf(clip); });
    return asset && kept.length ? [{ clip, asset, words, kept }] : [];
  });
  return speech.flatMap(({ clip, asset, words, kept }, index) => {
    const first = kept[0], last = kept.at(-1)!, before = words[words.indexOf(first) - 1], after = words[words.indexOf(last) + 1];
    const end = sourceEndOf(clip), shots = broll[asset._id] ?? [];
    const spots: Spot[] = [];
    if (!inside(clip.sourceStart, shots, .2)) spots.push({ id: `${clip.id}:in`, clipId: clip.id, assetId: asset._id, side: 'in', source: round(clip.sourceStart), timeline: round(clip.start), first: index === 0, last: false,
      word: first.start, from: round(Math.max(before?.end ?? 0, first.start - REACH)), to: round(Math.max(clip.sourceStart, first.start - LEAD)) });
    if (!inside(end, shots, .2)) spots.push({ id: `${clip.id}:out`, clipId: clip.id, assetId: asset._id, side: 'out', source: round(end), timeline: round(clip.start + clip.duration), first: false, last: index === speech.length - 1,
      word: last.end, from: round(Math.min(end, last.end + TAIL)), to: round(Math.min(after?.start ?? asset.duration ?? end, last.end + REACH + (index === speech.length - 1 ? .5 : 0), clip.sourceStart + (asset.duration ?? Infinity))) });
    return spots;
  });
}

/** The source frames to measure for a spot: the pause the edge sits in, the edge itself and a little of the word. */
export function spotTimes(spot: Spot, duration = Infinity) {
  const from = spot.side === 'in' ? Math.min(spot.from, spot.source) : spot.word - .25, to = spot.side === 'in' ? spot.word + .25 : Math.max(spot.to, spot.source);
  const times = [spot.source];
  for (let time = from; time <= to + 1e-6; time += STEP) times.push(time);
  return [...new Set(times.map(time => round(Math.max(0, Math.min(duration - .04, time)))))].sort((a, b) => a - b);
}

/** Judge one edge from measured frames: is the speaker presentable at the cut, and if not, where is the nearest clean frame in the pause. */
export function readSpot(spot: Spot, samples: LookSample[], policy: EyesPolicy, baseline = lookBaseline(samples)): SpotReading {
  const local = samples.filter(sample => sample.time >= Math.min(spot.from, spot.source, spot.word - .25) - .01 && sample.time <= Math.max(spot.to, spot.source, spot.word + .25) + .01).sort((a, b) => a.time - b.time);
  const flagsOf = (sample: LookSample) => sampleFlags(sample, baseline, local.filter(item => item !== sample && Math.abs(item.time - sample.time) <= .2)).filter(flag => policy.flags.includes(flag));
  const judged = local.map(sample => ({ time: sample.time, flags: flagsOf(sample) }));
  const bad = (time: number) => (judged.find(item => Math.abs(item.time - time) < .01)?.flags.length ?? 0) > 0;
  const nearest = (time: number) => judged.reduce((best, item) => Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best, judged[0]);
  if (!judged.length) return { spot, flagged: false, seen: ['not measured'], unmeasured: true };
  const lasting = (time: number) => (judged.find(item => Math.abs(item.time - time) < .01)?.flags ?? []).some(flag => !TRANSIENT_FLAGS.includes(flag));
  // What the viewer sees: the retained air between the edge and the word, edge frame included.
  const shown = judged.filter(item => spot.side === 'in' ? item.time >= spot.source - .01 && item.time <= spot.word + .01 : item.time >= spot.word - .01 && item.time <= spot.source + .01);
  // Awkward: any flag on the frame the cut lands on (a blink included), or a lasting one in the air it keeps.
  const edge = nearest(spot.source), flagged = edge.flags.length > 0 || shown.some(item => lasting(item.time));
  // From the word outward, the frames with nothing lasting wrong: a blink may pass inside the shot, a look down may not.
  const pause = judged.filter(item => item.time >= spot.from - .01 && item.time <= spot.to + .01);
  const run: number[] = [];
  for (const item of spot.side === 'in' ? [...pause].reverse() : pause) { if (lasting(item.time)) break; run.push(item.time); }
  const open = run.filter(time => !bad(time));
  const seen = describeFlags(judged.filter(item => item.flags.length), STEP + .08);
  // The clean frame nearest the cut. The reel's last frame may run on to a short natural tail.
  const limit = spot.last ? Math.min(spot.word, spot.source) + NATURAL_TAIL : Infinity, reachable = open.filter(time => time <= limit + .001);
  const clean = !reachable.length ? undefined : spot.last && !flagged ? Math.max(...reachable) : reachable.reduce((best, time) => Math.abs(time - spot.source) < Math.abs(best - spot.source) ? time : best);
  // The tail is added once: an ending already past the last word is left where it is.
  if (!flagged) return { spot, flagged: false, seen, ...(spot.last && spot.source <= spot.word + TAIL && clean !== undefined && clean > spot.source + .1 ? { moveTo: round(clean) } : {}) };
  return { spot, flagged: true, seen, ...(clean !== undefined && Math.abs(clean - spot.source) > .02 ? { moveTo: round(Math.max(spot.from, Math.min(spot.to, clean))) } : {}) };
}

/** Move one cut edge to a SOURCE time inside its pause and ripple everything after it, linked audio included. */
export function moveEdge(timeline: Timeline, spot: Spot, to: number): Timeline {
  const clip = timeline.clips.find(item => item.id === spot.clipId);
  if (!clip) throw new Error(`Clip ${spot.clipId} is no longer on the timeline. Call checkSpots again.`);
  if (to < spot.from - .001 || to > spot.to + .001) throw new Error(`Spot ${spot.id} can move between source ${spot.from.toFixed(2)} and ${spot.to.toFixed(2)} s without touching a word; ${to.toFixed(2)} s is outside that.`);
  const rate = playbackRateOf(clip), end = clip.start + clip.duration;
  // Whole project frames, so later clips stay on the frame grid.
  const delta = Math.round((spot.side === 'in' ? clip.sourceStart - to : to - sourceEndOf(clip)) / rate * timeline.fps) / timeline.fps;
  if (!delta) return timeline;
  const pair = (item: Clip) => item.id === clip.id || item.id === clip.linkedClipId && item.linkedClipId === clip.id;
  const boundary = spot.side === 'in' ? clip.start : end;
  return { ...timeline, clips: timeline.clips.map(item => {
    if (pair(item)) return spot.side === 'in' ? { ...item, sourceStart: Math.max(0, item.sourceStart - delta * rate), duration: item.duration + delta } : { ...item, duration: item.duration + delta };
    return item.start >= boundary - 1e-6 ? { ...item, start: Math.max(0, item.start + delta) } : item;
  }) };
}

/** Stretches of the take with no face in frame: b-roll (product, screen, hands, location), never "silence". */
export function brollRuns(samples: LookSample[], shotCuts: number[] = [], minimum = .8): Range[] {
  const ordered = [...samples].sort((a, b) => a.time - b.time), runs: Range[] = [];
  const baseline = lookBaseline(ordered), absent = (sample: LookSample) => sample.face <= 0 || baseline.face > 0 && sample.face < baseline.face * .25;
  for (let index = 0; index < ordered.length; index++) {
    if (!absent(ordered[index])) continue;
    const first = index;
    while (index + 1 < ordered.length && absent(ordered[index + 1])) index++;
    // The shot begins after the last frame with a face and ends before the next one.
    const snap = (time: number, low: number, high: number) => shotCuts.find(cut => cut > low && cut <= high) ?? time;
    const start = first === 0 ? ordered[0].time : snap(ordered[first].time, ordered[first - 1].time, ordered[first].time);
    const end = index === ordered.length - 1 ? ordered[index].time : snap(ordered[index + 1].time, ordered[index].time, ordered[index + 1].time);
    if (end - start >= minimum) runs.push({ start: round(start), end: round(end) });
  }
  return runs;
}

export type SpotRecord = { id: string; side: 'in' | 'out'; assetId: string; source: number; timeline: number; first: boolean; last: boolean; status: 'clean' | 'flagged' | 'accepted' | 'unverified'; seen: string[]; moveTo?: number };
export type SpotsEvidence = { cutKey: string; spots: SpotRecord[]; accepted: { assetId: string; side: 'in' | 'out'; source: number; seen: string }[]; rounds: Record<string, number>; framesUsed: number; unavailable?: string };


export type { EyeFlag };
