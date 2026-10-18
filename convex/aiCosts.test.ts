/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import type { EditorCostRecord } from '../lib/ai/cost-history';
const modules = import.meta.glob('./**/*.ts');
const identity = { subject: 'owner', issuer: 'https://fixture.clerk.accounts.dev', tokenIdentifier: 'fixture|owner' };
const record: EditorCostRecord = { key: 'call:1', kind: 'model-call', recordedAt: Date.parse('2026-10-18T17:00:00Z'), model: 'gpt-6.1-sol', provider: 'openai.responses', reasoningEffort: 'high', speedMode: 'fast', serviceTier: 'fast', estimatedUsd: .02, inputTokens: 300, outputTokens: 50, reasoningTokens: 20, toolCallCount: 2, unreportedCall: false };
beforeEach(() => { vi.stubEnv('MODEL_SWITCHER_ENABLED', 'true'); vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-18T20:00:00Z')); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
async function fixture() {
  const t = convexTest(schema, modules);
  const projectId = await t.run(ctx => ctx.db.insert('projects', { ownerId: 'owner', title: 'Cost fixture', aspectRatio: 'landscape', createdAt: Date.now(), updatedAt: Date.now() }));
  return { t, projectId, owner: t.withIdentity(identity), stranger: t.withIdentity({ ...identity, subject: 'stranger' }) };
}
test('owner-only indexed report includes failed-run unknowns and idempotently records each paid callback once', async () => {
  const { t, projectId, owner, stranger } = await fixture();
  await t.mutation(internal.aiCosts.record, { projectId, runId: 'run', record });
  await t.mutation(internal.aiCosts.record, { projectId, runId: 'run', record });
  await t.mutation(internal.aiCosts.record, { projectId, runId: 'run', record: { ...record, key: 'call:2', estimatedUsd: null, reasoningEffort: null, speedMode: null, serviceTier: null } });
  await t.mutation(internal.aiCosts.record, { projectId, runId: 'run', record: { ...record, kind: 'run-summary', key: 'summary', estimatedUsd: null, unreportedCall: true } });
  const result = await owner.query(api.aiCosts.summary, { days: 7, timeZone: 'America/New_York' });
  expect(result?.summary).toMatchObject({ callCount: 2, knownEstimatedUsd: .02, unknownCostCalls: 1, unreportedRuns: 1, runCount: 1 });
  expect(result?.recordingSince).toBe(record.recordedAt);
  expect(result?.breakdown).toHaveLength(2);
  expect(result?.daily).toHaveLength(7);
  expect(result?.truncated).toBe(false);
  const foreign = await stranger.query(api.aiCosts.summary, { days: 7, timeZone: 'UTC' });
  expect(foreign?.summary.callCount).toBe(0); expect(foreign?.recordingSince).toBeNull();
  await expect(t.query(api.aiCosts.summary, { days: 7, timeZone: 'UTC' })).rejects.toThrow('Authentication required');
});
test('explicit gates hide the query and avoid persisting diagnostics outside development', async () => {
  const { t, projectId, owner } = await fixture();
  vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'false');
  await t.mutation(internal.aiCosts.record, { projectId, runId: 'disabled', record });
  expect(await owner.query(api.aiCosts.summary, { days: 30, timeZone: 'UTC' })).toBeNull();
  expect(await t.run(ctx => ctx.db.query('aiCostRecords').withIndex('by_owner_recorded', q => q.eq('ownerId', 'owner')).take(10))).toHaveLength(0);
  vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'true'); vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false');
  expect(await owner.query(api.aiCosts.summary, { days: 30, timeZone: 'UTC' })).toBeNull();
});
test('rejects invalid timezone and unsupported period without reading another owner', async () => {
  const { owner } = await fixture();
  await expect(owner.query(api.aiCosts.summary, { days: 7, timeZone: 'invalid' })).rejects.toThrow('valid time zone');
  await expect(owner.query(api.aiCosts.summary, { days: 365 as 7, timeZone: 'UTC' })).rejects.toThrow();
});
test('bounded report marks truncated totals and keeps original recording start', async () => {
  const { t, projectId, owner } = await fixture();
  await t.run(async ctx => {
    for (let index = 0; index < 5001; index++) await ctx.db.insert('aiCostRecords', { ownerId: 'owner', projectId, runId: 'busy-run', ...record, key: `call:${index}`, recordedAt: record.recordedAt + index });
  });
  const result = await owner.query(api.aiCosts.summary, { days: 7, timeZone: 'UTC' });
  expect(result?.truncated).toBe(true); expect(result?.summary.callCount).toBe(5000); expect(result?.summary.knownEstimatedUsd).toBe(100); expect(result?.recordingSince).toBe(record.recordedAt);
});

test('per-turn totals use raw prompt identity, preserve modes and never guess legacy linkage', async () => {
  const { t, projectId, owner, stranger } = await fixture();
  await t.run(ctx => ctx.db.patch(projectId, { threadId: 'thread' }));
  const linked = { projectId, threadId: 'thread', promptMessageId: 'raw-prompt' };
  await t.mutation(internal.aiCosts.record, { ...linked, runId: 'run-a', record });
  await t.mutation(internal.aiCosts.record, { ...linked, runId: 'run-a', record });
  await t.mutation(internal.aiCosts.record, { ...linked, runId: 'run-a', record: { ...record, key: 'call:2', estimatedUsd: .01, serviceTier: 'default' } });
  await t.mutation(internal.aiCosts.record, { ...linked, runId: 'run-a', record: { ...record, key: 'call:3', estimatedUsd: null, recordedAt: 1 } });
  await t.mutation(internal.aiCosts.record, { projectId, runId: 'legacy-no-prompt', record: { ...record, estimatedUsd: 100 } });
  const result = await owner.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: ['raw-prompt', 'react-stream-key', 'old-prompt'] });
  expect(result).toHaveLength(1);
  expect(result?.[0]).toMatchObject({ promptMessageId: 'raw-prompt', callCount: 3, knownEstimatedUsd: .03, unknownCostCalls: 1, truncated: false });
  expect(result?.[0].breakdown).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(/"(?:ownerId|projectId|runId|threadId|input|promptText)"/);
  await expect(stranger.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: ['raw-prompt'] })).rejects.toThrow('Project not found');
  await expect(owner.query(api.aiCosts.turns, { projectId, threadId: 'other-thread', promptMessageIds: ['raw-prompt'] })).rejects.toThrow('Conversation not found');
  await expect(t.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: ['raw-prompt'] })).rejects.toThrow('Authentication required');
});

test('turn diagnostics enforce bounds and conversation ownership, including interrupted-usage markers', async () => {
  const { t, projectId, owner } = await fixture();
  await t.run(ctx => ctx.db.patch(projectId, { threadId: 'thread' }));
  const linked = { projectId, threadId: 'thread', promptMessageId: 'raw-prompt' };
  await expect(t.mutation(internal.aiCosts.record, { projectId, runId: 'bad-thread', threadId: 'foreign-thread', promptMessageId: 'raw-prompt', record })).rejects.toThrow('does not match');
  await expect(t.mutation(internal.aiCosts.record, { projectId, runId: 'missing-prompt', threadId: 'thread', record })).rejects.toThrow('does not match');
  await t.mutation(internal.aiCosts.record, { ...linked, runId: 'interrupted', record: { ...record, key: 'summary', kind: 'run-summary', unreportedCall: true } });
  expect((await owner.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: ['raw-prompt'] }))?.[0]).toMatchObject({ callCount: 0, unreportedRuns: 1 });
  await expect(owner.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: Array.from({ length: 51 }, (_, i) => `prompt-${i}`) })).rejects.toThrow('up to 50');
  await expect(owner.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: ['same', 'same'] })).rejects.toThrow('unique');
  vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'false');
  expect(await owner.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: ['raw-prompt'] })).toBeNull();
});

test('per-turn truncation is explicit and does not expose another project with matching prompt IDs', async () => {
  const { t, projectId, owner } = await fixture();
  await t.run(async ctx => {
    await ctx.db.patch(projectId, { threadId: 'thread' });
    const other = await ctx.db.insert('projects', { ownerId: 'owner', title: 'Other', aspectRatio: 'landscape', createdAt: 1, updatedAt: 1, threadId: 'thread' });
    for(let index=0;index<65;index++) await ctx.db.insert('aiCostRecords', { ownerId: 'owner', projectId, runId: 'busy', threadId: 'thread', promptMessageId: 'prompt', ...record, key: `call:${index}` });
    await ctx.db.insert('aiCostRecords', { ownerId: 'owner', projectId: other, runId: 'other', threadId: 'thread', promptMessageId: 'prompt', ...record, estimatedUsd: 100 });
  });
  expect((await owner.query(api.aiCosts.turns, { projectId, threadId: 'thread', promptMessageIds: ['prompt'] }))?.[0]).toMatchObject({ truncated: true, callCount: 64, knownEstimatedUsd: 1.28 });
});
