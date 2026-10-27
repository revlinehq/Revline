import { offsetClipMotion } from './clip-effects';
import { isTransitionClip } from './clip-transitions';
import { playbackRateOf, sourceEndOf } from './playback-rate';
import type { Clip, Timeline } from './types';

export type RetainedSourceRange = { start: number; end: number };
export type RetainedRangeSummary = { clipId: string; linkedClipId?: string; sourceStart: number; sourceEnd: number; start: number; duration: number };
const epsilon = 1e-7;

/** Compact only this clip's retained source, keeping linked sound and authored phase. By default edges
 * round outward to frames; `exact` keeps measured edges to the millisecond, as speech cleanup needs:
 * export trims audio by sample and each video frame shows whichever piece covers that instant. */
export function retainSourceRanges(timeline: Timeline, clipId: string, ranges: RetainedSourceRange[], newId: () => string = () => crypto.randomUUID(), exact = false) {
  const clip = timeline.clips.find(member => member.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) throw new Error('Choose an existing video or audio clip.');
  if (!Number.isFinite(timeline.fps) || timeline.fps <= 0) throw new Error('The timeline frame rate is invalid.');
  if (!ranges.length || ranges.length > 100) throw new Error('Choose between 1 and 100 retained source ranges.');
  const pair = clip.linkedClipId ? timeline.clips.find(member => member.id === clip.linkedClipId) : undefined;
  if (clip.linkedClipId && (!pair || pair.linkedClipId !== clip.id || pair.kind !== (clip.kind === 'video' ? 'audio' : 'video')
    || Math.abs(pair.start - clip.start) > epsilon || Math.abs(pair.duration - clip.duration) > epsilon
    || Math.abs(playbackRateOf(pair) - playbackRateOf(clip)) > epsilon)) throw new Error('The linked video and audio must have synchronized timing.');
  const selected = new Set([clip.id, ...(pair ? [pair.id] : [])]);
  if (timeline.clips.some(member => isTransitionClip(member) && member.transition && (selected.has(member.transition.fromClipId) || selected.has(member.transition.toClipId)))) throw new Error('Remove this clip’s connected transition before retaining source ranges.');
  const rate = playbackRateOf(clip), frame = 1 / timeline.fps, sourceEnd = sourceEndOf(clip);
  const offsets: RetainedSourceRange[] = [];
  let previousEnd = clip.sourceStart;
  for (const range of ranges) {
    if (![range.start, range.end].every(Number.isFinite) || range.start < clip.sourceStart - epsilon || range.end > sourceEnd + epsilon
      || range.start < previousEnd - epsilon || (range.end - range.start) / rate < frame - epsilon) throw new Error('Source ranges must be ordered, non-overlapping, at least one timeline frame long and inside this clip’s retained source.');
    previousEnd = range.end;
    // Frame mode expands to frame boundaries so exact word evidence is not clipped away.
    const ms = (value: number) => Math.round(value * 1000) / 1000;
    const start = exact ? Math.max(0, ms((range.start - clip.sourceStart) / rate)) : Math.max(0, Math.floor((range.start - clip.sourceStart) / rate * timeline.fps + epsilon) / timeline.fps);
    const end = exact ? Math.min(clip.duration, ms((range.end - clip.sourceStart) / rate)) : Math.min(clip.duration, Math.ceil((range.end - clip.sourceStart) / rate * timeline.fps - epsilon) / timeline.fps);
    const previous = offsets.at(-1);
    // Gaps that cannot survive (sub-frame after rounding, sub-millisecond when exact) are retained rather than words.
    if (previous && start <= previous.end + (exact ? .001 : epsilon)) previous.end = Math.max(previous.end, end);
    else offsets.push({ start, end });
  }
  if (offsets.length === 1 && offsets[0].start === 0 && offsets[0].end === clip.duration) return { timeline, ranges: [{ clipId: clip.id, ...(pair ? { linkedClipId: pair.id } : {}), sourceStart: clip.sourceStart, sourceEnd, start: clip.start, duration: clip.duration }] };
  const ids = new Set(timeline.clips.map(member => member.id));
  const freshId = () => { const id = newId(); if (!id || ids.has(id)) throw new Error('Retained clips need unique IDs.'); ids.add(id); return id; };
  const clips: Clip[] = [], pairs: Clip[] = [], retained: RetainedRangeSummary[] = [];
  let cursor = clip.start;
  offsets.forEach((range, index) => {
    const id = index ? freshId() : clip.id, pairId = pair ? index ? freshId() : pair.id : undefined;
    const duration = range.end - range.start;
    const next = { ...clip, ...offsetClipMotion(clip, range.start), id, ...(pair ? { linkedClipId: pairId } : {}), start: cursor, sourceStart: clip.sourceStart + range.start * rate, duration };
    clips.push(next);
    if (pair) pairs.push({ ...pair, ...offsetClipMotion(pair, range.start), id: pairId!, linkedClipId: id, start: cursor, sourceStart: pair.sourceStart + range.start * rate, duration });
    retained.push({ clipId: id, ...(pairId ? { linkedClipId: pairId } : {}), sourceStart: next.sourceStart, sourceEnd: sourceEndOf(next), start: cursor, duration });
    cursor += duration;
  });
  return { timeline: { ...timeline, clips: timeline.clips.flatMap(member => member.id === clip.id ? clips : member.id === pair?.id ? pairs : [member]) }, ranges: retained };
}
