import { expect, test } from 'vitest';
import { parseVideoInspection, VideoInspectionValidationError } from './video-inspection';

const input = { start: 0, end: 175.690956, question: 'Private visual question' };
const evidence = { summary: 'A visible event.', uncertainty: '', matches: [{ start: 170, end: 175.7, description: 'Private provider description' }] };

test('out-of-window diagnostics preserve exact endpoints without exposing the question or provider description', () => {
  try { parseVideoInspection(JSON.stringify(evidence), input, input.end); throw new Error('Expected validation to fail'); }
  catch (error) {
    expect(error).toBeInstanceOf(VideoInspectionValidationError);
    expect((error as VideoInspectionValidationError).diagnostic).toEqual({ reason: 'outside-window', matchIndex: 0, start: 170, end: 175.7, windowStart: 0, windowEnd: 175.690956, duration: 175.690956 });
    expect(JSON.stringify(error)).not.toContain('Private');
  }
  expect(parseVideoInspection(JSON.stringify({ ...evidence, matches: [{ ...evidence.matches[0], end: input.end }] }), input, input.end).matches[0].end).toBe(input.end);
});

test('unreadable JSON and mismatched response shapes have distinct safe diagnostics', () => {
  for (const [text, reason] of [['not JSON', 'invalid-json'], [JSON.stringify({ ...evidence, extra: 'untrusted' }), 'invalid-shape']]) {
    expect(() => parseVideoInspection(text, input, input.end)).toThrow(expect.objectContaining({ diagnostic: { reason } }));
  }
});
