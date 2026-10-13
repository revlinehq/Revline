import { afterEach, expect, test, vi } from 'vitest';
import { parseFrameInspection, selectInspectionFrames, validateFrameInspectionInput, validateFrameInspectionResult } from './frame-inspection';
import { inspectVideoFrames } from './gemini';

const input = { start: 1, end: 1.1, question: 'When does the fist contact its target?' };
const samples = [{ frameIndex: 30, time: 1 }, { frameIndex: 31, time: 31 / 30 }, { frameIndex: 32, time: 32 / 30 }];
const answer = { summary: 'Apparent contact in the second frame.', uncertainty: 'Contact is visible, but a sound cannot be inferred.', frames: samples.map(frame => ({ frameIndex: frame.frameIndex, observation: 'Fist near the target.' })), events: [{ frameIndex: 31, description: 'Apparent contact', confidence: 'medium' as const }] };
afterEach(() => vi.unstubAllGlobals());

test('rejects out-of-range or unbounded frame requests', () => {
  expect(() => validateFrameInspectionInput(input, 2)).not.toThrow();
  for (const range of [{ start: -1, end: 1 }, { start: 0, end: 4 }, { start: 1, end: 1 }, { start: 0, end: Infinity }, { start: 1, end: 3 }]) expect(() => validateFrameInspectionInput({ ...input, ...range }, 2)).toThrow('window');
  expect(() => validateFrameInspectionInput({ ...input, question: ' ' }, 2)).toThrow('question');
});

test('narrow windows keep consecutive frames; broad windows sample actual indices and PTS', () => {
  const source = Array.from({ length: 90 }, (_, frameIndex) => ({ frameIndex, time: frameIndex / 30 }));
  expect(selectInspectionFrames(source, input)).toEqual(samples);
  const sparse = selectInspectionFrames(source, { ...input, start: 0, end: 3 });
  expect(sparse).toHaveLength(12);
  expect(sparse[0]).toEqual(source[0]); expect(sparse[11]).toEqual(source[89]);
  expect(sparse.every(frame => source.includes(frame))).toBe(true);
  expect(() => selectInspectionFrames(source, { ...input, start: 3, end: 3.1 })).toThrow('No decoded');
});

test('source timestamps are attached by code and invented frame evidence is rejected', () => {
  const result = parseFrameInspection(JSON.stringify(answer), input, samples, 30);
  expect(result.events[0]).toMatchObject({ frameIndex: 31, time: 31 / 30 });
  expect(result.consecutive).toBe(true); expect(result.sampleInterval).toBeCloseTo(1 / 30);
  expect(() => parseFrameInspection(JSON.stringify({ ...answer, events: [{ ...answer.events[0], frameIndex: 999 }] }), input, samples, 30)).toThrow('exact frames');
  expect(() => parseFrameInspection(JSON.stringify({ ...answer, frames: [answer.frames[0], answer.frames[0], answer.frames[2]] }), input, samples, 30)).toThrow('exact frames');
  expect(() => validateFrameInspectionResult({ ...result, consecutive: false }, input)).toThrow('sampling metadata');
  expect(() => validateFrameInspectionResult({ ...result, events: [{ ...result.events[0], time: 1.01 }] }, input)).toThrow('inspected frames');
});

test('Gemini receives labeled inline frames and returns evidence without fabricated timing', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(answer) }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const result = await inspectVideoFrames(samples.map(frame => ({ ...frame, data: 'ZmFrZS1pbWFnZQ==' })), 30, input, 'fixture-key', AbortSignal.timeout(1000));
  expect(result.events[0].time).toBe(31 / 30);
  expect(result.frames[0]).not.toHaveProperty('data');
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.store).toBe(false);
  expect(body.input.filter((item: { type: string }) => item.type === 'image')).toHaveLength(3);
  expect(body.input.some((item: { text?: string }) => item.text?.includes('SOURCE FRAME 31; source timestamp 1.033333'))).toBe(true);
  expect(body.response_format.mime_type).toBe('application/json');
});
