import { expect, test } from 'vitest';
import { retainSourceRanges } from './retained-ranges';
import type { Timeline } from './types';
import { NEUTRAL_MOTION } from './clip-effects';

const timeline = (): Timeline => ({ fps: 10, aspectRatio: 'landscape', markers: [{ id: 'cue', time: 9 }], tracks: { visual: 3, overlay: 0, audio: 2, effects: 1 }, clips: [
  { id: 'video', kind: 'video', assetId: 'footage', start: 5, duration: 6, sourceStart: 10, playbackRate: 2, track: 2, linkedClipId: 'audio', audioSeparated: true, volume: 0, fit: 'contain', transform: { x: .4, y: .6, scale: 1.2, rotation: 7, opacity: .8 }, motion: [{ ...NEUTRAL_MOTION, time: 0, scale: 1 }, { ...NEUTRAL_MOTION, time: 6, scale: 2 }], motionOffset: .3, visualFade: { fadeIn: .5, fadeOut: .5 } },
  { id: 'audio', kind: 'audio', assetId: 'sound', start: 5, duration: 6, sourceStart: 10, playbackRate: 2, track: 1, linkedClipId: 'video', volume: .7, audio: { role: 'voice', fadeIn: .2, fadeOut: .3, ducking: { enabled: false, amount: .5, attack: .1, release: .2 } } },
  { id: 'other', kind: 'video', assetId: 'other-source', start: 0, duration: 12, sourceStart: 0, track: 3 },
] });

test('one compact edit retains linked source ranges, speed, styling, motion/fade phase and unrelated layers', () => {
  const before = timeline(), untouched = structuredClone(before), ids = ['next-video', 'next-audio'];
  const result = retainSourceRanges(before, 'video', [{ start: 11, end: 13 }, { start: 17, end: 19.2 }], () => ids.shift()!);
  const [first, second] = result.ranges;
  expect(first).toMatchObject({ clipId: 'video', linkedClipId: 'audio', sourceStart: 11, sourceEnd: 13, start: 5, duration: 1 });
  expect(second).toMatchObject({ clipId: 'next-video', linkedClipId: 'next-audio', sourceStart: 17, sourceEnd: 19.2, start: 6 });
  expect(second.duration).toBeCloseTo(1.1);
  const video = result.timeline.clips.find(clip => clip.id === 'next-video')!, audio = result.timeline.clips.find(clip => clip.id === 'next-audio')!;
  expect(video).toMatchObject({ playbackRate: 2, track: 2, fit: 'contain', transform: before.clips[0].transform, volume: 0, motion: before.clips[0].motion, motionOffset: 3.8, visualFadeTiming: { duration: 6, offset: 3.5 } });
  expect(audio).toMatchObject({ linkedClipId: video.id, playbackRate: 2, track: 1, sourceStart: 17, start: 6, volume: .7, audio: before.clips[1].audio, audioFadeTiming: { duration: 6, offset: 3.5 } });
  expect(result.timeline.clips.find(clip => clip.id === 'other')).toBe(before.clips[2]);
  expect(result.timeline.markers).toBe(before.markers); expect(result.timeline.tracks).toBe(before.tracks); expect(before).toEqual(untouched);
});

test('word boundaries round outward and sub-frame gaps merge without losing spoken content', () => {
  const result = retainSourceRanges(timeline(), 'video', [{ start: 11.03, end: 12.97 }, { start: 13.02, end: 14.1 }]);
  expect(result.ranges).toHaveLength(1);
  expect(result.ranges[0]).toMatchObject({ sourceStart: 11, sourceEnd: 14.2, start: 5 });
});

test.each([
  { ranges: [{ start: 9, end: 11 }] }, { ranges: [{ start: 21, end: 23 }] }, { ranges: [{ start: 12, end: 13 }, { start: 11, end: 12 }] },
  { ranges: [{ start: 11, end: 13 }, { start: 12, end: 14 }] }, { ranges: [{ start: 11, end: 11.05 }] }, { ranges: [{ start: NaN, end: 13 }] }, { ranges: [] },
])('refuses invalid or previously removed source ranges: $ranges', ({ ranges }) => {
  expect(() => retainSourceRanges(timeline(), 'video', ranges)).toThrow(/Source ranges|retained source ranges/);
});

test('full retained source is a no-op and choosing linked audio keeps video linked', () => {
  const before = timeline();
  expect(retainSourceRanges(before, 'video', [{ start: 10, end: 22 }]).timeline).toBe(before);
  const result = retainSourceRanges(before, 'audio', [{ start: 11, end: 13 }]);
  expect(result.timeline.clips.find(clip => clip.id === 'video')).toMatchObject({ sourceStart: 11, start: 5, duration: 1, linkedClipId: 'audio' });
});

test('refuses unsafe transitions and inconsistent linked timing instead of changing their meaning', () => {
  const withTransition = timeline();
  withTransition.clips.push({ id: 'transition', kind: 'effect', effectPreset: 'crossfade', start: 10.5, duration: 1, sourceStart: 0, transition: { fromClipId: 'video', toClipId: 'other', direction: 'clockwise' } });
  expect(() => retainSourceRanges(withTransition, 'video', [{ start: 11, end: 13 }])).toThrow(/connected transition/);
  const desynced = timeline(); desynced.clips[1].start += .1;
  expect(() => retainSourceRanges(desynced, 'video', [{ start: 11, end: 13 }])).toThrow(/synchronized timing/);
});
