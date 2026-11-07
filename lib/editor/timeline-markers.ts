import { snapTime } from './operations';
import type { Clip, Timeline, TimelineMarker } from './types';

const EPSILON = 1e-4;
export const isSectionMarker = (marker: TimelineMarker) => marker.kind === 'section';

/**
 * The markers that split a film clip into sections. Films placed since section markers carried a kind use only
 * those, so a beat or cue inside the film never starts a section. Older films, whose section markers have no kind,
 * keep counting every marker inside the clip.
 */
export function sectionMarkersIn(timeline: Timeline, clip: Pick<Clip, 'start' | 'duration'>) {
  const inside = (timeline.markers ?? []).filter(marker => marker.time >= clip.start - EPSILON && marker.time < clip.start + clip.duration - EPSILON).sort((a, b) => a.time - b.time);
  return inside.some(isSectionMarker) ? inside.filter(isSectionMarker) : inside;
}

/**
 * Explicit null creates an unlabeled cue; omitted label preserves the manual legacy default.
 * A frame holds at most one marker of each kind (one section start, one cue), so pressing M twice or measuring
 * beats again never stacks identical flags that can only be grabbed as one. A cue may share a section's frame.
 */
export function addTimelineMarker(timeline: Timeline, time: number, id: string, label?:string|null, kind?: TimelineMarker['kind']): Timeline {
  if(label!==undefined&&label!==null&&(!label.trim()||label.length>120))throw new Error('Marker labels support 1–120 characters.');
  const at = snapTime(time, timeline.fps), section = kind === 'section';
  if (!Number.isFinite(at) || timeline.markers?.some(marker => isSectionMarker(marker) === section && Math.abs(marker.time - at) < .5 / timeline.fps)) return timeline;
  const labels = new Set(timeline.markers?.map(marker => marker.label));
  let number = 1;
  while (labels.has(`Beat ${number}`)) number++;
  return { ...timeline, markers: [...timeline.markers ?? [], { id, time: at,...(label===null?{}:{label:label??`Beat ${number}`}), ...(section ? { kind } : {}) }] };
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
