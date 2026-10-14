import { expect, it } from 'vitest';
import { configureVisualFade, validateVisualFade, visualFadeGain, visualFadeSettings } from './visual-fades';
import { duplicateClip, patchClip, setClipPlaybackRate, splitClip } from './operations';
import { resizeSelectedClips } from './timeline-controls';
import type { Clip, Timeline } from './types';

const clip: Clip = { id: 'source', kind: 'video', assetId: 'owned', track: 1, start: 0, duration: 10, sourceStart: 3, volume: 0, transform: { x: .5, y: .5, scale: 1, rotation: 0, opacity: .8 } };
const source: Timeline = { fps: 30, aspectRatio: 'landscape', clips: [clip] };
const faded = () => configureVisualFade(source, 'source', { fadeIn: 1, fadeOut: 2 });

it('fades opacity at clip edges without changing source, gain or transform', () => {
  const next = faded(), changed = next.clips[0];
  expect({ ...changed, visualFade: undefined }).toEqual({ ...clip, visualFade: undefined, visualFadeTiming: undefined });
  expect([0, .5, 1, 5, 9, 10].map(time => visualFadeGain(changed, time))).toEqual([0, .5, 1, 1, .5, 0]);
  expect(visualFadeGain(clip, 0)).toBe(1);
});
it('splitting inside either fade or its plateau retains the original frame opacity', () => {
  const original = faded().clips[0];
  for (const cut of [.5, 5, 9]) {
    const split = splitClip(faded(), 'source', cut, 'tail');
    for (const child of split.clips) for (const local of [0, child.duration / 2, child.duration - 1 / 30]) {
      expect(visualFadeGain(child, local)).toBeCloseTo(visualFadeGain(original, child.start + local), 10);
    }
  }
  const tail = splitClip(faded(), 'source', 5, 'tail').clips[1];
  expect(visualFadeSettings(tail)).toEqual({ fadeIn: 0, fadeOut: 2 });
});
it('left/right trim and copy preserve phase; explicit fade edits start a new edge fade', () => {
  const left = resizeSelectedClips(faded(), [], ['source'], 'left', .5);
  const right = patchClip(faded(), 'source', { duration: 9 });
  expect(visualFadeGain(left.clips[0], 0)).toBe(.5);
  expect(visualFadeGain(right.clips[0], 8.9)).toBeCloseTo(.55);
  const copied = duplicateClip(left, 'source', 'copy').clips.find(member => member.id === 'copy')!;
  expect(visualFadeGain(copied, 0)).toBe(.5);
  const edited = configureVisualFade(left, 'source', { fadeIn: .25 });
  expect(edited.clips[0].visualFadeTiming).toBeUndefined();
  expect(visualFadeGain(edited.clips[0], 0)).toBe(0);
});
it('speed changes retain original source-phase fade timing', () => {
  const sped = setClipPlaybackRate(faded(), 'source', 2).clips[0];
  expect(sped.duration).toBe(5);
  expect(visualFadeGain(sped, .25)).toBe(.5);
  expect(visualFadeGain(sped, 4.5)).toBe(.5);
});
it('rejects nonmedia, invalid seconds, overlap and malformed persisted phase', () => {
  for (const value of [-1, NaN, Infinity, 86401]) expect(() => configureVisualFade(source, 'source', { fadeIn: value })).toThrow();
  expect(() => configureVisualFade(source, 'source', { fadeIn: 6, fadeOut: 5 })).toThrow('cannot exceed');
  expect(() => configureVisualFade(source, 'source', {})).toThrow('Specify');
  for (const kind of ['audio', 'effect', 'caption', 'graphic'] as const) expect(() => validateVisualFade({ ...clip, kind, visualFade: { fadeIn: 1, fadeOut: 0 } })).toThrow('video and image');
  for (const timing of [{ duration: 0, offset: 0 }, { duration: 10, offset: NaN }]) expect(() => validateVisualFade({ ...clip, visualFadeTiming: timing })).toThrow('timing');
});
