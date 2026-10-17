import { expect, test } from 'vitest';
import { closeFootageGaps } from './close-gaps';
import { addTransitionClip } from './operations';
import { createEditorStore } from './store';
import { type Timeline } from './types';
const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: [
  { id: 'first', kind: 'video', track: 1, assetId: 'video', start: 1, duration: 2.01, sourceStart: 3, linkedClipId: 'first-a', audioSeparated: true },
  { id: 'first-a', kind: 'audio', track: 1, assetId: 'audio', start: 1, duration: 2.01, sourceStart: 3, linkedClipId: 'first' },
  { id: 'second', kind: 'video', track: 1, assetId: 'video', start: 6, duration: 2, sourceStart: 10, linkedClipId: 'second-a', audioSeparated: true },
  { id: 'second-a', kind: 'audio', track: 1, assetId: 'audio', start: 6, duration: 2, sourceStart: 10, linkedClipId: 'second' },
] };
test('one edit closes leading/interior gaps exactly and preserves source trims, linked audio and Undo', () => {
  const next = closeFootageGaps(timeline);
  expect(next.clips.map(clip => clip.start)).toEqual([0, 0, 2.01, 2.01]);
  expect(next.clips.map(({ start: _, ...clip }) => clip)).toEqual(timeline.clips.map(({ start: _, ...clip }) => clip));
  expect(closeFootageGaps(next)).toBe(next);
  const store = createEditorStore(timeline); store.getState().edit(next);
  expect(store.getState().undo()?.clips).toEqual(timeline.clips);
});
test('a selected sequence keeps its first clip anchored and leaves other tracks alone', () => {
  const source: Timeline = { ...timeline, clips: [...timeline.clips, { ...timeline.clips[2], id: 'third', linkedClipId: undefined, start: 10 }, { id: 'title', kind: 'graphic', track: 2, start: 4, duration: 2, sourceStart: 0, text: 'Keep this' }] };
  const next = closeFootageGaps(source, ['second', 'third']);
  expect(closeFootageGaps(source, ['second-a', 'third'])).toEqual(next);
  expect(next.clips.find(clip => clip.id === 'second')?.start).toBe(6);
  expect(next.clips.find(clip => clip.id === 'third')?.start).toBe(8);
  expect(next.clips.find(clip => clip.id === 'title')).toEqual(source.clips.at(-1));
});
test('audio collisions use a free audio layer without moving unrelated sound', () => {
  const music = { id: 'music', kind: 'audio' as const, track: 1, start: 0, duration: 1, sourceStart: 0 };
  const next = closeFootageGaps({ ...timeline, clips: [...timeline.clips, music] });
  expect(next.clips.find(clip => clip.id === 'first-a')).toMatchObject({ start: 0, track: 2, sourceStart: 3 });
  expect(next.clips.find(clip => clip.id === 'music')).toEqual(music);
});
test('moving an already joined pair keeps its transition attached to the same cut', () => {
  const pair: Timeline = { fps: 30, aspectRatio: 'landscape', clips: [{ id: 'left', kind: 'image', track: 1, start: 2, duration: 2, sourceStart: 0 }, { id: 'right', kind: 'image', track: 1, start: 4, duration: 2, sourceStart: 0 }] };
  const joined = addTransitionClip(pair, 'crossfade', 'crossfade', 'left', 'right');
  const next = closeFootageGaps(joined);
  expect(next.clips.find(clip => clip.id === 'crossfade')?.transition).toEqual(joined.clips.find(clip => clip.id === 'crossfade')?.transition);
  expect(next.clips.find(clip => clip.id === 'crossfade')?.start).toBeCloseTo(joined.clips.find(clip => clip.id === 'crossfade')!.start - 2);
});
