import type { Clip, Timeline } from './types';
import { equalTimelineValue } from './timeline-equality';

export type LiveEditChange = { label: string; changedClipIds: string[]; removedClips: Clip[]; at: number };

/** Describe only validated timeline differences, never model/tool narration. */
export function describeLiveEdit(before: Timeline, after: Timeline): LiveEditChange {
  const previous = new Map(before.clips.map(clip => [clip.id, clip]));
  const nextIds = new Set(after.clips.map(clip => clip.id));
  const changed = after.clips.filter(clip => !equalTimelineValue(previous.get(clip.id), clip));
  const removedClips = before.clips.filter(clip => !nextIds.has(clip.id));
  const added = changed.filter(clip => !previous.has(clip.id));
  const moved = changed.some(clip => previous.get(clip.id)?.start !== clip.start || previous.get(clip.id)?.track !== clip.track);
  const trimmed = changed.some(clip => previous.has(clip.id) && (previous.get(clip.id)?.duration !== clip.duration || previous.get(clip.id)?.sourceStart !== clip.sourceStart));
  const label = removedClips.length ? 'Removing clips' : added.length ? 'Adding to your timeline' : trimmed ? 'Trimming clips' : moved ? 'Moving clips' : changed.some(clip => clip.kind === 'caption' || clip.kind === 'graphic') ? 'Updating text' : changed.length ? 'Updating the look' : 'Updating your timeline';
  const starts=[...changed,...removedClips].map(clip=>clip.start);
  return { label, changedClipIds: changed.map(clip => clip.id), removedClips, at: starts.length ? Math.min(...starts) : 0 };
}
