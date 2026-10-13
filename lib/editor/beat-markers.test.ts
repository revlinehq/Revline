import { expect, test } from 'vitest';
import { addBeatMarkers } from './beat-markers';
import { detectBeats, type BeatMap } from '../media-analysis/beats';
import { EMPTY_TIMELINE, type Timeline } from './types';

const timeline: Timeline = { ...EMPTY_TIMELINE, clips: [
  { id: 'other-use', kind: 'audio', assetId: 'song', start: 0, sourceStart: 0, duration: 4 },
  { id: 'music', kind: 'audio', assetId: 'song', start: 20, sourceStart: 8, duration: 4 },
] };
const measured = (beats: number[], confidence = .9): BeatMap => ({ beats, bpm: 120, confidence });

test('maps only the chosen retained audio source range, preserving clips and manual markers', () => {
  const manual = { id: 'manual', time: 5, label: 'My drop' };
  const input = { ...timeline, markers: [manual] };
  const result = addBeatMarkers(input, 'music', measured([0, 7.9, 8, 8.52, 9, 11.9, 12, 14]));
  expect(result.timeline.markers?.map(marker => marker.time)).toEqual([5, 20, 20 + 16 / 30, 21, 23.9]);
  expect(result.timeline.markers?.[0]).toBe(manual);
  expect(result.timeline.clips).toBe(input.clips);
  expect(input.markers).toEqual([manual]);
  expect(result).toMatchObject({ status: 'added', added: 4, skipped: 0, confidence: .9 });
});

test.each([24, 30, 60])('snaps measured beats to frames at %i fps and deduplicates neighboring frames', fps => {
  const input = { ...timeline, fps };
  const result = addBeatMarkers(input, 'music', measured([8.503, 8.503, 8.503 + 1 / fps, 9.001]));
  expect(result.added).toBe(2);
  expect(result.skipped).toBe(2);
  for (const marker of result.timeline.markers ?? []) expect(marker.time * fps).toBeCloseTo(Math.round(marker.time * fps), 8);
  expect(addBeatMarkers(result.timeline, 'music', measured([8.503, 8.503 + 1 / fps, 9.001]))).toMatchObject({ status: 'already-marked', added: 0, skipped: 3, timeline: result.timeline });
  expect(addBeatMarkers(result.timeline, 'music', measured([8.503, 9.001])).timeline).toBe(result.timeline);
});

test('limits markers to the requested timeline range before and after frame rounding', () => {
  const result = addBeatMarkers(timeline, 'music', measured([8, 9.02, 9.03, 9.04, 9.99, 10.01, 10.014, 10.02]), { start: 21.02, end: 22.01 });
  expect(result.timeline.markers?.map(marker => marker.time)).toEqual([21 + 1 / 30, 22]);
  expect(addBeatMarkers(timeline, 'music', measured([9.987]), { end: 21.99 }).status).toBe('no-beats-in-range');
  expect(addBeatMarkers(timeline, 'music', measured([9.01]), { start: 21.005 }).status).toBe('no-beats-in-range');
  expect(addBeatMarkers(timeline, 'music', measured([8, 9]), { start: 25 }).timeline).toBe(timeline);
  expect(addBeatMarkers(timeline, 'music', measured([8, 9]), { end: 10 }).timeline).toBe(timeline);
});

test('does not round markers outside a clip with subframe trim boundaries', () => {
  const input: Timeline = { ...timeline, clips: [{ ...timeline.clips[1], start: 20.01, duration: 1 }] };
  const result = addBeatMarkers(input, 'music', measured([8, 8.02, 8.5, 8.999, 9]));
  expect(result.timeline.markers?.map(marker => marker.time)).toEqual([20 + 1 / 30, 20.5, 21]);
  for (const marker of result.timeline.markers ?? []) expect(marker.time).toBeGreaterThanOrEqual(20.01);
});

test('preserves manual labels and skips their neighboring frames on repeated and overlapping requests', () => {
  const manual = { id: 'manual', time: 21 + 1 / 30, label: 'Beat 1' };
  const input = { ...timeline, markers: [manual] };
  const beats = measured([8, 9, 9.02, 10, 11]);
  const first = addBeatMarkers(input, 'music', beats, { end: 23 });
  expect(first).toMatchObject({ added: 2, skipped: 2 });
  expect(first.timeline.markers?.map(marker => marker.label)).toEqual(['Beat 1', 'Beat 2', 'Beat 3']);
  const second = addBeatMarkers(first.timeline, 'music', beats, { start: 21 });
  expect(second).toMatchObject({ added: 1, skipped: 3 });
  expect(second.timeline.markers?.[0]).toBe(manual);
  expect(addBeatMarkers(second.timeline, 'music', beats).timeline).toBe(second.timeline);
});

test('uses deterministic bounded unique IDs without overwriting an existing ID collision', () => {
  const id = 'x'.repeat(100);
  const input: Timeline = { ...timeline, clips: [{ ...timeline.clips[1], id }] };
  const first = addBeatMarkers(input, id, measured([8, 9, 10]));
  expect(addBeatMarkers(input, id, measured([10, 8, 9])).timeline).toEqual(first.timeline);
  const markers = first.timeline.markers!;
  expect(new Set(markers.map(marker => marker.id)).size).toBe(3);
  expect(markers.every(marker => marker.id.length <= 100)).toBe(true);
  const manual = { id: markers[0].id, time: 0, label: 'Manual' };
  const collision = addBeatMarkers({ ...input, markers: [manual] }, id, measured([8]));
  expect(collision.timeline.markers?.[0]).toBe(manual);
  expect(collision.timeline.markers?.[1].id).not.toBe(manual.id);
  expect(addBeatMarkers(collision.timeline, id, measured([8])).timeline).toBe(collision.timeline);
});

test('reports absent, empty, low-confidence, and out-of-range analysis without manufacturing beats', () => {
  expect(addBeatMarkers(timeline, 'music', undefined)).toMatchObject({ status: 'unavailable', confidence: null, added: 0, timeline });
  const silence = detectBeats(new Float32Array(16_000));
  expect(addBeatMarkers(timeline, 'music', silence)).toMatchObject({ status: 'no-beats', added: 0, timeline });
  expect(addBeatMarkers(timeline, 'music', measured([8, 9], .15))).toMatchObject({ status: 'low-confidence', confidence: .15, added: 0, timeline });
  expect(addBeatMarkers(timeline, 'music', measured([0, 1, 2]))).toMatchObject({ status: 'no-beats-in-range', added: 0, timeline });
});

test('rejects a missing or nonaudio clip, invalid ranges, and nonfinite beat analysis', () => {
  expect(() => addBeatMarkers(timeline, 'missing', measured([8]))).toThrow('Choose an audio clip');
  const video: Timeline = { ...timeline, clips: [{ ...timeline.clips[1], kind: 'video' }] };
  expect(() => addBeatMarkers(video, 'music', measured([8]))).toThrow('Choose an audio clip');
  for (const range of [{ start: NaN }, { end: Infinity }, { start: -1 }, { start: 21, end: 21 }, { start: 22, end: 21 }]) expect(() => addBeatMarkers(timeline, 'music', measured([8]), range)).toThrow('timeline range');
  for (const analysis of [measured([NaN]), measured([Infinity]), measured([-1]), measured([8], NaN), measured([8], 1.1)]) expect(() => addBeatMarkers(timeline, 'music', analysis)).toThrow('saved beat analysis');
});
