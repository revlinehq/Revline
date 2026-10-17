import { writeProject } from './lib/project_data';
import { storeAnalysis } from './lib/asset_analysis';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import workflowTest from '@convex-dev/workflow/test';
import { createThread, saveMessages } from '@convex-dev/agent';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Id } from './_generated/dataModel';
import type { ZodType } from 'zod';
import { api, components } from './_generated/api';
import schema from './schema';

type Tool = { inputSchema: ZodType; execute: (ctx: unknown, input: unknown) => Promise<unknown> };
type ToolStep = { content: unknown[] };
type StopCondition = (options: { steps: ToolStep[] }) => boolean | PromiseLike<boolean>;
const sdk = vi.hoisted(() => ({ options: null as null | { instructions: string; tools: Record<string, Tool>; stopWhen: StopCondition | StopCondition[] }, plan: async () => {}, steps: [] as ToolStep[], finishReason: 'stop' }));
vi.mock('@convex-dev/agent', async original => ({
  ...await original<Record<string, unknown>>(),
  Agent: class { constructor(_component: unknown, options: NonNullable<typeof sdk.options>) { sdk.options = options; } async streamText() { await sdk.plan(); return { finishReason: Promise.resolve(sdk.finishReason), steps: Promise.resolve(sdk.steps) }; } },
  createTool: (options: unknown) => options,
}));
import { respond } from './assistantActions';
import { AssistantTokenBudgetError } from '../lib/ai/token-budget';
const execute = async(tools: Record<string, Tool>, name: string, input: unknown) => {
  if(name==='addTimedEffect')await tools.planEffects.execute({},{plans:[{id:'fixture-flash',kind:'timed',effect:'flash',start:1.69,duration:.5,purpose:'Explicitly requested flash',strength:'Fixed preset',expectation:'The flash accents this moment',anchor:{kind:'requested-time',time:1.69,description:'Explicit fixture time'}}]});
  return tools[name].execute({}, tools[name].inputSchema.parse(input));
};
beforeEach(() => { sdk.options = null; sdk.plan = async () => {}; sdk.steps = []; sdk.finishReason = 'stop'; vi.stubEnv('BILLING_ENABLED', 'false'); vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-only'); vi.stubEnv('AI_GATEWAY_ENABLED', 'false'); });
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
  await t.run(ctx => writeProject(ctx,projectId, { timeline, threadId, aiRunning: true, aiRunId: 'run', aiRequest: { prompt, messageId: promptMessageId, startedRevision: 0 }, revision: 0, history: [], ...(recovery ? { aiRecovery: { requests: ['Add selected source and a flash'], runId: 'previous-run', revision: 0, savedEdits: 1, reason: 'Stopped', status: 'stopped' as const, updatedAt: 0 } } : {}) }));
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
  return { t, owner, projectId, threadId, promptMessageId, assetId, source, timeline, analysisRequests, runPlan, read, messages, ctx };
}

test('greetings, timeline inspection and unchanged tools never begin timeline editing', async () => {
  const f = await fixture('Yo, what can you do with this footage?');
  await f.runPlan(async tools => {
    expect(await f.owner.query(api.assistant.status, { projectId: f.projectId })).toMatchObject({ running: true, editing: false });
    await execute(tools, 'inspectTimeline', {});
    expect(await execute(tools, 'trim', { clipId: f.source.id, duration: f.source.duration, sourceStart: f.source.sourceStart })).toMatchObject({ unchanged: true });
    expect(await f.owner.query(api.assistant.status, { projectId: f.projectId })).toMatchObject({ running: true, editing: false });
  });
  expect((await f.read()).aiError).toBeUndefined();
  expect((await f.read()).aiEditing).toBe(false);
});

test('changed tools acquire one editing lock before publication and retain it through a private replacement', async () => {
  const f = await fixture('Lower the sound and replace the shot');
  const mutate = f.ctx.runMutation;
  let starts = 0;
  f.ctx.runMutation = async (reference, args) => {
    if (getFunctionName(reference as FunctionReference<'mutation'>) !== 'assistant:beginEditing') return mutate(reference, args);
    starts++;
    expect((await f.read()).timeline?.clips).toEqual(f.timeline.clips);
    const result = await mutate(reference, args);
    expect((await f.read()).aiEditing).toBe(true);
    return result;
  };
  await f.runPlan(async tools => {
    await execute(tools, 'setVolume', { clipId: f.source.id, volume: .5 });
    expect((await f.read()).aiEditing).toBe(true);
    await execute(tools, 'delete', { clipId: f.source.id });
    expect((await f.read()).timeline?.clips[0]).toMatchObject({ id: f.source.id, volume: .5 });
    expect(await execute(tools, 'inspectTimeline', {})).toMatchObject({ staged: true, timeline: { clips: [] } });
    expect((await f.read()).aiEditing).toBe(true);
  });
  expect(starts).toBe(1);
  expect((await f.read()).timeline?.clips).toEqual([]);
  expect((await f.read()).aiEditing).toBe(false);
  expect((await f.read()).aiError).toBeUndefined();
});

test('prepared overview and transcript are hydrated and reused without requesting another analysis job', async () => {
  const f = await fixture('Make a concise edit from this prepared footage');
  const understanding = { summary: 'The saved upload overview', scenes: [{ start: 0, end: 3, description: 'The subject explains the result.', score: .8 }] };
  const transcript = { segments: [{ start: 0, end: 2, text: 'These are the saved words.' }], words: [{ start: 0, end: .4, text: 'These' }] };
  await f.t.run(async ctx => { const asset = (await ctx.db.get(f.assetId))!; await storeAnalysis(ctx, asset, { understanding, transcript }); });
  const mutate = f.ctx.runMutation;
  let requestedAnalysis = 0;
  f.ctx.runMutation = async (reference, args) => {
    if (getFunctionName(reference as FunctionReference<'mutation'>) === 'assistant:requestAnalysis') {
      requestedAnalysis++;
      throw new Error('Prepared evidence must not queue another analysis job');
    }
    return mutate(reference, args);
  };
  const results: unknown[] = [];
  await f.runPlan(async tools => {
    results.push(await execute(tools, 'analyzeMedia', { assetId: f.assetId, mode: 'understand' }));
    results.push(await execute(tools, 'analyzeMedia', { assetId: f.assetId, mode: 'transcribe' }));
    results.push(await execute(tools, 'inspectAssetAnalysis', { assetId: f.assetId }));
  });
  expect(requestedAnalysis).toBe(0);
  expect(results).toEqual([
    expect.objectContaining({ analyzed: true, summary: understanding.summary, sceneCount: 1 }),
    expect.objectContaining({ analyzed: true, segmentCount: 1, wordCount: 1 }),
    expect.objectContaining({ understanding, transcript: expect.objectContaining({ segments: transcript.segments, wordCount: 1 }) }),
  ]);
  expect((await f.read()).aiError).toBeUndefined();
});

test('a speech edit can trim a false start from saved source word timings without another video analysis', async () => {
  const f = await fixture('Remove the false start and keep the complete sentence');
  const words = [
    { start: 11.5, end: 11.8, text: 'I' },
    { start: 12.2, end: 12.4, text: 'I' },
    { start: 12.4, end: 12.7, text: 'built' },
    { start: 12.7, end: 13, text: 'this' },
    { start: 13, end: 14, text: 'today.' },
  ];
  await f.t.run(async ctx => { const asset = (await ctx.db.get(f.assetId))!; await storeAnalysis(ctx, asset, { transcript: { words, segments: [{ start: 11.5, end: 14, text: 'I I built this today.' }] } }); });
  await f.runPlan(async tools => {
    const read = await execute(tools, 'inspectAssetAnalysis', { assetId: f.assetId, start: 11.5, end: 14.5 }) as { transcript: { words: typeof words } };
    expect(read.transcript.words).toEqual(words);
    const retained = read.transcript.words.slice(1);
    await execute(tools, 'trim', { clipId: f.source.id, sourceStart: retained[0].start, duration: retained.at(-1)!.end - retained[0].start });
  });
  expect(f.analysisRequests).toEqual([]);
  const trimmed = (await f.read()).timeline!.clips[0];
  expect(trimmed.sourceStart).toBe(12.2);
  expect(trimmed.duration).toBeCloseTo(1.8, 10);
  expect((await f.read()).aiError).toBeUndefined();
});

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

test('repeated failed commands stop early with saved progress and an unpublished replacement intact', async () => {
  const f = await fixture('Add a flash, then replace the source footage');
  let attempts = 0;
  await f.runPlan(async tools => {
    await execute(tools, 'addTimedEffect', { preset: 'flash', start: 1.69, duration: .5 });
    await execute(tools, 'delete', { clipId: 'source' });
    for (let index = 0; index < 8; index++) {
      const input = { clipId: 'missing', volume: .5 }, toolCallId = `attempt-${index}`;
      let error: unknown;
      try { await execute(tools, 'setVolume', input); } catch (cause) { error = cause; }
      expect(error).toBeInstanceOf(Error);
      attempts++;
      sdk.steps.push({ content: [{ type: 'tool-call', toolCallId, toolName: 'setVolume', input }, { type: 'tool-error', toolCallId, toolName: 'setVolume', input, error }] });
      const conditions = Array.isArray(sdk.options!.stopWhen) ? sdk.options!.stopWhen : [sdk.options!.stopWhen];
      if ((await Promise.all(conditions.map(condition => condition({ steps: sdk.steps })))).some(Boolean)) { sdk.finishReason = 'tool-calls'; break; }
    }
  });
  expect(attempts).toBe(3);
  const saved = await f.read();
  expect(saved.revision).toBe(1);
  expect(saved.timeline?.clips.find(clip => clip.id === 'source')).toEqual(f.source);
  expect(saved.timeline?.clips.some(clip => clip.effectPreset === 'flash')).toBe(true);
  expect(saved.aiError).toContain('same tool command failed three times');
  expect(saved.aiError).not.toContain('model configuration');
  expect(saved.aiRecovery).toMatchObject({ savedEdits: 1, revision: 1, status: 'failed', requests: ['Add a flash, then replace the source footage'] });
  const texts = (await f.messages()).page.flatMap(message => message.parts).filter(part => part.type === 'text').map(part => part.text);
  expect(texts.some(text => text.includes('1 edits were saved') && text.includes('same tool command failed three times'))).toBe(true);
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
