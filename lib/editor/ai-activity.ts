import { describeLiveEdit } from './live-edit';
import { equalTimelineValue } from './timeline-equality';
import type { Clip, Timeline } from './types';

export type AiClipChange = { kind: 'new' | 'trimmed' | 'moved' | 'changed'; delta?: number };

/** What an AI run has done to each clip so far, against the timeline it started from. */
export function aiRunChanges(base: Timeline, current: Timeline) {
  const before = new Map(base.clips.map(clip => [clip.id, clip]));
  const changes = new Map<string, AiClipChange>();
  for (const clip of current.clips) {
    const old = before.get(clip.id);
    if (!old) changes.set(clip.id, { kind: 'new' });
    else if (equalTimelineValue(old, clip)) continue;
    else if (old.duration !== clip.duration || old.sourceStart !== clip.sourceStart) changes.set(clip.id, { kind: 'trimmed', delta: clip.duration - old.duration });
    else if (old.start !== clip.start || old.track !== clip.track) changes.set(clip.id, { kind: 'moved' });
    else changes.set(clip.id, { kind: 'changed' });
  }
  const ids = new Set(current.clips.map(clip => clip.id));
  return { changes, removed: base.clips.filter(clip => !ids.has(clip.id)) };
}

/** The time span one step touched: every clip that changed, before and after, plus removed ones. */
export function aiStepRange(before: Timeline, after: Timeline): { start: number; end: number } | null {
  const previous = new Map(before.clips.map(clip => [clip.id, clip]));
  const touched: Clip[] = [];
  for (const clip of after.clips) {
    const old = previous.get(clip.id);
    if (old && equalTimelineValue(old, clip)) continue;
    touched.push(clip);
    if (old) touched.push(old);
  }
  const ids = new Set(after.clips.map(clip => clip.id));
  touched.push(...before.clips.filter(clip => !ids.has(clip.id)));
  if (!touched.length) return null;
  return { start: Math.min(...touched.map(clip => clip.start)), end: Math.max(...touched.map(clip => clip.start + clip.duration)) };
}

export const aiStepLabel = (before: Timeline, after: Timeline) => describeLiveEdit(before, after).label;
