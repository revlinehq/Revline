import { describe, expect, it } from 'vitest';
import { addBeatMarkers } from './beat-markers';
import { addMediaClip, focusForClip, separateVideoClips, setClipPlaybackRate, splitClip } from './operations';
import { alignCutsToBeats } from './beat-cuts';
import { sourceDurationOf, sourceEndOf, sourceTimeAt, timelineTimeAtSource, validatePlaybackRate } from './playback-rate';
import { resizeSelectedClips } from './timeline-controls';
import { applyTimelineEdit } from './timeline-sync';
import { EMPTY_TIMELINE, type Clip, type MediaAsset } from './types';

const assets: MediaAsset[] = [
  { _id: 'video', kind: 'video', audioAssetId: 'audio', fileName: 'video.mp4', duration: 12, url: null },
  { _id: 'audio', kind: 'audio', fileName: 'audio.m4a', duration: 12, url: null },
];
const pair = () => addMediaClip(EMPTY_TIMELINE, assets[0], 'v', 2);
describe('constant playback speed', () => {
  it('preserves source coverage across repeated rate changes and keeps linked sound synchronized', () => {
    const original = pair();
    const fast = setClipPlaybackRate(original, 'v', 2);
    expect(fast.clips.map(clip => [clip.duration, clip.playbackRate, sourceDurationOf(clip)])).toEqual([[6, 2, 12], [6, 2, 12]]);
    expect(fast.tracks).toEqual(original.tracks);
    expect(fast.clips.map(clip => clip.volume)).toEqual([0, 1]);
    const slow = setClipPlaybackRate(fast, 'v-audio', .5);
    expect(slow.clips.map(clip => [clip.duration, clip.playbackRate])).toEqual([[24, .5], [24, .5]]);
    const normal = setClipPlaybackRate(slow, 'v', 1);
    expect(normal.clips.map(clip => clip.duration)).toEqual([12, 12]);
    expect(normal.clips.map(clip => sourceEndOf(clip))).toEqual([12, 12]);
  });
  it('splits and trims sped-up footage at the correct source frames, including linked audio', () => {
    const fast = setClipPlaybackRate(pair(), 'v', 2);
    const split = splitClip(fast, 'v', 4, 'tail');
    expect(split.clips.filter(clip => clip.id.startsWith('tail')).map(clip => [clip.start, clip.duration, clip.sourceStart])).toEqual([[4, 4, 4], [4, 4, 4]]);
    const left = resizeSelectedClips(fast, assets, ['v'], 'left', 1);
    expect(left.clips.map(clip => [clip.start, clip.duration, clip.sourceStart])).toEqual([[3, 5, 2], [3, 5, 2]]);
    expect(left.clips.map(clip => sourceEndOf(clip))).toEqual([12, 12]);
    const extended = resizeSelectedClips(left, assets, ['v'], 'left', -100);
    expect(extended.clips.map(clip => [clip.start, clip.duration, clip.sourceStart])).toEqual([[2, 6, 0], [2, 6, 0]]);
    expect(resizeSelectedClips(left, assets, ['v'], 'right', 100).clips.map(clip => clip.duration)).toEqual([5, 5]);
  });
  it('lets slow footage extend only to its real source endpoint', () => {
    const slow = setClipPlaybackRate(pair(), 'v', .5);
    const shortened = resizeSelectedClips(slow, assets, ['v'], 'right', -4);
    const restored = resizeSelectedClips(shortened, assets, ['v'], 'right', 100);
    expect(restored.clips.map(clip => [clip.duration, sourceEndOf(clip)])).toEqual([[24, 12], [24, 12]]);
  });
  it('rejects overlaps in either linked group without altering another clip or track', () => {
    for (const kind of ['video', 'audio'] as const) {
      const original = pair();
      const other: Clip = { id: 'neighbor', kind, track: 1, start: 15, duration: 1, sourceStart: 0 };
      const input = { ...original, clips: [...original.clips, other] };
      expect(() => setClipPlaybackRate(input, 'v', .5)).toThrow('overlap');
      expect(input.clips[0].duration).toBe(12);
      expect(input.clips.at(-1)).toBe(other);
    }
  });
  it('carries speed into audio that finishes extraction after the edit', () => {
    const pending = setClipPlaybackRate(addMediaClip(EMPTY_TIMELINE, { _id: 'video', kind: 'video', duration: 12 }, 'v'), 'v', 2);
    const separated = separateVideoClips(pending, { _id: 'video', audioAssetId: 'audio' });
    expect(separated.clips.map(clip => [clip.duration, clip.sourceStart, clip.playbackRate])).toEqual([[6, 0, 2], [6, 0, 2]]);
  });
  it('retimes attached motion when changing the linked audio speed', () => {
    const original = pair();
    const motion = [{ time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 }, { time: 12, x: 0, y: 0, scale: 1.2, rotation: 0, opacity: 1, brightness: 1 }];
    original.clips[0] = { ...original.clips[0], motion, motionOffset: 2 };
    const fast = setClipPlaybackRate(original, 'v-audio', 2);
    expect(fast.clips[0].motion?.map(key => key.time)).toEqual([0, 6]);
    expect(fast.clips[0].motionOffset).toBe(1);
  });
  it('rejects invalid rates, nontimed media and subframe results', () => {
    for (const playbackRate of [0, -.5, .2, 4.1, NaN, Infinity]) expect(() => setClipPlaybackRate(pair(), 'v', playbackRate)).toThrow('playback speed');
    for (const kind of ['image', 'effect', 'caption', 'graphic'] as const) expect(() => validatePlaybackRate({ kind, playbackRate: 1 })).toThrow('video and audio');
    expect(() => setClipPlaybackRate({ ...EMPTY_TIMELINE, clips: [{ id: 'tiny', kind: 'video', start: 0, sourceStart: 0, duration: 1 / 30 }] }, 'tiny', 4)).toThrow('shorter than one frame');
  });
  it('maps analysis, beats and focus using source time at the chosen speed', () => {
    const clip: Clip = { id: 'music', kind: 'audio', start: 10, duration: 3, sourceStart: 4, playbackRate: 2 };
    expect(sourceTimeAt(clip, 11)).toBe(6);
    expect(timelineTimeAtSource(clip, 8)).toBe(12);
    const result = addBeatMarkers({ ...EMPTY_TIMELINE, clips: [clip] }, 'music', { beats: [3, 4, 6, 8, 9, 10], bpm: 120, confidence: .9 });
    expect(result.timeline.markers?.map(marker => marker.time)).toEqual([10, 11, 12, 12.5]);
    const focus = [0, 4, 8, 10, 12].map(time => ({ time, x: .5, y: .5 }));
    expect(focusForClip(focus, clip).map(sample => sample.time)).toEqual([0, 4, 8, 10, 12]);
  });
  it('aligns visual cuts with retimed music and checks retimed shot source coverage', () => {
    const timeline = { ...EMPTY_TIMELINE, clips: [
      { id: 'music', kind: 'audio' as const, assetId: 'audio', start: 0, duration: 6, sourceStart: 2, playbackRate: 2 },
      { id: 'a', kind: 'video' as const, assetId: 'video', start: 0, duration: 2, sourceStart: 8, playbackRate: 2 },
      { id: 'b', kind: 'image' as const, start: 2, duration: 4, sourceStart: 0 },
    ] };
    expect(() => alignCutsToBeats(timeline, assets, 'audio', [2, 4, 6, 8, 10, 12])).toThrow('too short');
    const sufficient = { ...timeline, clips: timeline.clips.map(clip => clip.id === 'a' ? { ...clip, sourceStart: 0 } : clip) };
    expect(alignCutsToBeats(sufficient, assets, 'audio', [2, 4, 6, 8, 10, 12]).clips.map(clip => [clip.start, clip.duration])).toEqual([[0, 6], [0, 3], [3, 3]]);
  });
  it('rebases duration, source trim and speed together when a remote edit races a manual edit', () => {
    const before = pair();
    const local = setClipPlaybackRate(before, 'v', 2);
    const remote = { ...before, clips: before.clips.map(clip => ({ ...clip, sourceStart: 1, duration: 10, playbackRate: .5 })) };
    const merged = applyTimelineEdit(before, local, remote);
    expect(merged.clips.map(clip => [clip.duration, clip.sourceStart, clip.playbackRate])).toEqual([[6, 0, 2], [6, 0, 2]]);
  });
});
