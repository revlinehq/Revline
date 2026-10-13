import { expect, it } from 'vitest';
import { normalizeTimeline, deriveTracks, layerGroup, type Timeline } from './types';
import { addMediaClip, placeOnFreeLayer } from './operations';
import { moveSelectedClips, reorderLayer, resizeSelectedClips } from './timeline-controls';
import { createEditorStore } from './store';

const mixed: Timeline = { fps: 30, aspectRatio: 'vertical', tracks: { visual: 2, overlay: 0, audio: 1 }, clips: [
  { id: 'title', kind: 'graphic', track: 1, start: 0, duration: 2, sourceStart: 0, text: 'Title' },
  { id: 'video', kind: 'video', track: 1, start: 2, duration: 3, sourceStart: 4, assetId: 'footage' },
  { id: 'caption', kind: 'caption', track: 2, start: 0, duration: 2, sourceStart: 0, text: 'Caption' },
] };

it('preserves old text-above-footage stacking once, including saved empty rows', () => {
  const legacy: Timeline = { ...mixed, tracks: { visual: 3, overlay: 2, audio: 1 } };
  const migrated = normalizeTimeline(legacy);
  expect(migrated.clips.map(clip => clip.track)).toEqual([4, 1, 5]);
  expect(migrated.tracks).toEqual({ visual: 5, overlay: 0, audio: 1, effects:0 });
  expect(deriveTracks(migrated).map(row => row.label)).toEqual(['V5', 'V4', 'V3', 'V2', 'V1', 'A1']);
  expect(normalizeTimeline(migrated)).toBe(migrated);
  expect(legacy.clips.map(clip => clip.track)).toEqual([1, 1, 2]);
});

it('lets text, footage, and images share a visual track at different times', () => {
  expect(mixed.clips.map(clip => layerGroup(clip.kind))).toEqual(['visual', 'visual', 'visual']);
  const next = addMediaClip(mixed, { _id: 'image', kind: 'image' }, 'image');
  expect(next.clips.at(-1)).toMatchObject({ track: 1, start: 5 });
  const text = placeOnFreeLayer(mixed, { ...mixed.clips[0], id: 'later', start: 5 });
  expect(text.clips.at(-1)?.track).toBe(1);
});

it('keeps overlapping text and footage on different rows and allows footage above text', () => {
  const next = moveSelectedClips(mixed, ['video'], 0, 1);
  expect(next.clips.find(clip => clip.id === 'video')).toMatchObject({ track: 2, start: 2, sourceStart: 4 });
  const overlap = placeOnFreeLayer(mixed, { ...mixed.clips[1], id: 'overlap', start: 0 });
  expect(overlap.clips.at(-1)?.track).toBe(3);
  expect(reorderLayer(next, 'visual', 2, 1).clips.find(clip => clip.id === 'video')?.track).toBe(1);
});

it('trim bounds include neighboring text on the same visual row', () => {
  expect(resizeSelectedClips(mixed, [], ['title'], 'right', 3).clips[0].duration).toBe(2);
});

it('places new text above overlapping visuals while keeping an explicit track', () => {
  const timeline: Timeline = { ...mixed, tracks: { visual: 4, overlay: 0, audio: 1 }, clips: [
    { ...mixed.clips[1], track: 3, start: 0, duration: 5 },
  ] };
  const title = { id: 'new-title', kind: 'graphic' as const, start: 1, duration: 2, sourceStart: 0, text: 'Visible title' };
  expect(placeOnFreeLayer(timeline, title).clips.at(-1)?.track).toBe(4);
  expect(placeOnFreeLayer(timeline, { ...title, track: 1 }).clips.at(-1)?.track).toBe(1);
  expect(placeOnFreeLayer(timeline, { ...title, start: 5 }).clips.at(-1)?.track).toBe(1);
});

it('normalizes remote legacy revisions and preserves mixed rows through undo and redo', () => {
  const store = createEditorStore(mixed);
  const legacy: Timeline = { ...mixed, tracks: { visual: 1, overlay: 2, audio: 1 } };
  store.getState().replace(legacy, true);
  expect(store.getState().timeline.clips.map(clip => clip.track)).toEqual([2, 1, 3]);
  expect(store.getState().undo()).toEqual(mixed);
  expect(store.getState().redo()).toEqual(normalizeTimeline(legacy));
});
