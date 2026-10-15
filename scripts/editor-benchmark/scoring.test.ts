import { expect, test } from 'vitest';
import { CostLedger, initialTimeline, scoreTimeline, summarizeUsage, type StoredMessage } from './scoring';

const source = initialTimeline('precise-cuts', 'source-asset', 6);
const cutTimeline = { ...source, clips: [
  { ...source.clips[0], id: 'a', start: 0, duration: 1.5, sourceStart: 1 },
  { ...source.clips[0], id: 'b', start: 1.5, duration: 1.25, sourceStart: 4 },
] };
test('precise cuts distinguish source trim errors from correct duration and timeline placement', () => {
  expect(scoreTimeline('precise-cuts', cutTimeline, source).every(check => check.passed)).toBe(true);
  const wrongSource = { ...cutTimeline, clips: cutTimeline.clips.map(clip => ({ ...clip, sourceStart: 0 })) };
  expect(scoreTimeline('precise-cuts', wrongSource, source).find(check => check.name === 'exact source and timeline ranges')?.passed).toBe(false);
  expect(scoreTimeline('precise-cuts', wrongSource, source).find(check => check.name === 'exact final duration')?.passed).toBe(true);
});
test('cut scoring rejects decorative effects and a misplaced extra audio clip', () => {
  const effects = { ...cutTimeline, clips: cutTimeline.clips.map(clip => ({ ...clip, softBlur: { enabled: true, amount: 1 } })) };
  expect(scoreTimeline('precise-cuts', effects, source).find(check => check.name === 'hard cuts without extra clips or effects')?.passed).toBe(false);
  const transformed = { ...cutTimeline, clips: cutTimeline.clips.map(clip => ({ ...clip, transform: { x: 0.5, y: 0.5, scale: 2, rotation: 0, opacity: 1 } })) };
  expect(scoreTimeline('precise-cuts', transformed, source).find(check => check.name === 'hard cuts without extra clips or effects')?.passed).toBe(false);
  const extra = { ...cutTimeline, clips: [...cutTimeline.clips, { ...source.clips[0], id: 'audio', kind: 'audio' as const, start: 3 }] };
  expect(scoreTimeline('precise-cuts', extra, source).find(check => check.name === 'exact final duration')?.passed).toBe(false);
});
test('subtitle scoring checks words and alignment independently', () => {
  const initial = initialTimeline('subtitles', 'speech', 4);
  const transcript = { segments: [{ start: 0.5, end: 2, text: 'A small step.' }, { start: 2.5, end: 4.5, text: 'A giant leap.' }], words: [] };
  const timeline = { ...initial, clips: [...initial.clips, ...transcript.segments.map((segment, i) => ({ id: `caption-${i}`, kind: 'caption' as const, text: segment.text, start: segment.start, duration: Math.min(segment.end, 4) - segment.start, sourceStart: 0, x: 0.5, y: 0.85, fontSize: 48, color: '#FFFFFF' }))] };
  expect(scoreTimeline('subtitles', timeline, initial, transcript).every(check => check.passed)).toBe(true);
  timeline.clips[1].start += 0.3;
  expect(scoreTimeline('subtitles', timeline, initial, transcript).find(check => check.name === 'captions follow saved transcript timing')?.passed).toBe(false);
  expect(scoreTimeline('subtitles', timeline, initial, transcript).find(check => check.name === 'all transcript segments captioned exactly')?.passed).toBe(true);
});
const message = (overrides: Partial<StoredMessage> = {}): StoredMessage => ({ _id: 'call-1', model: 'gpt-6.1-sol', provider: 'openai.responses', message: { role: 'assistant' }, usage: { promptTokens: 10_000, completionTokens: 1000, cachedInputTokens: 6000, cacheWriteInputTokens: 1000, nonCachedInputTokens: 3000, reasoningTokens: 500 }, ...overrides });
test('cost includes cache writes, cached reads and reasoning as part of output exactly once', () => {
  const result = summarizeUsage([message()], 'gpt-6.1-sol');
  expect(result.usd).toBeCloseTo((3000 * 2 + 6000 * 0.1 + 1000 * 2.5 + 1000 * 10) / 1_000_000);
  expect(result.reasoningTokens).toBe(500);
});
test('cost applies native GPT long-context multipliers per call', () => {
  const result = summarizeUsage([message({ usage: { promptTokens: 280_000, completionTokens: 1000 } })], 'gpt-6.1-sol');
  expect(result.usd).toBeCloseTo((280_000 * 4 + 1000 * 15) / 1_000_000);
  expect(result.calls[0].longContext).toBe(true);
});
test('usage fails closed on missing or inconsistent counts and a different actual model', () => {
  expect(() => summarizeUsage([message({ usage: undefined })], 'gpt-6.1-sol')).toThrow(/usage/i);
  expect(() => summarizeUsage([message({ usage: { promptTokens: 1000, completionTokens: 20, cachedInputTokens: 1001 } })], 'gpt-6.1-sol')).toThrow(/reconcile/);
  expect(() => summarizeUsage([message({ model: 'gpt-6-astra' })], 'gpt-6.1-sol')).toThrow(/pinned/);
  expect(() => summarizeUsage([message(), message()], 'gpt-6.1-sol')).toThrow(/Duplicate/);
});
test('failed assistant rows without model, provider or usage report missing usage and cannot be skipped', () => {
  const failed: StoredMessage = { _id: 'failed-local-assistant', status: 'failed', message: { role: 'assistant' } };
  expect(() => summarizeUsage([failed], 'claude-sonnet-5-5')).toThrow('Missing provider usage. Further runs are blocked.');
  expect(() => summarizeUsage([message({ model: 'claude-sonnet-5-5' }), failed], 'claude-sonnet-5-5')).toThrow('Missing provider usage. Further runs are blocked.');
});
test('usage permits the pinned Sonnet gateway identity and ignores server publication receipts', () => {
  const result = summarizeUsage([message({ model: 'anthropic/claude-sonnet-5.5' }), { _id: 'receipt', message: { role: 'assistant' }, providerMetadata: { revline: { publicationReceipt: {} } } }], 'claude-sonnet-5-5');
  expect(result.calls).toHaveLength(1);
});
test('unattributed assistant calls and provider sub-inference fail closed', () => {
  expect(() => summarizeUsage([message({ model: undefined })], 'gpt-6.1-sol')).toThrow(/pinned/);
  expect(() => summarizeUsage([message({ model: 'claude-sonnet-5-5', providerMetadata: { anthropic: { iterations: [{ type: 'advisor_message', model: 'claude-opus-5-5' }] } } })], 'claude-sonnet-5-5')).toThrow(/sub-inference/);
  expect(() => new CostLedger(3, 0.87)).toThrow(/1.68/);
});
test('cost ledger reserves before send, refunds only measured usage and enforces total ceiling', () => {
  const ledger = new CostLedger(1.8, 1.68);
  ledger.reserve(); expect(() => ledger.reserve()).toThrow(); ledger.settle(0.1);
  ledger.reserve(); ledger.settle(0.2);
  expect(() => ledger.reserve()).toThrow(/ceiling/);
});
test('missing usage and overruns retain reservation and block subsequent sends', () => {
  const ledger = new CostLedger(3, 1.68); ledger.reserve(); ledger.failClosed();
  expect(ledger.reservedUsd).toBe(1.68); expect(() => ledger.reserve()).toThrow();
  const overrun = new CostLedger(3, 1.68); overrun.reserve(); expect(() => overrun.settle(1.69)).toThrow(); expect(overrun.blocked).toBe(true);
});
