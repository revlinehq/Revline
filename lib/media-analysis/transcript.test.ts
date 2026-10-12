import { expect, test } from 'vitest';
import { parseTranscript, timestampSeconds } from './transcript';

test('parses documented Gemini word_info annotations and groups real times', () => {
  const raw = { output_text: 'Hello world. Another scene.', steps: [{ content: [{ annotations: [
    { type: 'word_info', text: 'Hello', start_offset: '0.100s', end_offset: '0.450s' },
    { type: 'word_info', text: 'world.', start_offset: '0.500s', end_offset: '0.950s' },
    { type: 'word_info', text: 'Another', start_offset: '2.000s', end_offset: '2.350s' },
    { type: 'word_info', text: 'scene.', start_offset: '2.400s', end_offset: '2.900s' },
  ] }] }] };
  expect(parseTranscript(raw, 3).segments).toEqual([{ start: 0.1, end: 0.95, text: 'Hello world.' }, { start: 2, end: 2.9, text: 'Another scene.' }]);
});
test('accepts silence and refuses fabricated timestamps for plain provider text', () => {
  expect(parseTranscript({ output_text: '', steps: [] }, 3)).toEqual({ words: [], segments: [] });
  expect(() => parseTranscript({ output_text: 'Hello', steps: [] }, 3)).toThrow('without word timestamps');
  expect(() => parseTranscript({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello' }] }] }, 3)).toThrow('without word timestamps');
});
test('rejects timestamps outside source bounds', () => {
  expect(() => parseTranscript({ steps: [{ content: [{ annotations: [{ type: 'word_info', text: 'Hello', start_offset: '0s', end_offset: '30s' }] }] }] }, 3)).toThrow('invalid word timestamps');
  expect(timestampSeconds('01:02.500')).toBe(62.5);
});
