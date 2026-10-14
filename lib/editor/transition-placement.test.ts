import { expect, test } from 'vitest';
import { dropLibraryEffect } from './effect-drag';
import { addTransitionClip, splitClip } from './operations';
import { moveSelectedClips, moveSelectionToNewLayers } from './timeline-controls';
import { transitionSources } from './clip-transitions';
import { createEditorStore } from './store';
import { timelineDuration, type Timeline } from './types';

const footage: Timeline = {
  fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1, effects: 1 },
  markers: [{ id: 'marker', time: 6 }],
  clips: [
    { id: 'video', kind: 'video', assetId: 'source', start: 0, duration: 10, sourceStart: 8, playbackRate: 1.25, track: 1, volume: 0, audioSeparated: true, linkedClipId: 'audio', transform: { x: .5, y: .5, scale: 1.2, rotation: 8, opacity: .8 }, dither: { enabled: true, amount: .5, levels: 5, size: 2 } },
    { id: 'audio', kind: 'audio', assetId: 'sound', start: 0, duration: 10, sourceStart: 8, playbackRate: 1.25, track: 1, volume: .7, linkedClipId: 'video', audio: { role: 'voice', fadeIn: .5, fadeOut: .5, ducking: { enabled: false, amount: .65, attack: .2, release: .3 } } },
    { id: 'title', kind: 'graphic', start: 2, duration: 5, sourceStart: 0, track: 2, text: 'Keep me' },
  ],
};

test('dropping a transition inside unsplit footage cuts there, preserving source, sound phase and overlays in one undo', () => {
  const store = createEditorStore(footage);
  const next = dropLibraryEffect(footage, { preset: 'spin-zoom' }, 4, 'visual', 1, 'video', 'fx');
  store.getState().edit(next);
  const sources = transitionSources(next.clips, next.fps);
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({ cut: 4, from: { id: 'video', duration: 4 }, to: { start: 4, duration: 6, sourceStart: 13, playbackRate: 1.25 } });
  const audio = next.clips.filter(clip => clip.kind === 'audio');
  expect(audio).toHaveLength(2);
  expect(audio[0]).toMatchObject({ id: 'audio', start: 0, duration: 4, volume: .7, audioFadeTiming: { duration: 10, offset: 0 } });
  expect(audio[1]).toMatchObject({ start: 4, duration: 6, sourceStart: 13, volume: .7, audioFadeTiming: { duration: 10, offset: 4 } });
  expect(sources[0].to.linkedClipId).toBe(audio[1].id);
  expect(audio[1].linkedClipId).toBe(sources[0].to.id);
  expect(sources[0].to.transform).toEqual(footage.clips[0].transform);
  expect(sources[0].to.dither).toEqual(footage.clips[0].dither);
  expect(next.clips.find(clip => clip.id === 'title')).toEqual(footage.clips[2]);
  expect(next.markers).toEqual(footage.markers);
  expect(timelineDuration(next)).toBe(10);
  expect(store.getState().history).toHaveLength(1);
  expect(store.getState().undo()).toEqual(footage);
  expect(store.getState().redo()).toEqual(next);
});

const joined = () => addTransitionClip(splitClip(footage, 'video', 4, 'tail'), 'fx', 'crossfade', 'video', 'tail');

test('dropping onto an existing cut reuses both pieces without splitting again', () => {
  const cut = splitClip(footage, 'video', 4, 'tail');
  const next = dropLibraryEffect(cut, { preset: 'crossfade' }, 4, 'visual', 1, 'tail', 'fx');
  expect(next.clips.filter(clip => clip.kind !== 'effect')).toEqual(cut.clips);
  expect(transitionSources(next.clips, 30)[0].cut).toBe(4);
});

test('an occupied cut rejects the drop instead of jumping to a different place', () => {
  const current = splitClip(joined(), 'tail', 7, 'third');
  expect(() => dropLibraryEffect(current, { preset: 'blur-dissolve' }, 4, 'visual', 1, 'video', 'other')).toThrow(/overlap/i);
});

test('moving an existing transition to the middle of footage cuts at its new center', () => {
  const current = joined();
  const moved = moveSelectedClips(current, ['fx'], 3, 0);
  const source = transitionSources(moved.clips, 30)[0];
  expect(source).toMatchObject({ cut: 7, clip: { id: 'fx', effectPreset: 'crossfade', start: 6.7, duration: .6 }, from: { id: 'tail', start: 4, duration: 3 }, to: { start: 7, duration: 3, sourceStart: 16.75 } });
  expect(moved.clips.find(clip => clip.id === 'video')).toEqual(current.clips.find(clip => clip.id === 'video'));
  expect(moved.clips.filter(clip => clip.kind === 'audio')).toHaveLength(3);
  expect(timelineDuration(moved)).toBe(10);
});

test('moving into a new FX layer still places the new cut at the dragged center', () => {
  const next = moveSelectionToNewLayers(joined(), ['fx'], 3, 'above', 'fx');
  expect(transitionSources(next.clips, 30)[0]).toMatchObject({ cut: 7, clip: { track: 2 } });
});

test('moving a transition near zero clamps its duration rather than pinning its old left edge', () => {
  const next = moveSelectedClips(joined(), ['fx'], 1 / 30 - 4, 0);
  expect(transitionSources(next.clips, 30)[0]).toMatchObject({ cut: 1 / 30, clip: { start: 0, duration: 2 / 30 } });
});

test('dropping in empty space or at an unjoined outer edge never teleports to a distant cut', () => {
  const current = joined();
  for (const at of [0, 10, 12]) expect(() => dropLibraryEffect(current, { preset: 'spin-zoom' }, at, 'visual', 1, undefined, 'other')).toThrow();
  expect(() => moveSelectedClips(current, ['fx'], 8, 0)).toThrow();
});

test('an explicit V lane is honored and an FX drop chooses the top footage at that position', () => {
  const upper = { id: 'upper', kind: 'image' as const, assetId: 'still', start: 0, duration: 10, sourceStart: 0, track: 3 };
  const current = { ...footage, clips: [...footage.clips, upper] };
  const below = dropLibraryEffect(current, { preset: 'crossfade' }, 5, 'visual', 1, 'video', 'fx');
  expect(transitionSources(below.clips, 30)[0].track).toBe(1);
  const above = dropLibraryEffect(current, { preset: 'crossfade' }, 5, 'effects', 1, undefined, 'fx');
  expect(transitionSources(above.clips, 30)[0]).toMatchObject({ track: 3, from: { id: 'upper' } });
  expect(above.clips.find(clip => clip.id === 'audio')).toEqual(footage.clips[1]);
});

test('splits near the clip edge retain one frame on each side and clamp transition duration', () => {
  const next = dropLibraryEffect(footage, { preset: 'crossfade' }, 1 / 30, 'visual', 1, 'video', 'fx');
  expect(transitionSources(next.clips, 30)[0]).toMatchObject({ cut: 1 / 30, clip: { duration: 2 / 30 } });
  expect(() => dropLibraryEffect(footage, { preset: 'crossfade' }, .001, 'visual', 1, 'video', 'fx')).toThrow();
});
