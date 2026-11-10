import { offsetClipMotion } from './clip-effects';
import { isTransitionClip } from './clip-transitions';
import { playbackRateOf, sourceEndOf, sourceSpanOf, timelineSpanOf } from './playback-rate';
import type { Clip, Timeline } from './types';

export type RetainedSourceRange = { start: number; end: number };
export type RetainedRangeSummary = { clipId: string; linkedClipId?: string; sourceStart: number; sourceEnd: number; start: number; duration: number };
export type RetainedSourceWindow = RetainedSourceRange & { clipId: string };
const epsilon = 1e-7, joinEpsilon = 1e-6;
const seconds = (value: number) => `${Math.round(value * 1000) / 1000}`;
const span = (range: RetainedSourceRange) => `${seconds(range.start)}–${seconds(range.end)} s`;
const sameRamp = (a: Clip, b: Clip) => !a.speedRamp?.length === !b.speedRamp?.length;

/** The pieces an earlier cut left of this clip's source: the clip plus the clips of the same source that
 * touch it on its track, in source order. A second cut addresses all of them through any one piece. */
function retainedPieces(timeline: Timeline, clip: Clip) {
  const row = timeline.clips.filter(member => member.kind === clip.kind && member.track === clip.track && member.assetId === clip.assetId
    && !member.linkedClipId === !clip.linkedClipId && Math.abs(playbackRateOf(member) - playbackRateOf(clip)) <= epsilon && sameRamp(member, clip)).sort((a, b) => a.start - b.start);
  const joined = (a: Clip, b: Clip) => Math.abs(a.start + a.duration - b.start) <= joinEpsilon && sourceEndOf(a) <= b.sourceStart + joinEpsilon;
  let first = row.indexOf(clip), last = first;
  while (first > 0 && joined(row[first - 1], row[first])) first--;
  while (last < row.length - 1 && joined(row[last], row[last + 1])) last++;
  return row.slice(first, last + 1);
}

/** Source windows a cut of this clip may keep from, in source order: one per retained piece. */
export function retainedSourceWindows(timeline: Timeline, clipId: string): RetainedSourceWindow[] {
  const clip = timeline.clips.find(member => member.id === clipId);
  return clip && clip.assetId && (clip.kind === 'video' || clip.kind === 'audio') ? retainedPieces(timeline, clip).map(piece => ({ clipId: piece.id, start: piece.sourceStart, end: sourceEndOf(piece) })) : [];
}

/** Compact this clip's retained source, keeping linked sound and authored phase. The retained source is
 * the clip plus the adjacent pieces an earlier cut left of the same source, so a cut can be redone in
 * one call on any piece; footage already removed is never brought back. By default edges round outward
 * to frames; `exact` keeps measured edges to the millisecond, as speech cleanup needs: export trims audio
 * by sample and each video frame shows whichever piece covers that instant. */
export function retainSourceRanges(timeline: Timeline, clipId: string, ranges: RetainedSourceRange[], newId: () => string = () => crypto.randomUUID(), exact = false) {
  const clip = timeline.clips.find(member => member.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) throw new Error('Choose an existing video or audio clip.');
  if (!Number.isFinite(timeline.fps) || timeline.fps <= 0) throw new Error('The timeline frame rate is invalid.');
  if (!ranges.length || ranges.length > 100) throw new Error('Choose between 1 and 100 retained source ranges.');
  const frame = 1 / timeline.fps, own = { start: clip.sourceStart, end: sourceEndOf(clip) };
  const fits = (range: RetainedSourceRange, window: RetainedSourceRange) => range.start >= window.start - epsilon && range.end <= window.end + epsilon;
  // A request inside the named clip cuts only that clip; its neighbours join in when a range reaches them.
  const pieces = ranges.every(range => fits(range, own)) || !clip.assetId ? [clip] : retainedPieces(timeline, clip);
  const windows = pieces.map(piece => ({ start: piece.sourceStart, end: sourceEndOf(piece) }));
  const allowed = windows.map(span).join(', ');
  const kept: RetainedSourceRange[][] = pieces.map(() => []);
  let previousEnd = -Infinity;
  ranges.forEach((range, index) => {
    const name = `Range ${index + 1} (${[range.start, range.end].every(Number.isFinite) ? span(range) : 'not a number'})`;
    if (![range.start, range.end].every(Number.isFinite)) throw new Error(`${name} needs a start and an end in source seconds.`);
    if (range.end <= range.start) throw new Error(`${name} ends before it starts.`);
    if (range.start < previousEnd - epsilon) throw new Error(`${name} starts before range ${index} ends (${seconds(previousEnd)} s). Ranges must be in source order and must not overlap.`);
    previousEnd = range.end;
    // A range may run across pieces that still join in the source; anything between pieces was removed.
    const parts = windows.map(window => ({ start: Math.max(range.start, window.start), end: Math.min(range.end, window.end) }));
    const covered = parts.reduce((total, part) => total + Math.max(0, part.end - part.start), 0);
    if (covered < range.end - range.start - joinEpsilon * pieces.length) {
      const removed = windows.slice(1).map((window, at) => ({ start: Math.max(range.start, windows[at].end), end: Math.min(range.end, window.start) })).filter(gap => gap.end - gap.start > joinEpsilon);
      const restore = 'this tool never brings footage back: restore it first with restoreClip (or undoLatestEdit for the latest cut), then cut again in one call.';
      throw new Error(`${name} is outside this clip’s retained source (${allowed}). ${removed.length ? `${removed.map(span).join(', ')} was removed by an earlier cut and ${restore}` : `Footage outside ${windows.length > 1 ? 'those windows' : 'that window'} is not on the timeline and ${restore}`}`);
    }
    let length = 0;
    parts.forEach((part, at) => {
      const piece = pieces[at], local = timelineSpanOf(piece, part.end - piece.sourceStart) - timelineSpanOf(piece, part.start - piece.sourceStart);
      // A sliver left where a range crosses into the next piece is dropped, not kept as a sub-frame clip.
      if (local >= frame - epsilon) { kept[at].push(part); length += local; }
    });
    if (!length) throw new Error(`${name} is shorter than one timeline frame (${seconds(frame)} s).`);
  });
  const selected = new Set<string>(), pairs = new Map<string, Clip>();
  // Every piece is checked, also one that keeps nothing: it is removed with its linked sound.
  pieces.forEach(piece => {
    selected.add(piece.id);
    if (!piece.linkedClipId) return;
    const pair = timeline.clips.find(member => member.id === piece.linkedClipId);
    if (!pair || pair.linkedClipId !== piece.id || pair.kind !== (piece.kind === 'video' ? 'audio' : 'video')
      || Math.abs(pair.start - piece.start) > epsilon || Math.abs(pair.duration - piece.duration) > epsilon
      || Math.abs(playbackRateOf(pair) - playbackRateOf(piece)) > epsilon) throw new Error('The linked video and audio must have synchronized timing.');
    pairs.set(piece.id, pair); selected.add(pair.id);
  });
  if (timeline.clips.some(member => isTransitionClip(member) && member.transition && (selected.has(member.transition.fromClipId) || selected.has(member.transition.toClipId)))) throw new Error('Remove this clip’s connected transition before retaining source ranges.');
  const ms = (value: number) => Math.round(value * 1000) / 1000;
  // Clip-local seconds of each kept part, through the piece's constant speed or speed ramp.
  const offsets = pieces.map((piece, at) => {
    const local: RetainedSourceRange[] = [];
    for (const part of kept[at]) {
      const from = timelineSpanOf(piece, part.start - piece.sourceStart), to = timelineSpanOf(piece, part.end - piece.sourceStart);
      // Frame mode expands to frame boundaries so exact word evidence is not clipped away.
      const start = Math.max(0, exact ? ms(from) : Math.floor(from * timeline.fps + epsilon) / timeline.fps);
      const end = Math.min(piece.duration, exact ? ms(to) : Math.ceil(to * timeline.fps - epsilon) / timeline.fps);
      const previous = local.at(-1);
      // Gaps that cannot survive (sub-frame after rounding, sub-millisecond when exact) are retained rather than words.
      if (previous && start <= previous.end + (exact ? .001 : epsilon)) previous.end = Math.max(previous.end, end);
      else local.push({ start, end });
    }
    return local;
  });
  if (pieces.length === 1 && offsets[0].length === 1 && offsets[0][0].start === 0 && offsets[0][0].end === clip.duration) return { timeline, ranges: [{ clipId: clip.id, ...(clip.linkedClipId ? { linkedClipId: clip.linkedClipId } : {}), sourceStart: clip.sourceStart, sourceEnd: own.end, start: clip.start, duration: clip.duration }] };
  const ids = new Set(timeline.clips.map(member => member.id));
  const freshId = () => { const id = newId(); if (!id || ids.has(id)) throw new Error('Retained clips need unique IDs.'); ids.add(id); return id; };
  const cut = new Map<string, Clip[]>(), retained: RetainedRangeSummary[] = [];
  let cursor = pieces[0].start;
  pieces.forEach((piece, at) => {
    const pair = pairs.get(piece.id), clips: Clip[] = [], linked: Clip[] = [];
    offsets[at].forEach((range, index) => {
      const id = index ? freshId() : piece.id, pairId = pair ? index ? freshId() : pair.id : undefined;
      const duration = range.end - range.start;
      const next = { ...piece, ...offsetClipMotion(piece, range.start), id, ...(pair ? { linkedClipId: pairId } : {}), start: cursor, sourceStart: piece.sourceStart + sourceSpanOf(piece, range.start), duration };
      clips.push(next);
      if (pair) linked.push({ ...pair, ...offsetClipMotion(pair, range.start), id: pairId!, linkedClipId: id, start: cursor, sourceStart: pair.sourceStart + sourceSpanOf(pair, range.start), duration });
      retained.push({ clipId: id, ...(pairId ? { linkedClipId: pairId } : {}), sourceStart: next.sourceStart, sourceEnd: sourceEndOf(next), start: cursor, duration });
      cursor += duration;
    });
    cut.set(piece.id, clips);
    if (piece.linkedClipId) cut.set(piece.linkedClipId, linked);
  });
  return { timeline: { ...timeline, clips: timeline.clips.flatMap(member => cut.get(member.id) ?? [member]) }, ranges: retained };
}
