import { expect, test } from 'vitest';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, tool, type LanguageModelUsage } from 'ai';
import { z } from 'zod';
import { AssistantCostLog, estimateEditorCallCost } from './cost-log';

const usage = (input = 1000, read = 600, write = 300, output = 200): LanguageModelUsage => ({ inputTokens: input, inputTokenDetails: { noCacheTokens: input - read - write, cacheReadTokens: read, cacheWriteTokens: write }, outputTokens: output, outputTokenDetails: { textTokens: output - 150, reasoningTokens: 150 }, totalTokens: input + output });
const metadata = { openai: { serviceTier: 'default' } };
test('cost events include the pinned reasoning effort without changing usage accounting', () => {
  const events: Record<string, unknown>[] = [], log = new AssistantCostLog({ projectId: 'project', runId: 'run' }, event => events.push(event));
  log.selectModel('gpt-6.1-sol', 'openai', 'high', 'standard');
  log.modelCall({ callId: 'one', stepNumber: 0, modelId: 'gpt-6.1-sol', provider: 'openai.responses', usage: usage(), providerMetadata: metadata, content: [] }, { revision: 1, savedEdits: 0, staged: false });
  log.finish('completed');
  expect(events).toHaveLength(2);
  expect(events.every(event => event.reasoningEffort === 'high' && event.speedMode === 'standard')).toBe(true);
  expect(events.at(-1)).toMatchObject({ runEstimatedUsd: .00301 });
});
test.each(['gpt-6.1-sol', 'gpt-6-astra'])('%s uses the returned speed tier for costs, including a downgrade to Standard', model => {
  const standard = estimateEditorCallCost(model, 'openai.responses', usage(), metadata);
  const fast = estimateEditorCallCost(model, 'openai.responses', usage(), { openai: { serviceTier: 'fast' } });
  expect(fast.estimatedUsd).toBeCloseTo(standard.estimatedUsd! * 2, 12);
  expect(fast.serviceTier).toBe('fast');
  expect(estimateEditorCallCost(model, 'openai.responses', usage(), { openai: { serviceTier: 'ultrafast' } }).estimatedUsd).toBeNull();
});
test('Sol and Astra price cache reads/writes separately and include reasoning only once', () => {
  expect(estimateEditorCallCost('gpt-6.1-sol', 'openai.responses', usage(), metadata).estimatedUsd).toBe(.00301);
  expect(estimateEditorCallCost('gpt-6-astra', 'openai.responses', usage(), metadata).estimatedUsd).toBe(.01535);
  const long = estimateEditorCallCost('gpt-6.1-sol', 'openai.responses', usage(300_000, 200_000, 90_000), metadata);
  expect(long.longContext).toBe(true); expect(long.estimatedUsd).toBe(.533);
});
test('missing, inconsistent or unsupported usage remains unknown rather than zero', () => {
  for (const result of [estimateEditorCallCost('gpt-6.1-sol', 'openai.responses'), estimateEditorCallCost('gpt-6.1-sol', 'openai.responses', usage()), estimateEditorCallCost('unknown', 'gateway', usage(), metadata), estimateEditorCallCost('gpt-6.1-sol', 'openai.responses', { ...usage(), inputTokens: 1 }, metadata)]) expect(result.estimatedUsd).toBeNull();
});
test('duplicate callbacks do not double count; unknown calls preserve a known subtotal and unknown total', () => {
  const events: Record<string, unknown>[] = [], log = new AssistantCostLog({ projectId: 'project', runId: 'run' }, event => events.push(event), () => '2026-10-17T20:00:00.000Z');
  const event = { callId: 'call', stepNumber: 0, modelId: 'gpt-6.1-sol', provider: 'openai.responses', usage: usage(), providerMetadata: metadata, content: [] };
  const progress = { revision: 1, savedEdits: 0, staged: false };
  log.modelCall(event, progress); log.modelCall(event, progress);
  log.modelCall({ ...event, stepNumber: 1, usage: undefined }, progress); log.finish('provider_error', progress, true); log.finish('duplicate');
  expect(events).toHaveLength(3); expect(events[1]).toMatchObject({ callCount: 2, stepEstimatedUsd: null, runEstimatedUsd: null, knownRunEstimatedUsd: .00301 });
  expect(events[2]).toMatchObject({ event: 'run-summary', callCount: 2, runEstimatedUsd: null });
});
test('repeated commands and the existing failure guard are visible without logging arguments or stopping tools', () => {
  const events: Record<string, unknown>[] = [], log = new AssistantCostLog({ projectId: 'project', runId: 'run' }, event => events.push(event));
  for (let stepNumber = 0; stepNumber < 3; stepNumber++) {
    const call = { type: 'tool-call', toolCallId: `tool-${stepNumber}`, toolName: 'inspectTimeline', input: { private: 'not for logs' } };
    log.modelCall({ callId: 'call', stepNumber, modelId: 'gpt-6.1-sol', provider: 'openai.responses', usage: usage(), providerMetadata: metadata, content: [call] }, { revision: 1, savedEdits: 0, staged: false });
    log.toolsFinished({ content: [call, { type: 'tool-error', toolCallId: call.toolCallId, toolName: call.toolName }] });
  }
  expect(events.filter(event => event.event === 'model-step')[2].warnings).toContain('same_tool_repeated_three_times_without_saved_revision');
  expect(events.at(-1)).toMatchObject({ event: 'anomaly', reason: 'existing_repeated_tool_failure_guard', runToolCallCount: 3 });
  expect(JSON.stringify(events)).not.toContain('not for logs');
});
test('the real SDK reports one cost event per provider step before tool execution, excluding private input', async () => {
  const events: Record<string, unknown>[] = [], log = new AssistantCostLog({ projectId: 'project', runId: 'run' }, event => events.push(event));
  let calls = 0, stepNumber = 0;
  const provider = createOpenAI({ apiKey: 'fixture-only', fetch: async () => {
    calls++;
    const output = calls === 1 ? [{ type: 'function_call', id: 'fc', call_id: 'tool-call', name: 'inspect', arguments: '{"private":"do not log this"}' }] : [{ type: 'message', id: 'msg', role: 'assistant', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }];
    return new Response(JSON.stringify({ id: `resp_${calls}`, model: 'gpt-6.1-sol', service_tier: 'default', status: 'completed', output, usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 150 }, total_tokens: 1200 } }), { headers: { 'content-type': 'application/json' } });
  } });
  await generateText({ model: provider.responses('gpt-6.1-sol'), prompt: 'Private fixture prompt', stopWhen: stepCountIs(3), maxRetries: 0,
    onStepStart: event => { stepNumber = event.stepNumber; },
    onLanguageModelCallEnd: event => log.modelCall({ ...event, stepNumber }, { revision: 1, savedEdits: 0, staged: false }),
    onStepEnd: event => log.toolsFinished(event),
    tools: { inspect: tool({ inputSchema: z.object({ private: z.string() }), execute: async () => { expect(events.filter(event => event.event === 'model-step')).toHaveLength(1); return { found: true }; } }) },
  });
  log.finish('completed');
  expect(calls).toBe(2); expect(events.filter(event => event.event === 'model-step')).toHaveLength(2);
  expect(events.at(-1)).toMatchObject({ callCount: 2, runEstimatedUsd: .00602, runToolCallCount: 1 });
  expect(JSON.stringify(events)).not.toContain('do not log this'); expect(JSON.stringify(events)).not.toContain('Private fixture prompt');
});
