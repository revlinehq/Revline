import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { AssistantTurnCostDetails, AssistantTurnCostsProvider, AssistantTurnCostBadge, turnCostPromptIds, type AssistantTurnCost } from './assistant-turn-costs';
const report: AssistantTurnCost = { promptMessageId: 'raw-user-id', knownEstimatedUsd: .1146, callCount: 3, unknownCostCalls: 1, unreportedRuns: 1, breakdown: [{ model: 'gpt-6.1-sol', provider: 'openai.responses', reasoningEffort: 'medium', speedMode: 'fast', serviceTier: 'default', knownEstimatedUsd: .1146, callCount: 2, unknownCostCalls: 0 }, { model: null, provider: null, reasoningEffort: null, speedMode: null, serviceTier: null, knownEstimatedUsd: 0, callCount: 1, unknownCostCalls: 1 }] };
test('uses actual user message IDs rather than streamed React keys, bounded to latest fifty', () => {
  expect(turnCostPromptIds([{ id: 'react-key', sourceId: 'raw-user-id', role: 'user', text: 'private prompt' }, { id: 'assistant', role: 'assistant', text: '' }, { id: 'pending-1', role: 'user', text: '' }])).toEqual(['raw-user-id']);
  const ids = turnCostPromptIds(Array.from({ length: 60 }, (_, i) => ({ id: `id-${i}`, role: 'user', text: '' })));
  expect(ids).toHaveLength(50); expect(ids[0]).toBe('id-10');
});
test('shows all-step turn estimate and requested speed separately from actual billed tier', () => {
  const html = renderToStaticMarkup(<AssistantTurnCostDetails report={report} />);
  expect(html).toContain('$0.11'); expect(html).toContain('GPT-6.1 Sol'); expect(html).toContain('Reasoning: Medium'); expect(html).toContain('Requested speed: Fast'); expect(html).toContain('Returned tier: Standard'); expect(html).toContain('unpriced'); expect(html).toContain('incomplete'); expect(html).toContain('All recorded model steps'); expect(html).not.toContain('raw-user-id');
});
test('historical missing usage, unavailable tracking and loading never claim zero cost', () => {
  for (const props of [{}, { unavailable: true }, { loading: true }]) {
    const html = renderToStaticMarkup(<AssistantTurnCostDetails {...props} />); expect(html).not.toContain('$0');
  }
  expect(renderToStaticMarkup(<AssistantTurnCostDetails />)).toContain('Older messages are not backfilled');
});
test('entirely unpriced turn is Unknown instead of free', () => {
  const html = renderToStaticMarkup(<AssistantTurnCostDetails report={{ ...report, knownEstimatedUsd: 0, callCount: 1, unknownCostCalls: 1, breakdown: [report.breakdown[1]] }} />);
  expect(html).toContain('Unknown'); expect(html).not.toContain('$0.00');
});

afterEach(() => vi.unstubAllEnvs());
test('production never mounts diagnostics query or badges even with a conversation', () => {
  vi.stubEnv('NODE_ENV', 'production');
  const html = renderToStaticMarkup(<AssistantTurnCostsProvider conversation={{ projectId: 'project' as never, threadId: 'thread' }} messages={[{ id: 'raw', role: 'user', text: '' }]}><p>Main chat</p><AssistantTurnCostBadge promptMessageId="raw" /></AssistantTurnCostsProvider>);
  expect(html).toContain('Main chat'); expect(html).not.toContain('assistant-turn-cost-trigger');
});
test('scripted demos never mount diagnostics even during development', () => {
  vi.stubEnv('NODE_ENV', 'development');
  const html = renderToStaticMarkup(<AssistantTurnCostsProvider demo conversation={{ projectId: 'project' as never, threadId: 'thread' }} messages={[{ id: 'raw', role: 'user', text: '' }]}><p>Demo chat</p><AssistantTurnCostBadge promptMessageId="raw" /></AssistantTurnCostsProvider>);
  expect(html).toContain('Demo chat'); expect(html).not.toContain('assistant-turn-cost-trigger');
});
