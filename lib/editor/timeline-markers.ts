import { snapTime } from './operations';
import type { Timeline } from './types';

export function addTimelineMarker(timeline: Timeline, time: number, id: string): Timeline {
  const at = snapTime(time, timeline.fps);
  if (!Number.isFinite(at) || timeline.markers?.some(marker => Math.abs(marker.time - at) < .5 / timeline.fps)) return timeline;
  const labels = new Set(timeline.markers?.map(marker => marker.label));
  let number = 1;
  while (labels.has(`Beat ${number}`)) number++;
  return { ...timeline, markers: [...timeline.markers ?? [], { id, time: at, label: `Beat ${number}` }] };
}

export function moveTimelineMarker(timeline: Timeline, id: string, time: number): Timeline {
  const at = snapTime(time, timeline.fps);
  if (!Number.isFinite(at) || !timeline.markers?.some(marker => marker.id === id && marker.time !== at)) return timeline;
  return { ...timeline, markers: timeline.markers.map(marker => marker.id === id ? { ...marker, time: at } : marker) };
}

export function removeTimelineMarker(timeline: Timeline, id: string): Timeline {
  return removeTimelineMarkers(timeline, [id]);
}

/** Omit IDs to clear all markers. Labels are optional and never identify a marker. */
export function removeTimelineMarkers(timeline: Timeline, ids?: readonly string[]): Timeline {
  const selected = ids === undefined ? undefined : new Set(ids);
  const markers = (timeline.markers ?? []).filter(marker => selected !== undefined && !selected.has(marker.id));
  if (markers.length === (timeline.markers?.length ?? 0)) return timeline;
  return { ...timeline, markers };
}
