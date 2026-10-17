import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import stripeTest from '@convex-dev/stripe/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `https://test.clerk.accounts.dev|${subject}` });
const videoRequest = { start: 0.5, end: 2.5, question: 'Where is a visible punch rather than dialogue?' };
const videoInspection = { ...videoRequest, summary: 'One apparent punch.', uncertainty: 'Contact is partly obscured.', matches: [{ start: 0.7, end: 1.2, description: 'A fist moves toward the other person; contact is partly obscured.' }] };
const overview = { summary: 'The existing generic overview.', scenes: [{ start: 0, end: 3, description: 'Two people.', score: 0.4 }] };
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('RENDER_WORKER_SECRET', 'video-query-test-secret'); vi.stubEnv('BILLING_ENABLED', 'false'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function fixture() {
  const t = convexTest(schema, modules); workflowTest.register(t); stripeTest.register(t);
  const owner = t.withIdentity(identity('owner')), stranger = t.withIdentity(identity('stranger'));
  const projectId = await owner.mutation(api.projects.create, { title: 'Video query', aspectRatio: 'vertical' });
  const assetId = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['video']));
    return ctx.db.insert('assets', { ownerId: 'owner', projectId, storageId, fileName: 'video.mp4', kind: 'video', contentType: 'video/mp4', size: 5, duration: 3, createdAt: Date.now(), analysis: { understanding: overview } });
  });
  await t.run(ctx => writeProject(ctx,projectId, { aiRunning: true, aiRunId: 'run' }));
  const run = { projectId, ownerId: 'owner', runId: 'run' };
  const request = (question = videoRequest.question) => t.mutation(internal.assistant.requestAnalysis, { ...run, assetId, mode: 'video', videoRequest: { ...videoRequest, question } });
  // Workpool's housekeeping timers advance virtual time while draining; keep pending fixture requests live.
  const drain = async () => {await t.finishAllScheduledFunctions(vi.runAllTimers);await t.run(async ctx=>{for(const request of await ctx.db.query('analysisRequests').withIndex('by_projectId',q=>q.eq('projectId',projectId)).take(16))if(request.status==='pending'||request.status==='running')await ctx.db.patch(request._id,{expiresAt:Date.now()+240000});});};
  const claim = () => t.mutation(api.mediaTasks.claim, { workerSecret: 'video-query-test-secret' });
  return { t, owner, stranger, projectId, assetId, run, request, drain, claim };
}

test('a native video question reaches the worker and saves an answer separately from the overview', async () => {
  const f = await fixture(), requestId = await f.request(); await f.drain();
  const work = (await f.claim())!;
  expect(work.kind).toBe('video'); expect(work.videoRequest).toEqual(videoRequest);
  await f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { videoInspection } }); await f.drain();
  expect(await f.t.query(internal.assistant.analysisRequest, { ...f.run, requestId })).toMatchObject({ status: 'completed', videoInspection });
  expect((await f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId })).analysis?.understanding).toEqual(overview);
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline?.clips ?? []).toEqual([]);
});

test('native video requests enforce project ownership, current AI run and source ranges', async () => {
  const f = await fixture();
  const args = { ...f.run, assetId: f.assetId, mode: 'video' as const, videoRequest };
  await expect(f.t.mutation(internal.assistant.requestAnalysis, { ...args, ownerId: 'stranger' })).rejects.toThrow('Project not found');
  await expect(f.t.mutation(internal.assistant.requestAnalysis, { ...args, runId: 'old-run' })).rejects.toThrow('no longer active');
  for (const range of [{ start: -1, end: 1 }, { start: 1, end: 1 }, { start: 0, end: 4 }]) await expect(f.t.mutation(internal.assistant.requestAnalysis, { ...args, videoRequest: { ...videoRequest, ...range } })).rejects.toThrow('source window');
  await expect(f.t.mutation(internal.assistant.requestAnalysis, { ...args, videoRequest: { ...videoRequest, question: ' ' } })).rejects.toThrow('question');
  await expect(f.owner.mutation(api.mediaTasks.start, { projectId: f.projectId, assetId: f.assetId, kind: 'video' })).rejects.toThrow('scoped AI question');
  const otherProject = await f.owner.mutation(api.projects.create, { title: 'Other', aspectRatio: 'square' });
  await f.t.run(ctx => ctx.db.patch(f.assetId, { projectId: otherProject }));
  await expect(f.request()).rejects.toThrow('suitable media');
});

test('different video questions remain independent and zero matches is a completed answer', async () => {
  const f = await fixture(), first = await f.request(), second = await f.request('Is a sword visible?');
  const firstRequest = await f.t.query(internal.assistant.analysisRequest, { ...f.run, requestId: first });
  const secondRequest = await f.t.query(internal.assistant.analysisRequest, { ...f.run, requestId: second });
  expect(firstRequest.taskId).not.toBe(secondRequest.taskId);
  await f.drain(); const work = (await f.claim())!;
  await expect(f.stranger.query(api.mediaTasks.get, { taskId: work.taskId })).rejects.toThrow('not found');
  await expect(f.t.query(api.mediaTasks.get, { taskId: work.taskId })).rejects.toThrow('Authentication required');
  const empty = { ...videoInspection, summary: 'No matching punch is visible in this window.', uncertainty: '', matches: [] };
  await f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { videoInspection: empty } });
  expect(await f.t.query(internal.assistant.analysisRequest, { ...f.run, requestId: first })).toMatchObject({ status: 'completed', videoInspection: empty });
  expect(await f.t.query(internal.assistant.analysisRequest, { ...f.run, requestId: second })).not.toHaveProperty('videoInspection');
  await f.owner.mutation(api.assistant.stop, { projectId: f.projectId }); await f.drain();
});

test('wrong leases, wrong questions, invalid timestamps and stopped-run worker writes cannot publish evidence', async () => {
  const f = await fixture(); await f.request(); await f.drain(); const work = (await f.claim())!;
  const args = { taskId: work.taskId, leaseToken: work.leaseToken, result: { videoInspection } };
  await expect(f.t.mutation(api.mediaTasks.complete, { ...args, leaseToken: 'wrong' })).rejects.toThrow('lease');
  const wrongQuestion = { ...videoInspection, question: 'A different question' };
  const outsideWindow = { ...videoInspection, matches: [{ start: 0.1, end: 1, description: 'Outside the requested window.' }] };
  await expect(f.t.mutation(api.mediaTasks.complete, { ...args, result: { videoInspection: wrongQuestion } })).rejects.toThrow('requested question');
  await expect(f.t.mutation(api.mediaTasks.complete, { ...args, result: { videoInspection: outsideWindow } })).rejects.toThrow('requested source window');
  await expect(f.t.mutation(api.mediaTasks.complete, { ...args, result: { videoInspection, analysis: { understanding: overview } } })).rejects.toThrow('video evidence only');
  await f.owner.mutation(api.assistant.stop, { projectId: f.projectId });
  await expect(f.t.mutation(api.mediaTasks.complete, args)).rejects.toThrow('lease'); await f.drain();
});

test('timed-out video inspection saves background evidence and a later identical question reuses it without new work',async()=>{
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const f=await fixture(),requestId=await f.request();await f.drain();const work=(await f.claim())!;
  // The action's bounded wait clears its request before finishing with timeout.
  await f.t.mutation(internal.assistant.clearAnalysis,{...f.run,requestId});
  await f.t.mutation(internal.assistant.finish,{...f.run,error:'The background job will save results.'});
  await f.t.mutation(api.mediaTasks.complete,{taskId:work.taskId,leaseToken:work.leaseToken,result:{videoInspection}});await f.drain();
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'next-run'}));
  const nextRun={...f.run,runId:'next-run'};
  const cachedId=await f.t.mutation(internal.assistant.requestAnalysis,{...nextRun,assetId:f.assetId,mode:'video',videoRequest});
  expect(await f.t.query(internal.assistant.analysisRequest,{...nextRun,requestId:cachedId})).toMatchObject({status:'completed',taskId:work.taskId,videoInspection});
  expect(await f.claim()).toBeNull();
  const tasks=await f.t.run(ctx=>ctx.db.query('mediaTasks').withIndex('by_asset_kind',q=>q.eq('assetId',f.assetId).eq('kind','video')).collect());
  expect(tasks).toHaveLength(1);
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline?.clips??[]).toEqual([]);
});

test('a repeated question reattaches an in-flight detached task while different windows still require their own evidence',async()=>{
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const f=await fixture(),requestId=await f.request();await f.drain();const work=(await f.claim())!;
  await f.t.mutation(internal.assistant.clearAnalysis,{...f.run,requestId});
  await f.t.mutation(internal.assistant.finish,{...f.run,error:'Analysis wait expired.'});
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'next-run'}));
  const nextRun={...f.run,runId:'next-run'};
  const repeated=await f.t.mutation(internal.assistant.requestAnalysis,{...nextRun,assetId:f.assetId,mode:'video',videoRequest});
  expect(await f.t.query(internal.assistant.analysisRequest,{...nextRun,requestId:repeated})).toMatchObject({taskId:work.taskId,status:'running'});
  const different=await f.t.mutation(internal.assistant.requestAnalysis,{...nextRun,assetId:f.assetId,mode:'video',videoRequest:{...videoRequest,end:2}});
  expect((await f.t.query(internal.assistant.analysisRequest,{...nextRun,requestId:different})).taskId).not.toBe(work.taskId);
  await f.t.mutation(api.mediaTasks.complete,{taskId:work.taskId,leaseToken:work.leaseToken,result:{videoInspection}});
  expect(await f.t.query(internal.assistant.analysisRequest,{...nextRun,requestId:repeated})).toMatchObject({status:'completed',videoInspection});
  await f.owner.mutation(api.assistant.stop,{projectId:f.projectId});await f.drain();
});

test('already-running work from the old timeout handler can save strict evidence after its request was removed',async()=>{
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const f=await fixture(),requestId=await f.request();await f.drain();const work=(await f.claim())!;
  await f.t.run(async ctx=>{await ctx.db.delete(requestId);await writeProject(ctx,f.projectId,{aiRunning:false});});
  await f.t.mutation(api.mediaTasks.complete,{taskId:work.taskId,leaseToken:work.leaseToken,result:{videoInspection}});await f.drain();
  expect(await f.t.run(ctx=>ctx.db.get(work.taskId))).toMatchObject({status:'completed',videoInspection});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline?.clips??[]).toEqual([]);
});
