import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4CallOptions, LanguageModelV4Usage } from '@ai-sdk/provider';
import { generateText, streamText, wrapLanguageModel, type ModelMessage } from 'ai';
import { expect, test } from 'vitest';
import { claudeProviderOptions, CLAUDE_MODEL } from './claude-model';
import { AssistantTokenBudget, EDITOR_TOKEN_LIMITS } from './token-budget';
import { EDITOR_CONTEXT_BOUNDARY } from './editor-context';

function fixture(input = 10, output = 10) {
  const requests: Record<string, unknown>[] = [];
  const provider = createAnthropic({ apiKey: 'fixture-only', fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    const usage = { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (request.stream) {
      const events = [
        ['message_start', { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: CLAUDE_MODEL, content: [], usage } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixture response' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage }],
        ['message_stop', { type: 'message_stop' }],
      ].map(([name, event]) => `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`).join('');
      return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: CLAUDE_MODEL, content: [{ type: 'text', text: 'Fixture response' }], stop_reason: 'end_turn', stop_sequence: null, usage }), { headers: { 'content-type': 'application/json' } });
  } });
  return { requests, provider };
}
const usage = (input: number | undefined, output: number | undefined): LanguageModelV4Usage => ({ inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: output, text: output, reasoning: 0 } });
const params: LanguageModelV4CallOptions = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'Fixture' }] }], maxOutputTokens: 100 };

test('actual serialized SDK requests cache the stable system prefix and compact repeated snapshots', async () => {
  const f = fixture(); const budget = new AssistantTokenBudget();
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  const timeline = { fps: 30, aspectRatio: 'landscape', clips: [{ id: 'source', kind: 'video', sourceStart: 11.5, start: 1.69, duration: 3, playbackRate: .75, motion: Array.from({ length: 2000 }, (_, i) => ({ time: i, scale: 1 })) }] };
  const messages: ModelMessage[] = [];
  for (let i = 0; i < 3; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: `read${i}`, toolName: 'inspectTimeline', input: {} }] });
    messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: `read${i}`, toolName: 'inspectTimeline', output: { type: 'json', value: { timeline, revision: i } } }] });
    await generateText({ model, system: 'Stable tools and rules' + EDITOR_CONTEXT_BOUNDARY + 'Selected source', messages, providerOptions: claudeProviderOptions(CLAUDE_MODEL) });
  }
  const body = f.requests.at(-1)!;
  expect(body.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  expect(body.system).toMatchObject([{ text: 'Stable tools and rules', cache_control: { type: 'ephemeral', ttl: '5m' } }, { text: EDITOR_CONTEXT_BOUNDARY + 'Selected source' }]);
  const serialized = JSON.stringify(body);
  expect(serialized).toContain('motionSummary'); expect(serialized).toContain('11.5'); expect(serialized).toContain('0.75');
  expect(serialized).not.toContain('1999'); expect(serialized.length).toBeLessThan(4000);
  expect(body.max_tokens).toBe(EDITOR_TOKEN_LIMITS.outputPerCall);
  for (let i = 1; i < f.requests.length; i++) {
    const previous = f.requests[i - 1].messages as unknown[];
    expect((f.requests[i].messages as unknown[]).slice(0, previous.length)).toEqual(previous);
    expect(f.requests[i].system).toEqual(f.requests[i - 1].system);
  }
});

test.each(['generate', 'stream'])('cumulative usage stops the next %s request before paid network work', async method => {
  const f = fixture(50, 20); const budget = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, inputTokens: 7000, outputTokens: 120, outputPerCall: 100 });
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  const invoke = async () => {
    if (method === 'generate') await generateText({ model, prompt: 'Fixture', maxOutputTokens: 100, maxRetries: 0 });
    else { let error: unknown; const result = streamText({ model, prompt: 'Fixture', maxOutputTokens: 100, maxRetries: 0, onError: event => { error = event.error; } }); await result.consumeStream(); try { return await result.text; } catch (wrapped) { throw error ?? wrapped; } }
  };
  await invoke(); await invoke();
  expect(budget.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
  await expect(invoke()).rejects.toThrow('token budget');
  expect(f.requests).toHaveLength(2);
});

test('oversized essential observations stop before the first serialized provider request', async () => {
  const f = fixture(); const budget = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, requestBytes: 500 });
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  await expect(generateText({ model, prompt: 'Preserve visual evidence '.repeat(100), maxRetries: 0 })).rejects.toThrow('context is too large');
  expect(f.requests).toHaveLength(0);
});

test('three before/peak/after images survive actual serialization and are reserved as images, not base64 text', async () => {
  const f = fixture(); const budget = new AssistantTokenBudget();
  const model = wrapLanguageModel({ model: f.provider(CLAUDE_MODEL), middleware: budget.middleware() });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await generateText({ model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect source asset at 11.5, 12 and 12.5 seconds. Preserve this trim.' }, ...[1, 2, 3].map(() => ({ type: 'file' as const, data: { type: 'data' as const, data: image }, mediaType: 'image/png' }))] }], maxRetries: 0 });
  const body = f.requests[0];
  expect(JSON.stringify(body)).toContain('11.5');
  const content = (body.messages as { content: { type: string }[] }[])[0].content;
  expect(content.filter(part => part.type === 'image')).toHaveLength(3);
});

test('preflight reservation survives missing usage, failed calls, and concurrent reservations', () => {
  const budget = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, inputTokens: 5000, outputTokens: 300, outputPerCall: 100 });
  const settle = budget.reserve(params);
  expect(() => budget.reserve(params)).toThrow('token budget');
  settle(usage(undefined, 1));
  expect(() => budget.reserve(params)).toThrow('reliable token usage');
  const other = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, inputTokens: 5000 });
  other.reserve(params); // Simulate a provider failure without a finish/usage.
  expect(() => other.reserve(params)).toThrow('token budget');
});
