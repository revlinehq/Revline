import { expect, it } from 'vitest';
import { decodeWaveform, waveformBars } from './audio-waveform';

const data = decodeWaveform({ peaks: Buffer.from([...Array(100).fill(0), ...Array(100).fill(64), ...Array(100).fill(191)]).toString('base64'), samplesPerSecond: 100 });
it('keeps silent regions empty and samples source offsets after a trim', () => {
  const full = waveformBars(data, 0, 3, 900, 0, 900);
  expect(full.slice(0, 100).every(bar => bar.amplitude === 0)).toBe(true);
  const trimmed = waveformBars(data, 2, 1, 300, 0, 300);
  expect(trimmed.every(bar => bar.amplitude === 1)).toBe(true);
  const quiet = waveformBars(data, 1, 1, 300, 0, 300);
  expect(quiet[0].amplitude).toBeCloseTo(64 / 191);
});
it('follows gain without changing time and limits work to the visible zoomed region', () => {
  expect(waveformBars(data, 2, 1, 300, 0, 300, .5)[0].amplitude).toBe(.5);
  expect(waveformBars(data, 2, 1, 300, 0, 300, 0).every(bar => bar.amplitude === 0)).toBe(true);
  expect(waveformBars(data, 1, 1, 300, 0, 300, 2)[0].amplitude).toBeCloseTo(128 / 191);
  const zoomed = waveformBars(data, 0, 3, 90_000, 60_000, 60_300);
  expect(zoomed).toHaveLength(100);
  expect(zoomed[0]).toEqual({ left: 60_000, amplitude: 1 });
});
it('maps waveform peaks to timeline positions at fast and slow playback rates', () => {
  const fast = waveformBars(data, 0, 1.5, 900, 0, 900, 1, 2);
  expect(fast.find(bar => bar.left === 300)?.amplitude).toBeCloseTo(64 / 191);
  expect(fast.find(bar => bar.left === 600)?.amplitude).toBe(1);
  const slow = waveformBars(data, 0, 6, 900, 0, 900, 1, .5);
  expect(slow).toEqual(fast);
});
