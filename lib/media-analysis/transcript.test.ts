import { expect, test } from 'vitest';
import { parseTranscript, timestampSeconds, transcriptFromWords } from './transcript';

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

test('preserves every word in a long transcript while compacting only its overview', () => {
  const words = Array.from({ length: 3200 }, (_, i) => ({ text: `word${i}.`, start: i / 3, end: (i + .8) / 3 }));
  const transcript = transcriptFromWords(words, 1120);
  expect(transcript.words).toEqual(words);
  expect(transcript.segments.length).toBeLessThanOrEqual(500);
  expect(transcript.segments.map(segment => segment.text).join(' ')).toBe(words.map(word => word.text).join(' '));
  expect(transcript.segments.at(-1)?.end).toBe(words.at(-1)?.end);
});

test('preserves zero-length words without inventing their duration or empty caption ranges', () => {
  const words = [{ text: 'A.', start: .1, end: .1 }, { text: 'word.', start: .1, end: .5 }, { text: 'indeed.', start: .5, end: .5 }];
  const transcript = transcriptFromWords(words, 1);
  expect(transcript.words).toEqual(words);
  expect(transcript.segments).toEqual([{ text: 'A. word. indeed.', start: .1, end: .5 }]);
  expect(transcriptFromWords([{ text: 'Instant.', start: .1, end: .1 }], 1)).toEqual({ words: [{ text: 'Instant.', start: .1, end: .1 }], segments: [] });
});

test('allows slight audio padding but rejects materially out-of-bounds or reversed measurements', () => {
  expect(transcriptFromWords([{ text: 'Final.', start: .5, end: 1.05 }], 1).words[0].end).toBe(1);
  for (const word of [{ text: 'bad', start: .5, end: 10 }, { text: 'bad', start: .6, end: .5 }, { text: '', start: .1, end: .2 }]) expect(() => transcriptFromWords([word], 1)).toThrow('invalid word');
});
