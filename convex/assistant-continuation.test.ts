/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import workflowTest from '@convex-dev/workflow/test';
import { createThread, saveMessages } from '@convex-dev/agent';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Id } from './_generated/dataModel';
import type { ZodType } from 'zod';
import { api, components, internal } from './_generated/api';
import schema from './schema';

type Tool = { inputSchema: ZodType; execute: (ctx: unknown, input: unknown) => Promise<unknown> };
const sdk = vi.hoisted(() => ({ options: null as null | { instructions: string; tools: Record<string, Tool> }, plan: async () => {} }));
vi.mock('@convex-dev/agent', async original => ({
  ...await original<Record<string, unknown>>(),
  Agent: class { constructor(_component: unknown, options: NonNullable<typeof sdk.options>) { sdk.options = options; } async streamText() { await sdk.plan(); return { finishReason: Promise.resolve('stop'), steps: Promise.resolve([]) }; } },
  createTool: (options: unknown) => options,
}));
import { respond } from './assistantActions';
import { AssistantTokenBudgetError } from '../lib/ai/token-budget';
const execute = (tools: Record<string, Tool>, name: string, input: unknown) => tools[name].execute({}, tools[name].inputSchema.parse(input));
beforeEach(() => { sdk.options = null; sdk.plan = async () => {}; vi.stubEnv('BILLING_ENABLED', 'false'); });
afterEach(() => vi.unstubAllEnvs());

async function fixture(prompt = 'can u put bunch of effects here', scenes: { start: number; end: number; description: string; score: number }[] = [], recovery = false) {
  const t = convexTest(schema, import.meta.glob('./**/*.ts')); agentTest.register(t); workflowTest.register(t);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Owned creative effects fixture', aspectRatio: 'landscape' });
  const threadId = await t.run(ctx => createThread(ctx, components.agent, { userId: 'owner' }));
  await t.run(ctx => saveMessages(ctx, components.agent, { threadId, userId: 'owner', messages: [{ role: 'user', content: 'Earlier I was looking at 11.5 seconds' }, { role: 'assistant', content: 'That earlier time is noted.' }] }));
  const promptMessageId = await t.run(async ctx => (await saveMessages(ctx, components.agent, { threadId, userId: 'owner', messages: [{ role: 'user', content: prompt }] })).messages[0]._id);
  const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId, kind: 'video', fileName: 'Untrusted fight filename.mp4', contentType: 'video/mp4', size: 10, duration: 60, createdAt: 0, ...(scenes.length ? { analysis: { understanding: { summary: 'Stored visual overview', scenes } } } : {}) }));
  const source = { id: 'source', assetId, kind: 'video' as const, track: 1, start: 1.69, sourceStart: 11.5, duration: 3 };
  const timeline = { fps: 30, aspectRatio: 'landscape' as const, tracks: { visual: 1, overlay: 0, audio: 0, effects: 0 }, clips: [source] };
  await t.run(ctx => ctx.db.patch(projectId, { timeline, threadId, aiRunning: true, aiRunId: 'run', revision: 0, history: [], ...(recovery ? { aiRecovery: { requests: ['Add selected source and a flash'], runId: 'previous-run', revision: 0, savedEdits: 1, reason: 'Stopped', status: 'stopped' as const, updatedAt: 0 } } : {}) }));
  const run = { projectId, ownerId: 'owner', runId: 'run' };
  const analysisRequests: unknown[] = [];
  const ctx = {
    runQuery: (reference: unknown, args: unknown) => t.query(reference as FunctionReference<'query'>, args as Record<string, unknown>),
    runMutation: async (reference: unknown, args: unknown) => {
      let name = ''; try { name = getFunctionName(reference as FunctionReference<'mutation'>); } catch { /* Agent component references use a component address. */ }
      const result = await t.mutation(reference as FunctionReference<'mutation'>, args as Record<string, unknown>);
      if (name === 'assistant:requestAnalysis') {
        const input = args as { assetId: string; videoRequest?: { start: number; end: number; question: string } };
        analysisRequests.push(input);
        const videoRequest = input.videoRequest;
        if (videoRequest) await t.run(db => db.db.patch(result as Id<'analysisRequests'>, { status: 'completed', videoInspection: { ...videoRequest, summary: 'A visible reaction and camera hold in this actual window', uncertainty: 'Semantic windows are approximate.', matches: [{ start: videoRequest.start, end: videoRequest.end, description: 'Visible reaction' }] } }));
      }
      return result;
    },
  };
  const read = () => owner.query(api.projects.get, { projectId });
  const messages = () => owner.query(api.assistant.messages, { projectId, threadId, paginationOpts: { cursor: null, numItems: 100 } });
  const runPlan = async (plan: (tools: Record<string, Tool>) => Promise<void>) => {
    sdk.plan = () => plan(sdk.options!.tools);
    await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { ...run, threadId, promptMessageId, playhead: 1.69, selectedClipId: 'source', selectedClipIds: ['source'] });
  };
  return { t, owner, projectId, threadId, promptMessageId, assetId, source, timeline, analysisRequests, runPlan, read, messages };
}

test('durable recovery inspects fresh saved state regardless of wording and does not duplicate footage already published', async () => {
  const f = await fixture('Make it a little softer', [], true); let attemptedWithoutInspection: unknown;
  await f.runPlan(async tools => {
    try { await execute(tools, 'addMedia', { assetId: f.assetId, start: 1.69, sourceStart: 11.5, duration: 3 }); } catch (error) { attemptedWithoutInspection = error; }
    await execute(tools, 'inspectTimeline', {});
    expect(await execute(tools, 'addMedia', { assetId: f.assetId, start: 1.69, sourceStart: 11.5, duration: 3 })).toMatchObject({ unchanged: true, saved: false });
    await execute(tools, 'addTimedEffect', { preset: 'flash', start: 1.69, duration: .5 });
  });
  expect(String(attemptedWithoutInspection)).toContain('Inspect the current timeline');
  expect((await f.read()).timeline?.clips.filter(clip => clip.kind === 'video')).toEqual([f.source]);
  expect((await f.read()).revision).toBe(1);
});

test('an active-work timeout reports its actual cause and preserves the already-saved edit', async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture('Add a flash at 1.69 seconds');
    await f.runPlan(async tools => { await execute(tools, 'addTimedEffect', { preset: 'flash', start: 1.69, duration: .5 }); await vi.advanceTimersByTimeAsync(300_000); });
    const saved = await f.read(); expect(saved.revision).toBe(1); expect(saved.aiError).toContain('editing time budget'); expect(saved.aiError).not.toContain('model configuration');
    const texts = (await f.messages()).page.flatMap(message => message.parts).filter(part => part.type === 'text').map(part => part.text);
    expect(texts.some(text => text.includes('1 edits were saved'))).toBe(true);
  } finally { vi.useRealTimers(); }
});


test('a token safety stop preserves saved checkpoints and identifies the actual stop', async () => {
  const f = await fixture('Add a flash at 1.69 seconds');
  await f.runPlan(async tools => { await execute(tools, 'addTimedEffect', { preset: 'flash', start: 1.69, duration: .5 }); throw new AssistantTokenBudgetError('tokens'); });
  const saved = await f.read();
  expect(saved.revision).toBe(1); expect(saved.aiError).toContain('token budget');
  const texts = (await f.messages()).page.flatMap(message => message.parts).filter(part => part.type === 'text').map(part => part.text);
  expect(texts.some(text => text.includes('1 edits were saved') && text.includes('token budget'))).toBe(true);
});

test('credit exhaustion reports billing recovery without claiming a configuration failure or edit', async () => {
  const f = await fixture('Add a flash at 1.69 seconds');
  await f.runPlan(async () => { throw Object.assign(new Error('credit balance too low'), { statusCode: 400 }); });
  const saved = await f.read();
  expect(saved.revision).toBe(0); expect(saved.aiError).toContain('credits are exhausted');
  expect(saved.aiError).not.toContain('model configuration');
});


test('the word continue without recovery state does not prohibit an explicitly requested copy', async () => {
  const f = await fixture('Continue and copy the selected footage here');
  await f.runPlan(async tools => { await execute(tools, 'duplicateClips', { clipIds: ['source'], at: 6 }); });
  const saved = await f.read();
  expect(saved.timeline?.clips.filter(clip => clip.kind === 'video')).toHaveLength(2);
  expect(saved.revision).toBe(1);
});
