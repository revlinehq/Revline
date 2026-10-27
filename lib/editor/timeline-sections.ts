import { snapTime } from './operations';
import type { Timeline, TimelineSection } from './types';

export const MAX_TIMELINE_SECTIONS = 20;

/** The section's range snapped to frames; throws on a range that cannot export. */
function sectionRange(timeline: Timeline, start: number, end: number) {
  const from = snapTime(Math.max(0, start), timeline.fps), to = snapTime(end, timeline.fps);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 1 / timeline.fps) throw new Error('A section must last at least one frame.');
  return { start: from, end: to };
}

function checkName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) throw new Error('Section names support 1–120 characters.');
  return trimmed;
}

export function addTimelineSection(timeline: Timeline, section: TimelineSection): Timeline {
  if ((timeline.sections?.length ?? 0) >= MAX_TIMELINE_SECTIONS) throw new Error(`A timeline supports up to ${MAX_TIMELINE_SECTIONS} sections.`);
  const next = { id: section.id, name: checkName(section.name), ...sectionRange(timeline, section.start, section.end) };
  return { ...timeline, sections: [...timeline.sections ?? [], next].sort((a, b) => a.start - b.start) };
}

export function updateTimelineSection(timeline: Timeline, id: string, patch: Partial<Omit<TimelineSection, 'id'>>): Timeline {
  const current = timeline.sections?.find(section => section.id === id);
  if (!current) throw new Error('Choose an existing section.');
  const next = { id, name: patch.name === undefined ? current.name : checkName(patch.name), ...sectionRange(timeline, patch.start ?? current.start, patch.end ?? current.end) };
  return { ...timeline, sections: timeline.sections!.map(section => section.id === id ? next : section).sort((a, b) => a.start - b.start) };
}

export function removeTimelineSection(timeline: Timeline, id: string): Timeline {
  if (!timeline.sections?.some(section => section.id === id)) return timeline;
  return { ...timeline, sections: timeline.sections.filter(section => section.id !== id) };
}

/** The next free default name: Video 1, Video 2… */
export function nextSectionName(timeline: Timeline) {
  const names = new Set(timeline.sections?.map(section => section.name));
  let number = (timeline.sections?.length ?? 0) + 1;
  while (names.has(`Video ${number}`)) number++;
  return `Video ${number}`;
}
