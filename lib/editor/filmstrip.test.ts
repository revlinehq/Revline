import { expect, test } from 'vitest';
import { filmstripFrames, filmstripFrameWidth } from './filmstrip';

const input = { clipWidth: 324, frameWidth: 65 * 16 / 9, visibleStart: 0, visibleEnd: 324, pxPerSecond: 54, sourceStart: 0, duration: 6, fps: 30 };

test('renders multiple proportional frames rather than a whole-clip image', () => {
  const width = filmstripFrameWidth(65, 1920, 1080);
  expect(width / 65).toBeCloseTo(16 / 9);
  expect(filmstripFrames({ ...input, frameWidth: width })).toHaveLength(3);
});
test('portrait frames retain their aspect ratio', () => {
  expect(filmstripFrameWidth(65, 1080, 1920) / 65).toBeCloseTo(9 / 16);
});
test('sampled frames follow the trimmed source offset and frame clock', () => {
  const samples = filmstripFrames({ ...input, sourceStart: 12.5 });
  expect(samples[0].time).toBe(12.5);
  expect(samples[1].time).toBeGreaterThan(samples[0].time);
  for (const sample of samples) expect(sample.time * 30).toBeCloseTo(Math.round(sample.time * 30));
});
test('only builds the visible section of a long clip', () => {
  const samples = filmstripFrames({ ...input, clipWidth: 64_800, visibleStart: 30_000, visibleEnd: 31_000, duration: 300, pxPerSecond: 216 });
  expect(samples.length).toBeLessThan(11);
  expect(samples[0].left).toBeGreaterThan(29_800);
});
test('never requests a frame beyond the available source duration', () => {
  const samples = filmstripFrames({ ...input, duration: 6, sourceStart: 3, sourceDuration: 4 });
  for (const sample of samples) expect(sample.time).toBeLessThan(4);
});
test('invisible clips do not request decoding', () => {
  expect(filmstripFrames({ ...input, visibleStart: 0, visibleEnd: 0 })).toEqual([]);
});
