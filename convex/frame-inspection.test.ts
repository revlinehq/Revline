import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import stripeTest from '@convex-dev/stripe/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import { parseFrameInspection } from '../lib/media-analysis/frame-inspection';
const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `https://test.clerk.accounts.dev|${subject}` });
const frameRequest = { start: 1, end: 1.1, question: 'Is contact visible?' };
const evidence = () => parseFrameInspection(JSON.stringify({ summary: 'Apparent contact.', uncertainty: 'No sound evidence.', frames: [{ frameIndex: 30, observation: 'Hand near target.' }, { frameIndex: 31, observation: 'Hand touching target.' }], events: [{ frameIndex: 31, description: 'Contact', confidence: 'medium' }] }), frameRequest, [{ frameIndex: 30, time: 1 }, { frameIndex: 31, time: 31 / 30 }], 30);
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('RENDER_WORKER_SECRET', 'frame-test-secret'); vi.stubEnv('BILLING_ENABLED', 'false'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture() {
  const t = convexTest(schema, modules); workflowTest.register(t); stripeTest.register(t);
  const owner = t.withIdentity(identity('owner')), stranger = t.withIdentity(identity('stranger'));
  const projectId = await owner.mutation(api.projects.create, { title: 'Frames', aspectRatio: 'vertical' });
  const assetId = await t.run(async ctx => { const storageId = await ctx.storage.store(new Blob(['video'])); return ctx.db.insert('assets', { ownerId: 'owner', projectId, storageId, fileName: 'frames.mp4', kind: 'video', contentType: 'video/mp4', size: 5, duration: 3, createdAt: Date.now() }); });
  await t.run(ctx => writeProject(ctx,projectId, { aiRunning: true, aiRunId: 'run' }));
  const run = { projectId, ownerId: 'owner', runId: 'run' };
  const request = (question = frameRequest.question) => t.mutation(internal.assistant.requestAnalysis, { ...run, assetId, mode: 'frames', frameRequest: { ...frameRequest, question } });
  // Workpool's housekeeping timers advance virtual time while draining; keep pending fixture requests live.
  const drain = async () => {await t.finishAllScheduledFunctions(vi.runAllTimers);await t.run(async ctx=>{for(const request of await ctx.db.query('analysisRequests').withIndex('by_projectId',q=>q.eq('projectId',projectId)).take(16))if(request.status==='pending'||request.status==='running')await ctx.db.patch(request._id,{expiresAt:Date.now()+240000});});};
  const claim = () => t.mutation(api.mediaTasks.claim, { workerSecret: 'frame-test-secret' });
  return { t, owner, stranger, projectId, assetId, run, request, drain, claim };
}

test('scoped AI frame requests validate source ownership, range and active run', async () => {
  const f = await fixture();
  await expect(f.t.mutation(internal.assistant.requestAnalysis, { ...f.run, ownerId: 'stranger', assetId: f.assetId, mode: 'frames', frameRequest })).rejects.toThrow('Project not found');
  await expect(f.t.mutation(internal.assistant.requestAnalysis, { ...f.run, runId: 'wrong', assetId: f.assetId, mode: 'frames', frameRequest })).rejects.toThrow('no longer active');
  await expect(f.t.mutation(internal.assistant.requestAnalysis, { ...f.run, assetId: f.assetId, mode: 'frames', frameRequest: { ...frameRequest, end: 4 } })).rejects.toThrow('window');
  await expect(f.owner.mutation(api.mediaTasks.start, { projectId: f.projectId, assetId: f.assetId, kind: 'frames' })).rejects.toThrow('inspection');
  const otherProject = await f.owner.mutation(api.projects.create, { title: 'Other', aspectRatio: 'vertical' });
  await f.t.run(ctx => ctx.db.patch(f.assetId, { projectId: otherProject }));
  await expect(f.request()).rejects.toThrow('suitable media');
});

test('completed evidence is scoped to its request and never marks generic footage analysis ready', async () => {
  const f = await fixture(), requestId = await f.request(); await f.drain();
  const work = (await f.claim())!;
  expect(work.kind).toBe('frames'); expect(work.frameRequest).toEqual(frameRequest);
  await expect(f.stranger.query(api.mediaTasks.get, { taskId: work.taskId })).rejects.toThrow('not found');
  const args = { taskId: work.taskId, leaseToken: work.leaseToken, result: { frameInspection: evidence() } };
  await f.t.mutation(api.mediaTasks.complete, args); await f.t.mutation(api.mediaTasks.complete, args); await f.drain();
  expect(await f.t.query(internal.assistant.analysisRequest, { ...f.run, requestId })).toMatchObject({ status: 'completed', frameInspection: evidence() });
  expect(await f.t.run(ctx => ctx.db.get(work.taskId))).toMatchObject({ frameInspection: evidence() });
  expect((await f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId })).analysis).toBeUndefined();
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline?.clips ?? []).toEqual([]);
});

test('different frame questions remain independent; invalid evidence and cancelled worker writes fail', async () => {
  const f = await fixture();
  const first = await f.request(), second = await f.request('Is the target moving?'); await f.drain();
  const requests = await f.t.run(async ctx => [await ctx.db.get(first), await ctx.db.get(second)]);
  expect(requests[0]?.taskId).not.toBe(requests[1]?.taskId);
  const work = (await f.claim())!;
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: 'wrong', result: { frameInspection: evidence() } })).rejects.toThrow('lease');
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { frameInspection: { ...evidence(), events: [{ ...evidence().events[0], time: 2 }] } } })).rejects.toThrow('inspected frames');
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { frameInspection: evidence(), analysis: { transcript: { segments: [], words: [] } } } })).rejects.toThrow('visual evidence only');
  await f.owner.mutation(api.assistant.stop, { projectId: f.projectId });
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { frameInspection: evidence() } })).rejects.toThrow('lease');
  await f.drain();
});

test('identical frame questions reuse their request and completed background evidence across runs', async () => {
  const f = await fixture(), first = await f.request();
  expect(await f.request()).toBe(first);
  await f.drain(); const work = (await f.claim())!;
  await f.t.mutation(internal.assistant.clearAnalysis, { ...f.run, requestId: first });
  await f.t.mutation(internal.assistant.finish, { ...f.run, error: 'Analysis wait ended.' });
  await f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { frameInspection: evidence() } });
  await f.drain();
  await f.t.run(ctx => writeProject(ctx, f.projectId, { aiRunning: true, aiRunId: 'next-run' }));
  const nextRun = { ...f.run, runId: 'next-run' };
  const cached = await f.t.mutation(internal.assistant.requestAnalysis, { ...nextRun, assetId: f.assetId, mode: 'frames', frameRequest });
  expect(await f.t.query(internal.assistant.analysisRequest, { ...nextRun, requestId: cached })).toMatchObject({ status: 'completed', taskId: work.taskId, frameInspection: evidence() });
  expect(await f.claim()).toBeNull();
  expect(await f.t.run(ctx => ctx.db.query('mediaTasks').withIndex('by_asset_kind', q => q.eq('assetId', f.assetId).eq('kind', 'frames')).take(20))).toHaveLength(1);
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline?.clips ?? []).toEqual([]);
});

test('a later identical frame question reattaches running work but a new window cannot reuse it', async () => {
  const f = await fixture(), first = await f.request(); await f.drain(); const work = (await f.claim())!;
  await f.t.mutation(internal.assistant.clearAnalysis, { ...f.run, requestId: first });
  await f.t.mutation(internal.assistant.finish, { ...f.run, error: 'Analysis wait ended.' });
  await f.t.run(ctx => writeProject(ctx, f.projectId, { aiRunning: true, aiRunId: 'next-run' }));
  const nextRun = { ...f.run, runId: 'next-run' };
  const repeated = await f.t.mutation(internal.assistant.requestAnalysis, { ...nextRun, assetId: f.assetId, mode: 'frames', frameRequest });
  expect(await f.t.query(internal.assistant.analysisRequest, { ...nextRun, requestId: repeated })).toMatchObject({ taskId: work.taskId, status: 'running' });
  const different = await f.t.mutation(internal.assistant.requestAnalysis, { ...nextRun, assetId: f.assetId, mode: 'frames', frameRequest: { ...frameRequest, end: 1.2 } });
  expect((await f.t.query(internal.assistant.analysisRequest, { ...nextRun, requestId: different })).taskId).not.toBe(work.taskId);
  await f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { frameInspection: evidence() } });
  expect(await f.t.query(internal.assistant.analysisRequest, { ...nextRun, requestId: repeated })).toMatchObject({ status: 'completed', frameInspection: evidence() });
  await f.owner.mutation(api.assistant.stop, { projectId: f.projectId }); await f.drain();
});

test('frame cache does not reuse another owner, another project or cancelled work', async () => {
  const f = await fixture();
  const otherProject = await f.owner.mutation(api.projects.create, { title: 'Other', aspectRatio: 'vertical' });
  const forbiddenTasks = await f.t.run(async ctx => Promise.all([
    { ownerId: 'stranger', projectId: f.projectId, status: 'completed' as const },
    { ownerId: 'owner', projectId: otherProject, status: 'completed' as const },
    { ownerId: 'owner', projectId: f.projectId, status: 'cancelled' as const },
  ].map(fields => ctx.db.insert('mediaTasks', { ...fields, assetId: f.assetId, kind: 'frames', frameRequest, frameInspection: evidence(), attempt: 1, progress: 100, createdAt: Date.now(), updatedAt: Date.now() }))));
  const requestId = await f.request();
  const request = await f.t.query(internal.assistant.analysisRequest, { ...f.run, requestId });
  expect(request.status).toBe('pending'); expect(forbiddenTasks).not.toContain(request.taskId); expect(request.frameInspection).toBeUndefined();
  await f.owner.mutation(api.assistant.stop, { projectId: f.projectId }); await f.drain();
});
