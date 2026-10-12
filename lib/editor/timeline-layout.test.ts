import { describe, expect, it } from 'vitest';
import { timelineLayout, TIMELINE_RULER_HEIGHT, TIMELINE_TRACK_GAP, TIMELINE_TOP_SPACE } from './timeline-layout';
import { clipLayerDropTarget, moveSelectionToNewLayers } from './timeline-controls';
import type { Timeline } from './types';

const timeline: Timeline = {
  fps: 30, aspectRatio: 'vertical', tracks: { visual: 4, overlay: 0, audio: 1 },
  clips: [
    { id: 'text', kind: 'caption', track: 3, start: 0, duration: 2, sourceStart: 0, text: 'Above the footage' },
    { id: 'title', kind: 'graphic', track: 2, start: 0, duration: 1, sourceStart: 0, text: 'Title' },
    { id: 'video', kind: 'video', track: 2, start: 1, duration: 1, sourceStart: 0 },
    { id: 'image', kind: 'image', track: 1, start: 0, duration: 2, sourceStart: 0 },
    { id: 'sound', kind: 'audio', track: 1, start: 0, duration: 2, sourceStart: 0 },
  ],
};

describe('mixed visual track layout', () => {
  it('shows one shared visual stack followed by audio with no overlay rows', () => {
    const rows = timelineLayout(timeline).tracks;
    expect(rows.map(row => row.id)).toEqual(['visual-4', 'visual-3', 'visual-2', 'visual-1', 'audio-1']);
  });
  it('keeps every row and clip uniformly sized across text, media, mixed, and audio lanes', () => {
    const rows = timelineLayout(timeline).tracks;
    expect(rows.map(row => row.clipHeight)).toEqual([52, 52, 52, 52, 52]);
    expect(rows.map(row => row.height)).toEqual([52, 52, 52, 52, 52].map(height => height + TIMELINE_TRACK_GAP));
  });
  it('keeps lane positions stable when media moves into or out of a text row', () => {
    const moved = { ...timeline, clips: timeline.clips.map(clip => clip.id === 'video' ? { ...clip, track: 3 } : clip) };
    const before = timelineLayout(timeline);
    const after = timelineLayout(moved);
    expect(after.tracks[1].clipHeight).toBe(52);
    expect(after.tracks[2].clipHeight).toBe(52);
    expect(after.tracks.map(row => row.top)).toEqual(before.tracks.map(row => row.top));
    expect(after.tracks.map(row => row.height)).toEqual(before.tracks.map(row => row.height));
    expect(after.height).toBe(before.height);
  });
  it('does not shrink V1 when it contains only text below V2 footage', () => {
    const project: Timeline = { fps: 30, aspectRatio: 'vertical', tracks: { visual: 2, overlay: 0, audio: 1 }, clips: [
      { id: 'video', kind: 'video', track: 2, start: 0, duration: 2, sourceStart: 0 },
      { id: 'title', kind: 'graphic', track: 1, start: 1, duration: 1, sourceStart: 0, text: 'Title' },
    ] };
    const before = timelineLayout(project);
    expect(before.tracks[1].height).toBe(before.tracks[0].height);
    const after = timelineLayout({ ...project, clips: project.clips.filter(clip => clip.id !== 'title') });
    expect(after.tracks.map(row => row.top)).toEqual(before.tracks.map(row => row.top));
    expect(after.height).toBe(before.height);
  });
  it('keeps compact rows consistently sized and computes contiguous geometry', () => {
    const layout = timelineLayout(timeline, true);
    layout.tracks.forEach((row, index) => {
      expect(row.clipHeight).toBe(32);
      expect(row.top).toBe(TIMELINE_RULER_HEIGHT + TIMELINE_TOP_SPACE + index * (32 + TIMELINE_TRACK_GAP));
    });
    expect(layout.height).toBe(TIMELINE_RULER_HEIGHT + TIMELINE_TOP_SPACE + layout.tracks.length * (32 + TIMELINE_TRACK_GAP));
  });
  it('leaves space above the first lane for an explicit new visual track drop', () => {
    const rows = timelineLayout(timeline).tracks.map(row => ({ ...row, track: row.number, bottom: row.top + row.height }));
    expect(clipLayerDropTarget(TIMELINE_RULER_HEIGHT + TIMELINE_TOP_SPACE / 3, rows, 'visual')).toEqual({ edge: 'above' });
    expect(clipLayerDropTarget(TIMELINE_RULER_HEIGHT + TIMELINE_TOP_SPACE / 3, rows, 'audio')).toBeNull();
    const next = moveSelectionToNewLayers(timeline, ['video'], 0, 'above', 'video');
    expect(next.clips.find(clip => clip.id === 'video')?.track).toBe(5);
    expect(next.clips.find(clip => clip.id === 'sound')?.track).toBe(1);
  });
  it('sizes legacy text rows after mapping their tracks into the shared visual stack', () => {
    const legacy: Timeline = { fps: 30, aspectRatio: 'vertical', clips: [
      { id: 'video', kind: 'video', track: 1, start: 0, duration: 2, sourceStart: 0 },
      { id: 'caption', kind: 'caption', track: 2, start: 0, duration: 2, sourceStart: 0 },
      { id: 'title', kind: 'graphic', track: 1, start: 0, duration: 2, sourceStart: 0 },
    ] };
    expect(timelineLayout(legacy).tracks.filter(row => row.group === 'visual').map(row => [row.number, row.clipHeight])).toEqual([[3, 52], [2, 52], [1, 52]]);
  });
});
