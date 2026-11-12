import { runFailure } from '../../lib/ai/run-failure';
import { layerGroup, normalizeTimeline, trackOf, type Timeline } from '../../lib/editor/types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Apply only the requested field delta; never overwrite a concurrent changed field. */
function mergeDelta(before: unknown, intended: unknown, current: unknown): unknown {
  if (same(before, intended) || same(current, intended)) return current;
  if (same(before, current)) return intended;
  if (!object(before) || !object(intended) || !object(current)) throw runFailure('conflict', 'The timeline changed elsewhere. Inspect the refreshed timeline before continuing.');
  const result = { ...current };
  for (const key of new Set([...Object.keys(before), ...Object.keys(intended)])) {
    if (same(before[key], intended[key])) continue;
    const value = mergeDelta(before[key], intended[key], current[key]);
    if (value === undefined) delete result[key]; else result[key] = value;
  }
  return result;
}

export function rebaseNonDestructiveEdit(previous: Timeline, intended: Timeline, current: Timeline): Timeline {
  const before = normalizeTimeline(previous), next = normalizeTimeline(intended), fresh = normalizeTimeline(current);
  if (same(before, fresh)) return next;
  if (before.clips.some(clip => !next.clips.some(item => item.id === clip.id))) throw runFailure('conflict', 'The timeline changed elsewhere. Your replacement was not saved.');
  const beforeIds = new Set(before.clips.map(clip => clip.id));
  const nextById = new Map(next.clips.map(clip => [clip.id, clip]));
  const clips = fresh.clips.map(clip => {
    const old = before.clips.find(item => item.id === clip.id), planned = nextById.get(clip.id);
    if (old && planned) {
      const range = ['start', 'duration', 'sourceStart', 'playbackRate', 'track'] as const;
      if (range.some(key => !same(old[key], planned[key])) && range.some(key => !same(old[key], clip[key])) && !range.every(key => same(planned[key], clip[key]))) throw runFailure('conflict', 'The timeline changed elsewhere. Inspect the refreshed timeline before continuing.');
      return mergeDelta(old, planned, clip) as typeof clip;
    }
    return clip;
  });
  for (const old of before.clips) {
    if (!same(old, nextById.get(old.id)) && !fresh.clips.some(clip => clip.id === old.id)) throw runFailure('conflict', 'The timeline changed elsewhere. Inspect the refreshed timeline before continuing.');
  }
  for (const added of next.clips.filter(clip => !beforeIds.has(clip.id))) {
    const existing = fresh.clips.find(clip => clip.id === added.id);
    if (existing) { if (!same(existing, added)) throw runFailure('conflict', 'The timeline changed elsewhere. Inspect the refreshed timeline before continuing.'); continue; }
    const occupied = fresh.clips.some(clip => layerGroup(clip.kind) === layerGroup(added.kind) && trackOf(clip) === trackOf(added) && clip.start < added.start + added.duration && added.start < clip.start + clip.duration);
    if (occupied) throw runFailure('conflict', 'The timeline changed elsewhere. Inspect the refreshed timeline before continuing.');
    clips.push(added);
  }
  const { clips: _before, tracks: beforeTracks, ...beforeFields } = before;
  const { clips: _next, tracks: nextTracks, ...nextFields } = next;
  const { clips: _fresh, tracks: freshTracks, ...freshFields } = fresh;
  const fields = mergeDelta(beforeFields, nextFields, freshFields) as Omit<Timeline, 'clips' | 'tracks'>;
  let tracks: Timeline['tracks'];
  if (same(beforeTracks, nextTracks)) tracks = freshTracks;
  else if (beforeTracks && nextTracks && freshTracks && Object.keys(nextTracks).every(key => nextTracks[key as keyof typeof nextTracks]! >= (beforeTracks[key as keyof typeof beforeTracks] ?? 0))) {
    tracks = { ...freshTracks, ...Object.fromEntries(Object.keys(nextTracks).map(key => [key, Math.max(nextTracks[key as keyof typeof nextTracks] ?? 0, freshTracks[key as keyof typeof freshTracks] ?? 0)])) } as Timeline['tracks'];
  } else tracks = mergeDelta(beforeTracks, nextTracks, freshTracks) as Timeline['tracks'];
  return { ...fields, clips, ...(tracks ? { tracks } : {}) };
}
