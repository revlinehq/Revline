import { describe, expect, it } from 'vitest';
import { frameSeekTime } from './operations';
import { timelineTimeAtPointer } from './timeline-controls';

describe('frame-aware seeking', () => {
  for (const fps of [24, 30, 60]) {
    for (const duration of [2.02, 2.15]) {
      it(`keeps a fractional ${duration}s end on the last whole frame at ${fps}fps`, () => {
        const expected = Math.floor(duration * fps) / fps;
        expect(frameSeekTime(duration, fps, duration)).toBe(expected);
        expect(frameSeekTime(100, fps, duration)).toBe(expected);
        expect(timelineTimeAtPointer(1000, { left: 0, scrollLeft: 0, origin: 0, px: 100, end: duration, fps })).toBe(expected);
        expect(timelineTimeAtPointer(1000, { left: 0, scrollLeft: 0, origin: 0, px: 100, end: duration, fps, marks: [duration] })).toBe(expected);
        expect(expected).toBeLessThanOrEqual(duration);
      });
    }
    it(`rounds interior positions to the nearest frame at ${fps}fps`, () => {
      expect(frameSeekTime(12.49 / fps, fps, 10)).toBe(12 / fps);
      expect(frameSeekTime(12.51 / fps, fps, 10)).toBe(13 / fps);
      expect(frameSeekTime(-1, fps, 10)).toBe(0);
    });
    it(`preserves exact frame ends after seven-decimal clock rounding at ${fps}fps`, () => {
      const exactEnd = 31 / fps;
      const clockEnd = Number(exactEnd.toFixed(7));
      expect(frameSeekTime(exactEnd, fps, exactEnd)).toBe(exactEnd);
      expect(frameSeekTime(clockEnd, fps, clockEnd)).toBe(exactEnd);
      expect(frameSeekTime(exactEnd, fps, exactEnd - 1e-5)).toBe(30 / fps);
    });
  }
  it('rejects nonfinite positions, rates, and durations safely', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(frameSeekTime(invalid, 30, 10)).toBe(0);
      expect(frameSeekTime(1, invalid, 10)).toBe(0);
      expect(frameSeekTime(1, 30, invalid)).toBe(0);
    }
    for (const invalid of [0, -1]) {
      expect(frameSeekTime(1, invalid, 10)).toBe(0);
      expect(frameSeekTime(1, 30, invalid)).toBe(0);
    }
    expect(frameSeekTime(1, Number.MAX_VALUE, Number.MAX_VALUE)).toBe(0);
  });
  it('quantizes a nearby off-frame clip edge instead of moving the marker between frames', () => {
    const geometry = { left: 0, scrollLeft: 0, origin: 0, px: 100, end: 5, fps: 30, marks: [2.15] };
    expect(timelineTimeAtPointer(214, geometry)).toBe(65 / 30);
    expect(timelineTimeAtPointer(-100, geometry)).toBe(0);
  });
});
