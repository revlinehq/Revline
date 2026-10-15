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
function measuredUsage(provider: 'openai' | 'anthropic', input = 10_000, read = 6000, write = 1000) {
  const uncached = input - read - write, output = 1000, reasoning = 500;
  return { promptTokens: input, completionTokens: output, cachedInputTokens: read, cacheWriteInputTokens: write, nonCachedInputTokens: uncached, reasoningTokens: reasoning, textOutputTokens: output - reasoning, totalTokens: input + output, raw: provider === 'openai' ? { input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: { cached_tokens: read, cache_write_tokens: write }, output_tokens_details: { reasoning_tokens: reasoning } } : { input_tokens: uncached, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write, cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 }, output_tokens_details: { thinking_tokens: reasoning }, service_tier: 'standard', speed: 'standard', inference_geo: 'global' } };
}
const message = (overrides: Partial<StoredMessage> = {}): StoredMessage => ({ _id: 'call-1', model: 'gpt-6.1-sol', provider: 'openai.responses', message: { role: 'assistant' }, providerMetadata: { openai: { serviceTier: 'default' } }, usage: measuredUsage('openai'), ...overrides });
const sonnet = (overrides: Partial<StoredMessage> = {}): StoredMessage => message({ model: 'claude-sonnet-5-5', provider: 'anthropic.messages', providerMetadata: { anthropic: { iterations: null } }, usage: measuredUsage('anthropic'), ...overrides });
test('cost includes cache writes, cached reads and reasoning as part of output exactly once', () => {
  const result = summarizeUsage([message()], 'gpt-6.1-sol');
  expect(result.usd).toBeCloseTo((3000 * 2 + 6000 * 0.1 + 1000 * 2.5 + 1000 * 10) / 1_000_000);
  expect(result.reasoningTokens).toBe(500);
});
test('cost applies native GPT long-context multipliers per call', () => {
  const result = summarizeUsage([message({ usage: measuredUsage('openai', 280_000, 0, 0) })], 'gpt-6.1-sol');
  expect(result.usd).toBeCloseTo((280_000 * 4 + 1000 * 15) / 1_000_000);
  expect(result.calls[0].longContext).toBe(true);
});
test('usage fails closed on missing or inconsistent counts and a different actual model', () => {
  expect(() => summarizeUsage([message({ usage: undefined })], 'gpt-6.1-sol')).toThrow(/usage/i);
  expect(() => summarizeUsage([message({ usage: { ...measuredUsage('openai'), cachedInputTokens: 10_001 } })], 'gpt-6.1-sol')).toThrow(/reconcile/);
  expect(() => summarizeUsage([message({ model: 'gpt-6-astra' })], 'gpt-6.1-sol')).toThrow(/pinned/);
  expect(() => summarizeUsage([message(), message()], 'gpt-6.1-sol')).toThrow(/Duplicate/);
});
test('failed assistant rows without model, provider or usage report missing usage and cannot be skipped', () => {
  const failed: StoredMessage = { _id: 'failed-local-assistant', status: 'failed', message: { role: 'assistant' } };
  expect(() => summarizeUsage([failed], 'claude-sonnet-5-5')).toThrow('Missing provider usage. Further runs are blocked.');
  expect(() => summarizeUsage([sonnet(), failed], 'claude-sonnet-5-5')).toThrow('Missing provider usage. Further runs are blocked.');
});
test('native Sonnet usage ignores server publication receipts and rejects gateway attribution', () => {
  const result = summarizeUsage([sonnet(), { _id: 'receipt', message: { role: 'assistant' }, providerMetadata: { revline: { publicationReceipt: {} } } }], 'claude-sonnet-5-5');
  expect(result.calls).toHaveLength(1);
  expect(() => summarizeUsage([sonnet({ model: 'anthropic/claude-sonnet-5.5' })], 'claude-sonnet-5-5')).toThrow(/pinned/);
  expect(() => summarizeUsage([sonnet({ provider: 'gateway' })], 'claude-sonnet-5-5')).toThrow(/native benchmark tariff/);
});
test('unattributed assistant calls and provider sub-inference fail closed', () => {
  expect(() => summarizeUsage([message({ model: undefined })], 'gpt-6.1-sol')).toThrow(/pinned/);
  expect(() => summarizeUsage([sonnet({ providerMetadata: { anthropic: { iterations: [{ type: 'advisor_message', model: 'claude-opus-5-5' }] } } })], 'claude-sonnet-5-5')).toThrow(/sub-inference/);
  expect(() => new CostLedger(3, 0.87)).toThrow(/1.68/);
});
test.each(['cachedInputTokens', 'cacheWriteInputTokens', 'nonCachedInputTokens', 'reasoningTokens', 'textOutputTokens'])('missing %s is unknown, never zero', key => {
  const usage: Record<string, unknown> = measuredUsage('openai'); delete usage[key];
  expect(() => summarizeUsage([message({ usage })], 'gpt-6.1-sol')).toThrow(/usage/i);
});
test.each([
  ['cache_creation', { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1 }],
  ['cache_creation', { ephemeral_5m_input_tokens: 999, ephemeral_1h_input_tokens: 0 }],
  ['cache_read_input_tokens', 5999], ['cache_creation_input_tokens', 999], ['input_tokens', 2999],
  ['service_tier', 'priority'], ['speed', 'fast'], ['inference_geo', 'us'], ['iterations', [{ type: 'advisor_message' }]],
] as const)('Sonnet rejects unsupported or inconsistent raw %s', (key, value) => {
  const usage = measuredUsage('anthropic');
  expect(() => summarizeUsage([sonnet({ usage: { ...usage, raw: { ...usage.raw, [key]: value } } })], 'claude-sonnet-5-5')).toThrow(/native tariff usage|sub-inference/);
});
test.each(['cached_tokens', 'cache_write_tokens'])('Sol requires explicit raw %s', key => {
  const usage = measuredUsage('openai'); const details = { cached_tokens: 6000, cache_write_tokens: 1000 } as Record<string, unknown>; delete details[key];
  expect(() => summarizeUsage([message({ usage: { ...usage, raw: { ...usage.raw, input_tokens_details: details } } })], 'gpt-6.1-sol')).toThrow(/native tariff usage/);
});
test.each([
  { input_tokens: 9999 }, { total_tokens: 10999 },
  { input_tokens_details: { cached_tokens: 5999, cache_write_tokens: 1000 } },
  { input_tokens_details: { cached_tokens: 6000, cache_write_tokens: 1000, orchestration_input_tokens: 1 } },
  { input_tokens_details: { cached_tokens: 6000, cache_write_tokens: 1000, orchestration_input_cached_tokens: null } },
  { output_tokens_details: { reasoning_tokens: 500, orchestration_output_tokens: 1 } },
  { output_tokens_details: { reasoning_tokens: 499 } },
])('Sol rejects inconsistent raw totals and unknown orchestration %#', changes => {
  const usage = measuredUsage('openai');
  expect(() => summarizeUsage([message({ usage: { ...usage, raw: { ...usage.raw, ...changes } } })], 'gpt-6.1-sol')).toThrow(/native tariff usage/);
});
test.each([undefined, {}, { openai: { serviceTier: 'priority' } }])('Sol must report default service tier %#', providerMetadata => {
  expect(() => summarizeUsage([message({ providerMetadata })], 'gpt-6.1-sol')).toThrow(/native tariff usage/);
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
test('historical provider cost counts against the same ceiling before every new reservation', () => {
  const ledger = new CostLedger(3, 1.68, 0.1525915);
  expect(ledger.spentUsd).toBe(0.1525915); expect(ledger.currentRunSpentUsd).toBe(0);
  ledger.reserve(); ledger.settle(0.9);
  expect(ledger.spentUsd).toBeCloseTo(1.0525915); expect(ledger.currentRunSpentUsd).toBeCloseTo(0.9);
  ledger.reserve(); ledger.settle(0.3);
  expect(() => ledger.reserve()).toThrow(/ceiling/);
  expect(ledger.priorKnownCostUsd).toBe(0.1525915);
});
test.each([-1, NaN, Infinity, 3.01])('invalid historical cost %s cannot start a new controlled run', prior => {
  expect(() => new CostLedger(3, 1.68, prior)).toThrow(/Prior known model cost/);
});
test('historical spend can exhaust the next reservation without being reset', () => {
  const ledger = new CostLedger(3, 1.68, 1.321);
  expect(() => ledger.reserve()).toThrow(/ceiling/); expect(ledger.spentUsd).toBe(1.321);
});
