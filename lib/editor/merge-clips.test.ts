import { expect, test } from 'vitest';
import { mergeSplitClips } from './merge-clips';
import { addMediaClip, addTransitionClip, splitClip } from './operations';
import { createEditorStore } from './store';
import { audioSettings } from './audio-settings';
import { visualFadeGain } from './visual-fades';
import { type Timeline } from './types';
const original: Timeline = addMediaClip({ fps: 30, aspectRatio: 'landscape', clips: [] }, { _id: 'video', kind: 'video', duration: 8, audioAssetId: 'audio' }, 'v');
const split = () => splitClip(original, 'v', 3, 'tail');
test('two selected split video/audio pairs become one linked pair with the exact retained source range and one Undo', () => {
  const current = split(), result = mergeSplitClips(current, ['v', 'v-audio', 'tail', 'tail-audio']);
  expect(result.timeline.clips).toEqual(original.clips); expect(result.mergedClipIds).toEqual(['v']);
  const store = createEditorStore(current); store.getState().edit(result.timeline);
  expect(store.getState().undo()).toEqual(current);
});
test('selecting one right half or linked audio finds its adjacent compatible split neighbor', () => {
  expect(mergeSplitClips(split(), ['tail']).timeline.clips).toEqual(original.clips);
  expect(mergeSplitClips(split(), ['tail-audio']).timeline.clips).toEqual(original.clips);
});
test('standalone audio split pieces merge without changing gain, speed or retained source trim', () => {
  const source: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 0, overlay: 0, audio: 1 }, clips: [{ id: 'music', kind: 'audio', assetId: 'music-source', track: 1, start: 0, duration: 6, sourceStart: 5, playbackRate: 1.5, volume: .7 }] };
  const current = splitClip(source, 'music', 2, 'music-tail');
  expect(mergeSplitClips(current, ['music', 'music-tail']).timeline).toEqual(source);
  expect(mergeSplitClips(current, ['music-tail']).timeline).toEqual(source);
});
test('speed, motion offsets and frozen visual/audio fade clocks preserve their continuous phase', () => {
  const source: Timeline = { ...original, clips: original.clips.map(clip => ({ ...clip, playbackRate: 2, ...(clip.kind === 'video' ? { visualFade: { fadeIn: 1, fadeOut: 2 }, motion: [{ time: 0, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, brightness: 1 }, { time: 8, x: .5, y: .5, scale: 1.2, rotation: 0, opacity: 1, brightness: 1 }] } : { audio: { ...audioSettings(clip), fadeIn: 1, fadeOut: 2 } }) })) };
  const current = splitClip(splitClip(source, 'v', 2, 'middle'), 'middle', 5, 'end');
  const merged = mergeSplitClips(current, ['v', 'middle', 'end']).timeline;
  expect(merged.clips).toHaveLength(2); expect(merged.clips[0]).toMatchObject({ duration: 8, sourceStart: 0, playbackRate: 2, visualFadeTiming: { duration: 8, offset: 0 } });
  expect(merged.clips[1]).toMatchObject({ duration: 8, audioFadeTiming: { duration: 8, offset: 0 } });
  for (const time of [0, 2.5, 6.5, 7.9]) expect(visualFadeGain(merged.clips[0], time)).toBeCloseTo(visualFadeGain(source.clips[0], time));
});
test('source holes, timeline gaps, changed settings, broken linked audio and no selection fail without changing input', () => {
  const current = split(), before = structuredClone(current);
  expect(() => mergeSplitClips(current, [])).toThrow('Select adjacent split pieces');
  expect(() => mergeSplitClips({ ...current, clips: current.clips.map(clip => clip.id === 'tail' ? { ...clip, sourceStart: clip.sourceStart + 1 } : clip) }, ['v', 'tail'])).toThrow('restore deleted frames');
  expect(() => mergeSplitClips({ ...current, clips: current.clips.map(clip => clip.id === 'tail' ? { ...clip, start: clip.start + 1 } : clip) }, ['v', 'tail'])).toThrow('touch on the timeline');
  expect(() => mergeSplitClips({ ...current, clips: current.clips.map(clip => clip.id === 'tail' ? { ...clip, transform: { x: .5, y: .5, scale: 2, rotation: 0, opacity: 1 } } : clip) }, ['v', 'tail'])).toThrow('different settings');
  expect(() => mergeSplitClips({ ...current, clips: current.clips.filter(clip => clip.id !== 'tail-audio') }, ['v', 'tail'])).toThrow('matching linked audio');
  expect(current).toEqual(before);
});
test('an outside transition follows the surviving clip ID; an internal transition is never silently removed', () => {
  const source: Timeline = { ...original, clips: [...original.clips, { id: 'next', kind: 'image', assetId: 'image', track: 1, start: 8, duration: 2, sourceStart: 0 }] };
  const joined = addTransitionClip(source, 'transition', 'crossfade', 'v', 'next');
  const current = splitClip(joined, 'v', 3, 'tail');
  const merged = mergeSplitClips(current, ['v', 'tail']).timeline;
  expect(merged.clips.find(clip => clip.id === 'transition')?.transition).toMatchObject({ fromClipId: 'v', toClipId: 'next' });
  const inside = addTransitionClip(split(), 'inside', 'crossfade', 'v', 'tail');
  expect(() => mergeSplitClips(inside, ['v', 'tail'])).toThrow('Remove the transition');
});
