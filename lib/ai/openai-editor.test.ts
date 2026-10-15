import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText, stepCountIs, tool, wrapLanguageModel } from 'ai';
import { z } from 'zod';
import { expect, test } from 'vitest';
import { OPENAI_EDIT_MODELS, editorProviderOptions, resolveClaudeModel, validatePinnedClaudeModel } from './claude-model';
import { AssistantTokenBudget, EDITOR_TOKEN_LIMITS } from './token-budget';
import { openAIEditorImages } from './openai-editor-images';

const usage = { input_tokens: 100, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 20 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 130 };
const text = { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'Saved fixture edit.', annotations: [] }] };
const reasoning = { type: 'reasoning', id: 'rs_fixture', encrypted_content: 'fixture-encrypted-reasoning', summary: [] };

test.each(OPENAI_EDIT_MODELS)('$label executes the real Responses tool loop with bounded options, encrypted reasoning and complete usage', async selected => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const provider = createOpenAI({ apiKey: 'fixture-only', fetch: async (url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push({ url: String(url), body });
    const output = requests.length === 1 ? [reasoning, { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'edit', arguments: '{"value":7}' }] : [text];
    return new Response(JSON.stringify({ id: `resp_${requests.length}`, created_at: 0, model: selected.modelId, service_tier: 'default', status: 'completed', output, usage }), { headers: { 'content-type': 'application/json' } });
  } });
  const budget = new AssistantTokenBudget();
  let saved = 0;
  const result = await generateText({
    model: wrapLanguageModel({ model: provider.responses(selected.modelId), middleware: [openAIEditorImages, budget.middleware()] }),
    prompt: 'Synthetic local editing fixture', providerOptions: editorProviderOptions({ provider: 'openai', modelId: selected.modelId }),
    tools: { edit: tool({ inputSchema: z.object({ value: z.number() }), execute: async ({ value }) => { saved = value; return { success: true }; } }) },
    stopWhen: stepCountIs(3), maxRetries: 0,
  });
  expect(result.text).toBe('Saved fixture edit.'); expect(saved).toBe(7); expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.body).toMatchObject({ model: selected.modelId, reasoning: { effort: 'medium', mode: 'standard' }, store: false, service_tier: 'default', max_output_tokens: 4096, prompt_cache_options: { ttl: '30m' } });
    for (const absent of ['temperature', 'top_p', 'top_logprobs', 'prompt_cache_retention', 'cache_control', 'previous_response_id']) expect(request.body).not.toHaveProperty(absent);
  }
  const continuation = requests[1].body.input as unknown[];
  expect(continuation).toContainEqual(expect.objectContaining({ type: 'reasoning', encrypted_content: reasoning.encrypted_content }));
  expect(continuation).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'call_fixture' }));
  expect(result.usage.inputTokenDetails).toMatchObject({ noCacheTokens: 80, cacheReadTokens: 80, cacheWriteTokens: 40 });
  expect(result.usage.outputTokenDetails).toMatchObject({ textTokens: 20, reasoningTokens: 40 });
  expect(budget.usage).toEqual({ inputTokens: 200, outputTokens: 60 });
});

test('OpenAI streaming includes reasoning in the shared budget and stops before a third network request', async () => {
  let calls = 0;
  const provider = createOpenAI({ apiKey: 'fixture-only', fetch: async () => {
    calls++;
    const events = [
      { type: 'response.created', response: { id: 'resp_stream', created_at: 0, model: 'gpt-6.1-sol' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...text, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: text.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: text.id, output_index: 0, content_index: 0, delta: 'Saved fixture edit.' },
      { type: 'response.output_item.done', output_index: 0, item: { ...text, status: 'completed' } },
      { type: 'response.completed', response: { id: 'resp_stream', status: 'completed', service_tier: 'default', usage } },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const budget = new AssistantTokenBudget({ ...EDITOR_TOKEN_LIMITS, outputPerCall: 100, outputTokens: 140 });
  const model = wrapLanguageModel({ model: provider.responses('gpt-6.1-sol'), middleware: budget.middleware() });
  async function invoke() {
    let error: unknown;
    const result = streamText({ model, prompt: 'Fixture', maxRetries: 0, providerOptions: editorProviderOptions({ provider: 'openai', modelId: 'gpt-6.1-sol' }), onError: event => { error = event.error; } });
    await result.consumeStream(); if (error) throw error;
    return await result.text;
  }
  expect(await invoke()).toBe('Saved fixture edit.'); expect(await invoke()).toBe('Saved fixture edit.');
  expect(budget.usage).toEqual({ inputTokens: 200, outputTokens: 60 });
  await expect(invoke()).rejects.toThrow('token budget'); expect(calls).toBe(2);
});

test('OpenAI visual evidence serializes at bounded high detail without losing source text or bytes', async () => {
  let body: Record<string, unknown> | undefined;
  const provider = createOpenAI({ apiKey: 'fixture-only', fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'resp_image', output: [text], usage }), { headers: { 'content-type': 'application/json' } });
  } });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await generateText({ model: wrapLanguageModel({ model: provider.responses('gpt-6-astra'), middleware: [openAIEditorImages, new AssistantTokenBudget().middleware()] }), messages: [{ role: 'user', content: [{ type: 'text', text: 'Source frame at 11.5 seconds' }, { type: 'file', mediaType: 'image/png', data: { type: 'data', data: image } }] }], maxRetries: 0 });
  const serialized = JSON.stringify(body);
  expect(serialized).toContain('11.5 seconds'); expect(serialized).toContain(image.toString('base64')); expect(serialized).toContain('"detail":"high"');
});

test('OpenAI selection rejects absent keys and mismatched pins while keeping Sonnet as the default', () => {
  const env = { OPENAI_API_KEY: 'fixture-only', MODEL_SWITCHER_ENABLED: 'true', AI_GATEWAY_ENABLED: 'true' };
  for (const model of OPENAI_EDIT_MODELS) {
    const selection = resolveClaudeModel(model.id, env);
    expect(selection).toEqual({ provider: 'openai', modelId: model.modelId, modelChoice: model.id });
    expect(validatePinnedClaudeModel(selection, { OPENAI_API_KEY: 'fixture-only' })).toEqual(selection);
    expect(() => validatePinnedClaudeModel({ ...selection, provider: 'gateway' }, env)).toThrow('provider');
    expect(() => resolveClaudeModel(model.id, { MODEL_SWITCHER_ENABLED: 'true' })).toThrow('OPENAI_API_KEY');
  }
  expect(resolveClaudeModel(undefined, { OPENAI_API_KEY: 'fixture-only' })).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-5-5' });
  expect(OPENAI_EDIT_MODELS.map(model => model.pricing)).toEqual([{ input: 2, cacheRead: .1, cacheWrite: 2.5, output: 10 }, { input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 }]);
});
