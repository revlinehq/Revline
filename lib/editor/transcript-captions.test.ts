import { expect, test } from 'vitest';
import { captionClipsFromTranscript } from './transcript-captions';
import { validateRemotionTextTemplate } from './remotion-text';
import type { Clip } from './types';
const clip: Clip = { id: 'video', kind: 'video', assetId: 'source', start: 5, sourceStart: 10, duration: 10 };
const ids = () => { let id = 0; return () => `caption-${id++}`; };

test('retained words replace overlapping segment text and exclude partially cut words', () => {
  const transcript = { segments: [{ start: 9, end: 12, text: 'Removed half Keep this. Removed' }], words: [{ start: 9, end: 9.5, text: 'Removed' }, { start: 9.8, end: 10.1, text: 'half' }, { start: 10.2, end: 10.5, text: 'Keep' }, { start: 10.5, end: 11, text: 'this.' }, { start: 11.8, end: 12, text: 'Removed' }] };
  const before = structuredClone(transcript), result = captionClipsFromTranscript({ ...clip, duration: 1.5 }, transcript, 30, ids());
  expect(result.map(caption => caption.text)).toEqual(['Keep this.']);
  expect(result[0].start).toBeCloseTo(5.2, 10); expect(result[0].duration).toBeCloseTo(.8, 10);
  expect(() => validateRemotionTextTemplate(result[0])).not.toThrow();
  expect(transcript).toEqual(before);
});

test('phrases break at six words, sentence punctuation and audible gaps', () => {
  const words = Array.from({ length: 9 }, (_, index) => ({ start: 10 + index * .2, end: 10.1 + index * .2, text: index === 7 ? 'end.' : `word${index}` }));
  words.push({ start: 13, end: 13.2, text: 'Later.' });
  const result = captionClipsFromTranscript(clip, { words, segments: [] }, 30, ids());
  expect(result.map(caption => caption.text?.split(/\s+/).length)).toEqual([6, 2, 1, 1]);
  expect(result.map(caption => caption.text)).toEqual(['word0 word1 word2 word3 word4 word5', 'word6 end.', 'word8', 'Later.']);
  result.forEach(caption => expect(() => validateRemotionTextTemplate(caption)).not.toThrow());
});

test('instantaneous final words get one display frame within the retained clip and keep zero measured duration', () => {
  const result = captionClipsFromTranscript({ ...clip, duration: .1 }, { segments: [], words: [{ start: 10.095, end: 10.095, text: 'Yes.' }] }, 30, ids());
  expect(result).toHaveLength(1); expect(result[0].duration).toBeCloseTo(1 / 30, 10);
  expect(result[0].start + result[0].duration).toBeCloseTo(5.1, 10);
  expect(result[0].textTemplate!.wordTimings![0].start).toBeCloseTo(result[0].textTemplate!.wordTimings![0].end, 10);
  expect(() => validateRemotionTextTemplate(result[0])).not.toThrow();
});

test('an instantaneous word on a split belongs only to the following retained piece', () => {
  const transcript = { segments: [], words: [{ start: 11, end: 11, text: 'Yes.' }] };
  expect(captionClipsFromTranscript({ ...clip, duration: 1 }, transcript, 30, ids())).toEqual([]);
  expect(captionClipsFromTranscript({ ...clip, start: 6, sourceStart: 11, duration: 1 }, transcript, 30, ids())).toHaveLength(1);
});

test('segments without word evidence are captioned only when their complete text is retained', () => {
  const result = captionClipsFromTranscript({ ...clip, duration: 2 }, { words: [], segments: [{ start: 9, end: 11, text: 'Partially removed' }, { start: 11, end: 11.8, text: 'Fully retained' }] }, 30, ids());
  expect(result.map(caption => caption.text)).toEqual(['Fully retained']);
  expect(result[0].textTemplate).toBeUndefined();
});
