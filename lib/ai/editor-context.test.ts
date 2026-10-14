import type { LanguageModelV4Prompt, LanguageModelV4ToolResultPart } from '@ai-sdk/provider';
import { expect, test } from 'vitest';
import { compactEditorPrompt, EDITOR_CONTEXT_BOUNDARY, modelAssetAnalysis, modelTimeline } from './editor-context';
import type { Timeline } from '../editor/types';

const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: [{ id: 'source', kind: 'video', assetId: 'asset', track: 2, start: 1.69, sourceStart: 11.5, duration: 3, playbackRate: .75, linkedClipId: 'sound', transform: { x: .4, y: .5, scale: .7, opacity: .8, rotation: 5 }, motion: Array.from({ length: 1000 }, (_, i) => ({ time: i / 30, scale: 1, x: .5, y: .5, rotation: 0, opacity: 1, brightness: 1 })), focus: Array.from({ length: 1000 }, (_, i) => ({ time: i / 30, x: .5, y: .5 })) }] };
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

test('timeline projection retains exact IDs/source timing and every scalar control without mutating data', () => {
  const original = JSON.stringify(timeline);
  const compact = modelTimeline(timeline);
  expect(compact.clips[0]).toMatchObject({ id: 'source', assetId: 'asset', sourceStart: 11.5, playbackRate: .75, start: 1.69, duration: 3, linkedClipId: 'sound', transform: timeline.clips[0].transform, motionSummary: { sampleCount: 1000, detailsOmitted: true }, focusSummary: { sampleCount: 1000 } });
  expect(modelTimeline(timeline, ['source']).clips[0]).toMatchObject({ motion: timeline.clips[0].motion });
  expect(JSON.stringify(timeline)).toBe(original);
  expect(JSON.stringify(compact).length).toBeLessThan(original.length / 20);
});

test('one hundred historical messages preserve user constraints, native visual observations and image content', () => {
  const vision = { assetId: 'asset', start: 11.5, end: 14.5, question: 'Find the reaction', summary: 'Visible reaction', uncertainty: 'Approximate semantic window', matches: [{ start: 12, end: 13, description: 'A visible reaction' }] };
  const image = { type: 'file' as const, mediaType: 'image/png', data: { type: 'url' as const, url: new URL('https://fixture.invalid/frame.png') } };
  const prompt: LanguageModelV4Prompt = [{ role: 'system', content: 'Stable rules' + EDITOR_CONTEXT_BOUNDARY + 'Current selected source' }];
  for (let i = 0; i < 50; i++) {
    prompt.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: `timeline-${i}`, toolName: 'inspectTimeline', input: {} }] });
    prompt.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: `timeline-${i}`, toolName: 'inspectTimeline', output: { type: 'json', value: json({ timeline, revision: i, staged: false }) } }] });
  }
  prompt.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'vision', toolName: 'inspectVideo', output: { type: 'json', value: json(vision) } }, { type: 'tool-result', toolCallId: 'frames', toolName: 'inspectFrames', output: { type: 'content', value: [{ type: 'text', text: 'Source asset at 12 seconds: visible reaction' }, image] } }] });
  prompt.push({ role: 'user', content: [{ type: 'text', text: 'Keep the original sound and the source trim. Continue here.' }] });
  const compact = compactEditorPrompt(prompt);
  const results: LanguageModelV4ToolResultPart[] = [];
  for (const message of compact) if (message.role !== 'system') for (const part of message.content) if (part.type === 'tool-result') results.push(part);
  expect(results.find(part => part.toolCallId === 'vision')?.output).toEqual({ type: 'json', value: vision });
  expect(results.find(part => part.toolCallId === 'frames')?.output).toEqual({ type: 'content', value: [{ type: 'text', text: 'Source asset at 12 seconds: visible reaction' }, image] });
  expect(compact.at(-1)).toEqual(prompt.at(-1));
  expect(results.filter(part => part.toolName === 'inspectTimeline')).toHaveLength(50);
  expect(results.at(-3)?.output).toMatchObject({ value: { timeline: { clips: [{ sourceStart: 11.5, duration: 3, playbackRate: .75 }] } } });
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(prompt).length / 30);
  expect(compact[0]).toMatchObject({ providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } } } });
});

test('old private reasoning is omitted but this run signed reasoning and all errors/receipts remain', () => {
  const prompt: LanguageModelV4Prompt = [
    { role: 'assistant', content: [{ type: 'reasoning', text: 'Earlier private reasoning', providerOptions: { anthropic: { signature: 'old' } } }, { type: 'text', text: 'Earlier user-facing answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'Preserve colors' }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'Current thought', providerOptions: { anthropic: { signature: 'current' } } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'error', toolName: 'inspectTimeline', output: { type: 'error-text', value: 'Read failed' } }] },
  ];
  const compact = compactEditorPrompt(prompt);
  expect(compact[0]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Earlier user-facing answer' }] });
  expect(compact.slice(1)).toEqual(prompt.slice(1));
});

test('beat/focus summaries retain saved visual observations and exact range reads return measured samples', () => {
  const understanding = { summary: 'A real overview', scenes: [{ start: 10, end: 14, description: 'Visible reaction', score: .9 }] };
  const analysis = { understanding, focus: [{ time: 1, x: .2, y: .3 }, { time: 12, x: .4, y: .5 }], beats: { beats: [1, 12, 20], downbeats: [12], accents: [{ time: 12, strength: .9 }], bpm: 120, confidence: .9 } };
  const summary = modelAssetAnalysis(analysis);
  expect(summary.understanding).toEqual(understanding);
  expect(summary.beats).toMatchObject({ bpm: 120, beatSamples: { sampleCount: 3, detailsOmitted: true } });
  const range = modelAssetAnalysis(analysis, { start: 11.5, end: 14.5 });
  expect(range).toMatchObject({ focus: [analysis.focus[1]] }); expect(range.beats).toMatchObject({ beats: [12], accents: analysis.beats.accents });
  expect(range.understanding).toEqual(understanding);
});

test('historical visual observations survive stale timeline mapping compaction and current mappings retain exact times', () => {
  const evidence = { assetId: 'source-asset', start: 11.5, end: 14.5, question: 'Find the reaction', summary: 'Real visible reaction', uncertainty: 'Approximate', matches: [{ start: 12, end: 13, description: 'The visible reaction' }], timelineOccurrences: [{ clipId: 'source', sourceStart: 11.5, timelineStart: 1.69, duration: 3, playbackRate: .75, matches: [{ sourceStart: 12, sourceEnd: 13, timelineStart: 2.356666, timelineEnd: 3.69, description: 'The visible reaction' }] }] };
  const result: LanguageModelV4ToolResultPart = { type: 'tool-result', toolCallId: 'vision', toolName: 'inspectVideo', output: { type: 'json', value: evidence } };
  const read: LanguageModelV4Prompt[number] = { role: 'tool', content: [result] };
  const user: LanguageModelV4Prompt[number] = { role: 'user', content: [{ type: 'text', text: 'Continue here; preserve original sound' }] };
  const historical = compactEditorPrompt([read, user], [], 50);
  const { timelineOccurrences: _oldMappings, ...observations } = evidence;
  expect(historical[0]).toMatchObject({ content: [{ output: { value: { ...observations, timelineMappingOmitted: expect.any(String) } } }] });
  const current = compactEditorPrompt([user, read], [], 50);
  expect(current[1]).toMatchObject({ content: [{ output: { value: { assetId: evidence.assetId, start: evidence.start, end: evidence.end, matches: evidence.matches, summary: evidence.summary, uncertainty: evidence.uncertainty, timelineOccurrences: [{ clipId: 'source', matches: [{ sourceStart: 12, sourceEnd: 13, timelineStart: 2.356666, timelineEnd: 3.69, observationIndex: 0 }] }] } } }] });
  expect(evidence.timelineOccurrences[0].matches[0].description).toBe('The visible reaction');
});
