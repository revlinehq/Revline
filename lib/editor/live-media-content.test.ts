import { expect, it } from 'vitest';
import { needsLiveMediaSync } from './live-media-content';
import { splitClip } from './operations';
import type { Clip, Timeline } from './types';

const clip: Clip = { id: 'video', kind: 'video', assetId: 'source', start: 0, duration: 10, sourceStart: 3, track: 1 };
const before: Timeline = { fps: 30, aspectRatio: 'landscape', clips: [clip] };

it('refreshes native activation for split, trim, source, rate, insert and delete edits', () => {
  expect(needsLiveMediaSync(before, splitClip(before, clip.id, 5, 'tail'))).toBe(true);
  for (const patch of [{ start: 1 }, { duration: 9 }, { sourceStart: 4 }, { assetId: 'another' }, { playbackRate: 2 }]) {
    expect(needsLiveMediaSync(before, { ...before, clips: [{ ...clip, ...patch }] })).toBe(true);
  }
  expect(needsLiveMediaSync(before, { ...before, clips: [] })).toBe(true);
  expect(needsLiveMediaSync(before, { ...before, clips: [...before.clips, { ...clip, id: 'image', kind: 'image', start: 20 }] })).toBe(true);
});
it('effect, fade, gain and layer-order edits preserve the transport position', () => {
  const effect: Clip = { id: 'fx', kind: 'effect', effectPreset: 'zoom-blur', start: 0, duration: 1, sourceStart: 0 };
  expect(needsLiveMediaSync(before, { ...before, clips: [{ ...clip, dither: { enabled: true, amount: 1, levels: 3, size: 2 }, visualFade: { fadeIn: 1, fadeOut: 1 }, volume: .4, track: 2 }, effect] })).toBe(false);
  const second = { ...clip, id: 'second', track: 2 };
  expect(needsLiveMediaSync({ ...before, clips: [clip, second] }, { ...before, clips: [second, clip] })).toBe(false);
});
