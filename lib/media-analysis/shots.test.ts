import { expect, test } from 'vitest';
import { parseShots, shotAlignedRange, type ShotDetection } from './shots';

const detection: ShotDetection = { fps: 24, shots: [{ start: 0, end: 1, startFrame: 0, endFrame: 24 }, { start: 1, end: 2, startFrame: 24, endFrame: 48 }, { start: 2, end: 3, startFrame: 48, endFrame: 72 }] };
test('retains contiguous source frames and their times', () => { expect(parseShots(detection, 3)).toEqual(detection); });
test.each([
  { ...detection, fps: 0 },
  { ...detection, shots: [] },
  { ...detection, shots: [{ start: 0, end: 4, startFrame: 0, endFrame: 96 }] },
  { ...detection, shots: [{ start: 0, end: 1.1, startFrame: 0, endFrame: 24 }] },
  { ...detection, shots: [detection.shots[0], detection.shots[2]] },
  { ...detection, shots: [detection.shots[0]] },
])('rejects malformed, disconnected, truncated or out-of-source boundaries', value => { expect(() => parseShots(value, 3)).toThrow(); });
test('uses detected cut edges for approximate semantic timestamps', () => { expect(shotAlignedRange({ start: 0.9, end: 2.1 }, detection)).toEqual({ start: 1, end: 2 }); });
test('retains the containing shot for short semantic ranges', () => { expect(shotAlignedRange({ start: 1.6, end: 1.7 }, detection)).toEqual({ start: 1, end: 2 }); });
test('keeps old analysis usable when no shot boundaries are saved', () => { expect(shotAlignedRange({ start: 0.9, end: 2.1 })).toEqual({ start: 0.9, end: 2.1 }); });
