import { describe, expect, test } from 'vitest';
import { detectBeats } from './beats';

function clickTrack(bpm: number, seconds: number) {
  const rate = 16_000;
  const audio = new Float32Array(rate * seconds);
  const times: number[] = [];
  for (let time = 0.25; time < seconds - 0.1; time += 60 / bpm) {
    times.push(time);
    const start = Math.round(time * rate);
    for (let i = 0; i < 1000 && start + i < audio.length; i++) audio[start + i] += Math.sin(i / rate * 2 * Math.PI * 1000) * Math.exp(-i / 120);
  }
  return { audio, times };
}

describe('beat analysis', () => {
  test('returns no manufactured beat grid for silence', () => {
    expect(detectBeats(new Float32Array(16_000 * 5))).toEqual({ beats: [], bpm: 0, confidence: 0 });
  });
  test.each([90, 120, 150])('detects a real %i BPM click track at source times', bpm => {
    const { audio, times } = clickTrack(bpm, 10);
    const result = detectBeats(audio);
    expect(Math.abs(result.bpm - bpm)).toBeLessThanOrEqual(2);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.beats.length).toBe(times.length);
    for (const [index, beat] of result.beats.entries()) expect(Math.abs(beat - times[index])).toBeLessThan(0.04);
  });
  test('handles an isolated impulse without inventing a BPM', () => {
    const audio = new Float32Array(16_000 * 2);
    audio[8000] = 1;
    const result = detectBeats(audio);
    expect(result.bpm).toBe(0);
    expect(result.beats).toContain(0.5);
  });
});
