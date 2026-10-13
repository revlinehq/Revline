import { expect, test } from 'vitest';
import { chatMessageKey, chatToolFromPart, summarizeTools, type ChatTool } from './assistant-results';

test('stream and persisted SDK records retain the same React identity', () => {
  expect(chatMessageKey({ id: 'stream-123', key: 'thread-1-0' })).toBe(chatMessageKey({ id: 'stored-456', key: 'thread-1-0' }));
});
test.each([
  { state: 'output-error', errorText: 'Failed to save' },
  { state: 'output-available', output: { type: 'error-text', value: 'Shot detection failed' } },
  { state: 'output-available', output: { type: 'error-json', value: { message: 'Failed' } } },
  { state: 'output-available', output: 'Shot detection did not inspect the complete video.' },
  { state: 'output-available', output: { error: 'Cannot complete' } },
  { state: 'output-denied' },
])('tool failure is never presented as done: %o', part => {
  expect(chatToolFromPart({ type: 'tool-analyzeMedia', toolCallId: 'call', ...part })?.state).toBe('error');
});
test('successful inspection is quiet but failure stays visible', () => {
  const successful = chatToolFromPart({ type: 'tool-inspectTimeline', state: 'output-available', output: { revision: 2, timeline: { clips: [] } } })!;
  expect(summarizeTools([successful])).toEqual([]);
  expect(summarizeTools([{ ...successful, state: 'error', detail: 'Unavailable' }])[0]).toMatchObject({ state: 'error', detail: 'Unavailable' });
});
test('result cards use saved evidence, deduplicate tool calls and keep staged edits separate', () => {
  const beat: ChatTool = { id: 'beat', name: 'markMusicBeats', state: 'done', output: { added: 23, saved: true } };
  const steps: ChatTool[] = [beat, beat, { name: 'delete', state: 'done', staged: true, output: { removedClipIds: ['v1', 'a1'], saved: false } }, { name: 'addSubtitlesFromTranscript', state: 'done', output: { changedClips: [{ id: 'c1', kind: 'caption' }, { id: 'c2', kind: 'caption' }], saved: true } }];
  expect(summarizeTools(steps).map(card => card.title)).toEqual(['Marked 23 beats', 'Prepared: Removed 2 clips', 'Added 2 subtitles']);
  expect(summarizeTools(steps)[1].detail).toBe('Awaiting save');
});
test('low confidence or unchanged outputs do not claim edits happened', () => {
  expect(summarizeTools([{ name: 'markMusicBeats', state: 'done', output: { added: 0, status: 'low-confidence', unchanged: true } }])[0]).toMatchObject({ title: 'No new beat markers', detail: 'Beat detection has low confidence' });
  expect(summarizeTools([{ name: 'trim', state: 'done', output: { unchanged: true } }])[0].title).toBe('No changes needed');
});
test('only explicit save evidence permits a completed change card', () => {
  for (const output of [{ changedClips: [{ id: 'v1' }] }, { saved: false, changedClips: [{ id: 'v1' }] }]) {
    expect(summarizeTools([{ name: 'trim', state: 'done', output }])[0]).toMatchObject({ title: 'Save not confirmed', state: 'error' });
  }
  const staged = chatToolFromPart({ type: 'tool-delete', state: 'output-available', output: { staged: true, saved: false, removedClipIds: ['v1'] } })!;
  expect(summarizeTools([staged])[0]).toMatchObject({ title: 'Prepared: Removed 1 clip', detail: 'Awaiting save', staged: true });
});
test('missing counters are not reported as zero and only actual caption IDs count', () => {
  expect(summarizeTools([{ name: 'markMusicBeats', state: 'done', output: { saved: true } }])[0].title).toBe('Marked beats');
  expect(summarizeTools([{ name: 'delete', state: 'done', output: { saved: true } }])[0].title).toBe('Removed clips');
  expect(summarizeTools([{ name: 'addSubtitlesFromTranscript', state: 'done', output: { saved: true, changedClips: [{ kind: 'caption' }, { id: '', kind: 'caption' }, { id: 'c1', kind: 'caption' }, { id: 'c1', kind: 'caption' }, { id: 'v1', kind: 'video' }] } }])[0].title).toBe('Added 1 subtitle');
});
test('each failed tool remains visible and structured error messages are retained', () => {
  const first = chatToolFromPart({ type: 'tool-analyzeMedia', toolCallId: 'first', state: 'output-available', output: { type: 'error-json', value: { message: 'Transcription failed' } } })!;
  const second = chatToolFromPart({ type: 'tool-analyzeMedia', toolCallId: 'second', state: 'output-error', errorText: 'Shot detection failed' })!;
  expect(summarizeTools([first, second]).map(card => card.detail)).toEqual(['Transcription failed', 'Shot detection failed']);
});
