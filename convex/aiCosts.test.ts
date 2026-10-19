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
test('explicit recording flag is independent of the picker while both flags still hide the dashboard', async () => {
  const { t, projectId, owner } = await fixture();
  vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'false');
  await t.mutation(internal.aiCosts.record, { projectId, runId: 'disabled', record });
  expect(await owner.query(api.aiCosts.summary, { days: 30, timeZone: 'UTC' })).toBeNull();
  expect(await t.run(ctx => ctx.db.query('aiCostRecords').withIndex('by_owner_recorded', q => q.eq('ownerId', 'owner')).take(10))).toHaveLength(0);
  vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'true'); vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false');
  await t.mutation(internal.aiCosts.record,{projectId,runId:'picker-hidden',record});
  expect(await t.run(ctx=>ctx.db.query('aiCostRecords').withIndex('by_run_key',q=>q.eq('runId','picker-hidden').eq('key',record.key)).unique())).toMatchObject({inputTokens:300});
  expect(await owner.query(api.aiCosts.summary, { days: 30, timeZone: 'UTC' })).toBeNull();
});

test('cache usage is sanitized, persisted per call and reported as known subtotals with explicit legacy gaps',async()=>{
  const {costHistoryRecord}=await import('../lib/ai/cost-history');
  const event={event:'model-step',timestamp:new Date(record.recordedAt).toISOString(),callId:'cache',step:1,model:record.model,provider:record.provider,inputTokens:300,uncachedInputTokens:20,cacheReadTokens:200,cacheWriteTokens:80,outputTokens:50,reasoningTokens:20,stepEstimatedUsd:.02,prompt:'Private prompt must never persist'};
  const parsed=costHistoryRecord(event)!;
  expect(parsed).toMatchObject({uncachedInputTokens:20,cacheReadTokens:200,cacheWriteTokens:80});
  expect(JSON.stringify(parsed)).not.toContain('Private prompt');
  expect(costHistoryRecord({...event,cacheWriteTokens:-1})).toMatchObject({cacheWriteTokens:null});
  const {t,projectId,owner}=await fixture();
  await t.mutation(internal.aiCosts.record,{projectId,runId:'cache-run',record:parsed});
  await t.mutation(internal.aiCosts.record,{projectId,runId:'legacy',record});
  await t.mutation(internal.aiCosts.record,{projectId,runId:'inconsistent',record:{...record,uncachedInputTokens:300,cacheReadTokens:1,cacheWriteTokens:2}});
  const result=await owner.query(api.aiCosts.summary,{days:7,timeZone:'UTC'});
  expect(result?.summary).toMatchObject({callCount:3,inputTokens:900,uncachedInputTokens:20,cacheReadTokens:200,cacheWriteTokens:80,unknownCacheUsageCalls:2});
  expect(await t.run(ctx=>ctx.db.query('aiCostRecords').withIndex('by_run_key',q=>q.eq('runId','cache-run').eq('key',parsed.key)).unique())).toMatchObject({uncachedInputTokens:20,cacheReadTokens:200,cacheWriteTokens:80});
});

test('installed Agent and OpenAI serializer append ephemeral repair context after the unchanged request prefix',async()=>{
  vi.useRealTimers();
  const [{Agent,createThread,saveMessages},{default:agentTest},{createOpenAI},{components},{editorRepairContext,EDITOR_CONTEXT_BOUNDARY},{editorProviderOptions},{wrapLanguageModel},{AssistantTokenBudget}]=await Promise.all([import('@convex-dev/agent'),import('@convex-dev/agent/test'),import('@ai-sdk/openai'),import('./_generated/api'),import('../lib/ai/editor-context'),import('../lib/ai/claude-model'),import('ai'),import('../lib/ai/token-budget')]);
  const t=convexTest(schema,modules);agentTest.register(t);
  const threadId=await t.run(ctx=>createThread(ctx,components.agent,{userId:'owner'}));
  const promptMessageId=await t.run(async ctx=>(await saveMessages(ctx,components.agent,{threadId,userId:'owner',messages:[{role:'user',content:'Keep the original request'}]})).messages[0]._id);
  const payloads:Record<string,unknown>[]=[];
  const provider=createOpenAI({apiKey:'offline-fixture',fetch:async(_url,init)=>{
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({id:`response-${payloads.length}`,object:'response',created_at:1,model:'offline-fixture',status:'completed',output:[{type:'message',id:`answer-${payloads.length}`,status:'completed',role:'assistant',content:[{type:'output_text',text:'Saved response',annotations:[]}]}],usage:{input_tokens:10,output_tokens:2,total_tokens:12,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}),{headers:{'content-type':'application/json'}});
  }});
  const model=wrapLanguageModel({model:provider.responses('gpt-6.1-sol'),middleware:new AssistantTokenBudget().middleware([],0,undefined,false)});
  const agent=new Agent(components.agent,{name:'Offline prefix fixture',languageModel:model,instructions:`Keep these instructions byte-identical.${EDITOR_CONTEXT_BOUNDARY}Current timeline fixture.`,contextOptions:{recentMessages:100,excludeToolMessages:false}});
  const ctx={runQuery:t.query,runMutation:t.mutation,runAction:t.action} as Parameters<typeof agent.generateText>[0];
  const settings={promptMessageId,providerOptions:editorProviderOptions({provider:'openai',modelId:'gpt-6.1-sol'})};
  await agent.generateText(ctx,{threadId,userId:'owner'},settings);
  const feedback='Server diagnostic: finish only the remaining verification.';
  await agent.generateText(ctx,{threadId,userId:'owner'},settings,{contextHandler:async(_ctx,{allMessages})=>editorRepairContext(allMessages,feedback)});
  expect(payloads).toHaveLength(2);
  const [initial,repair]=payloads.map(body=>body.input as {role:string;content:unknown}[]);
  expect(repair.slice(0,initial.length)).toEqual(initial);
  expect(repair.at(-1)).toMatchObject({role:'developer'});
  expect(JSON.stringify(repair.at(-1))).toContain(feedback);
  expect(payloads[1].model).toBe(payloads[0].model);
  const saved=await agent.listMessages(ctx,{threadId,paginationOpts:{cursor:null,numItems:100}});
  expect(saved.page).toHaveLength(3);
  expect(JSON.stringify(saved.page)).not.toContain(feedback);
  expect(editorRepairContext([],'x'.repeat(40_000))[0].content).toHaveLength('# Finish the current request\n'.length+16_000);
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
