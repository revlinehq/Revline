import { isTimelineGestureRejection, TimelineGestureRejection } from './timeline-edit-errors';
import { splitClip } from './operations';
import type { Timeline } from './types';

/** Split selected clips under the marker, or all intersecting clips when selection is elsewhere. */
export function splitAtPlayhead(timeline: Timeline, selectedIds: string[], time: number, makeId = () => crypto.randomUUID()): Timeline {
  const inside = timeline.clips.filter(clip => time > clip.start && time < clip.start + clip.duration);
  const selected = inside.filter(clip => selectedIds.includes(clip.id));
  const targets = selected.length ? selected : inside;
  const handled = new Set<string>();
  let next = timeline;
  for (const clip of targets) {
    if (handled.has(clip.id)) continue;
    try { next = splitClip(next, clip.id, time, makeId()); }
    catch (error) { if (!isTimelineGestureRejection(error)) throw error; continue; }
    handled.add(clip.id); if (clip.linkedClipId) handled.add(clip.linkedClipId);
  }
  if (next === timeline) throw new TimelineGestureRejection('Place the playhead inside a clip, at least one frame from its edges.');
  return next;
}
