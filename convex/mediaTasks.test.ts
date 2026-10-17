import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import stripeTest from '@convex-dev/stripe/test';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `https://test.clerk.accounts.dev|${subject}` });
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('RENDER_WORKER_SECRET', 'task-test-secret'); vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example.com'); vi.stubEnv('MEDIA_SIGNING_SECRET', 'media-test-secret'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function fixture() {
  const t = convexTest(schema, modules); workflowTest.register(t); stripeTest.register(t);
  const owner = t.withIdentity(identity('owner')), stranger = t.withIdentity(identity('stranger'));
  const projectId = await owner.mutation(api.projects.create, { title: 'Task fixture', aspectRatio: 'vertical' });
  const assetId = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['fixture'], { type: 'video/mp4' }));
    return ctx.db.insert('assets', { ownerId: 'owner', projectId, storageId, fileName: 'source.mp4', kind: 'video', contentType: 'video/mp4', size: 7, duration: 3, width: 180, height: 320, createdAt: Date.now() });
  });
  const start = (kind: 'extract' | 'transcribe' | 'shots' | 'beats') => owner.mutation(api.mediaTasks.start, { projectId, assetId, kind });
  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const claim = () => t.mutation(api.mediaTasks.claim, { workerSecret: 'task-test-secret' });
  return { t, owner, stranger, projectId, assetId, start, drain, claim };
}
const transcript = { segments: [{ start: 0, end: 1, text: 'Actual words' }], words: [] };

test('extraction queues Listening on the video with owned small audio and persists its transcript on the original source',async()=>{
  const f=await fixture(),taskId=await f.start('extract');await f.drain();const work=(await f.claim())!;
  const audioId=await f.t.run(async ctx=>{
    const storageId=await ctx.storage.store(new Blob(['audio'],{type:'audio/mp4'}));
    const id=await ctx.db.insert('assets',{ownerId:'owner',projectId:f.projectId,storageId,fileName:'prepared.m4a',kind:'audio',contentType:'audio/mp4',size:5,duration:3,createdAt:Date.now()});
    await ctx.db.patch(taskId,{outputAssetId:id});return id;
  });
  await f.t.mutation(api.mediaTasks.complete,{taskId,leaseToken:work.leaseToken,result:{audioAssetId:audioId,waveform:{peaks:'AA==',samplesPerSecond:100}}});await f.drain();
  const listening=(await f.claim())!;
  expect(listening).toMatchObject({kind:'transcribe',asset:{_id:f.assetId},transcriptionAsset:{_id:audioId,size:5}});
  expect(await f.start('transcribe')).toBe(listening.taskId);
  await f.t.mutation(api.mediaTasks.complete,{taskId:listening.taskId,leaseToken:listening.leaseToken,result:{analysis:{transcript}}});await f.drain();
  expect((await f.owner.query(api.assets.get,{projectId:f.projectId,assetId:f.assetId})).analysis?.transcript).toEqual(transcript);
  expect((await f.owner.query(api.assets.get,{projectId:f.projectId,assetId:audioId})).analysis?.transcript).toBeUndefined();
});

test('silent extraction finishes without a Listening task, and foreign linked audio never reaches a worker',async()=>{
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const silent=await fixture(),silentTask=await silent.start('extract');await silent.drain();const silentWork=(await silent.claim())!;
  await silent.t.mutation(api.mediaTasks.complete,{taskId:silentTask,leaseToken:silentWork.leaseToken,result:{}});await silent.drain();
  expect(await silent.claim()).toBeNull();
  expect(await silent.owner.query(api.assets.get,{projectId:silent.projectId,assetId:silent.assetId})).toMatchObject({audioExtracted:true});
  const f=await fixture();
  await f.t.run(async ctx=>{
    const audioId=await ctx.db.insert('assets',{ownerId:'stranger',projectId:f.projectId,fileName:'foreign.m4a',kind:'audio',contentType:'audio/mp4',size:5,createdAt:Date.now()});
    await ctx.db.patch(f.assetId,{audioAssetId:audioId,audioExtracted:true});
  });
  const invalidTask=await f.start('transcribe');await f.drain();
  expect(await f.claim()).toBeNull();
  expect(await f.owner.query(api.mediaTasks.get,{taskId:invalidTask})).toMatchObject({status:'failed',error:'Source media or the export snapshot is unavailable.'});await f.drain();
});

test('hosted processor wakes with claimable work on initial and retry attempts', async () => {
  const f = await fixture();
  vi.stubEnv('MEDIA_PROCESSOR_WAKE_URL', 'https://processor.example.com/wake');
  const readyAtWake: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    readyAtWake.push(await f.t.query(api.mediaTasks.ready, { workerSecret: 'task-test-secret' }));
    return new Response(null, { status: 202 });
  });

  const taskId = await f.start('transcribe');
  await f.drain();
  expect(readyAtWake).toEqual([`${taskId}:1`]);
  const first = (await f.claim())!;
  expect(first.taskId).toBe(taskId);

  await f.t.mutation(api.mediaTasks.fail, { taskId, leaseToken: first.leaseToken, error: 'Transient disconnect', retryable: true });
  await f.drain();
  expect(readyAtWake).toEqual([`${taskId}:1`, `${taskId}:2`]);
  const retry = (await f.claim())!;
  expect(retry.taskId).toBe(taskId);

  await f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: retry.leaseToken, result: { analysis: { transcript } } });
  await f.drain();
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'completed', attempt: 2 });
});

test('video imports enforce ownership and billing, dedupe active URLs and create projects atomically', async () => {
  const f = await fixture();
  await expect(f.stranger.mutation(api.mediaTasks.importVideo, { projectId: f.projectId, url: 'https://cdn.example.com/video.mp4' })).rejects.toThrow('Project not found');
  await expect(f.owner.mutation(api.mediaTasks.importVideo, { url: 'https://localhost/video.mp4' })).rejects.toThrow('public');
  expect(await f.owner.query(api.projects.list, {})).toHaveLength(1);
  const first = await f.owner.mutation(api.mediaTasks.importVideo, { projectId: f.projectId, url: 'https://youtu.be/BaW_jenozKc' });
  expect(await f.owner.mutation(api.mediaTasks.importVideo, { projectId: f.projectId, url: 'https://youtube.com/watch?v=BaW_jenozKc' })).toEqual(first);
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fixture'); vi.stubEnv('STRIPE_PRO_PRICE_ID', 'price_fixture'); vi.stubEnv('APP_ORIGIN', 'http://localhost:3001');
  await expect(f.owner.mutation(api.mediaTasks.importVideo, { url: 'https://cdn.example.com/video.mp4' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  vi.stubEnv('BILLING_ENABLED', 'false');
  await f.drain();
});

test('active imports outside the recent task window still enforce the three-import limit', async () => {
  const f = await fixture();
  await f.t.run(async ctx => {
    for (const [index,status] of (['queued','running','retrying'] as const).entries()) await ctx.db.insert('mediaTasks', { ownerId:'owner',projectId:f.projectId,kind:'import',sourceUrl:`https://cdn.example.com/old-${index}.mp4`,status,attempt:1,progress:0,createdAt:Date.now()-1000,updatedAt:Date.now() });
    for (let index=0;index<40;index++) await ctx.db.insert('mediaTasks', { ownerId:'owner',projectId:f.projectId,assetId:f.assetId,kind:'transcribe',status:'completed',attempt:1,progress:100,createdAt:Date.now(),updatedAt:Date.now() });
  });
  await expect(f.owner.mutation(api.mediaTasks.importVideo,{projectId:f.projectId,url:'https://cdn.example.com/fourth.mp4'})).rejects.toThrow('Wait for the current video imports');
});

test('active imports outside the recent task window still deduplicate URLs in every active status', async () => {
  const f=await fixture();
  const imports=await f.t.run(async ctx=>{
    const ids=[];
    for(const [index,status] of (['queued','running','retrying'] as const).entries())ids.push(await ctx.db.insert('mediaTasks',{ownerId:'owner',projectId:f.projectId,kind:'import',sourceUrl:`https://cdn.example.com/old-${index}.mp4`,status,attempt:1,progress:0,createdAt:Date.now()-1000,updatedAt:Date.now()}));
    for(let index=0;index<40;index++)await ctx.db.insert('mediaTasks',{ownerId:'owner',projectId:f.projectId,assetId:f.assetId,kind:'waveform',status:'completed',attempt:1,progress:100,createdAt:Date.now(),updatedAt:Date.now()});
    return ids;
  });
  for(const [index,taskId] of imports.entries())expect(await f.owner.mutation(api.mediaTasks.importVideo,{projectId:f.projectId,url:`https://cdn.example.com/old-${index}.mp4`})).toEqual({projectId:f.projectId,taskId});
  expect(await f.t.run(ctx=>ctx.db.query('mediaTasks').withIndex('by_project_createdAt',q=>q.eq('projectId',f.projectId)).collect())).toHaveLength(43);
});

test('stored imports survive retries, append to the latest timeline once, and prepare audio in the background', async () => {
  const f = await fixture();
  const { taskId } = await f.owner.mutation(api.mediaTasks.importVideo, { projectId: f.projectId, url: 'https://cdn.example.com/video.mp4' });
  await f.drain(); const first = (await f.claim())!;
  expect(first.sourceUrl).toBe('https://cdn.example.com/video.mp4');
  await expect(f.t.query(internal.r2.authorize, { projectId: f.projectId, taskId, leaseToken: first.leaseToken, kind: 'audio', contentType: 'audio/mp4' })).rejects.toThrow('cannot upload');
  expect(await f.t.query(internal.r2.authorize, { projectId: f.projectId, taskId, leaseToken: first.leaseToken, kind: 'video', contentType: 'video/mp4' })).toBe('owner');
  await f.t.run(ctx => ctx.db.patch(taskId, { outputAssetId: f.assetId }));
  await f.t.mutation(api.mediaTasks.fail, { taskId, leaseToken: first.leaseToken, error: 'Disconnected after storing output', retryable: true }); await f.drain();
  const retry = (await f.claim())!; expect(retry.outputAssetId).toBe(f.assetId);
  // This edit happens after the worker started; import completion must retain it.
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 0, timeline: { fps: 30, aspectRatio: 'square', clips: [{ id: 'human-title', kind: 'graphic', text: 'Keep this edit', start: 0, duration: 1, sourceStart: 0 }] } });
  const complete = { taskId, leaseToken: retry.leaseToken, result: {} };
  await f.t.mutation(api.mediaTasks.complete, complete); await f.t.mutation(api.mediaTasks.complete, complete); await f.drain();
  const project = await f.owner.query(api.projects.get, { projectId: f.projectId });
  expect(project.timeline?.aspectRatio).toBe('square');
  expect(project.timeline?.clips).toHaveLength(2);
  expect(project.timeline?.clips.find(clip=>clip.assetId===f.assetId)).toMatchObject({ start: 1, duration: 3 });
  expect((await f.claim())?.kind).toBe('extract');
});

test('imports cannot complete with another user’s asset and stale leases cannot write', async () => {
  const f = await fixture();
  const { taskId } = await f.owner.mutation(api.mediaTasks.importVideo, { projectId: f.projectId, url: 'https://cdn.example.com/video.mp4' });
  await f.drain(); const work = (await f.claim())!;
  await f.t.run(async ctx => { await ctx.db.patch(f.assetId, { ownerId: 'stranger' }); await ctx.db.patch(taskId, { outputAssetId: f.assetId }); });
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: {} })).rejects.toThrow('not been stored');
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: 'wrong', result: {} })).rejects.toThrow('lease');
  await f.t.mutation(api.mediaTasks.fail, { taskId, leaseToken: work.leaseToken, error: 'Invalid output', retryable: false }); await f.drain();
});

test('a workflow queues once, accepts a scoped result, and completion is idempotent', async () => {
  const f = await fixture(), taskId = await f.start('transcribe');
  expect(await f.start('transcribe')).toBe(taskId);
  await f.drain();
  const work = (await f.claim())!;
  expect(work.taskId).toBe(taskId); expect(await f.claim()).toBeNull();
  const args = { taskId, leaseToken: work.leaseToken, result: { analysis: { transcript } } };
  await f.t.mutation(api.mediaTasks.complete, args); await f.t.mutation(api.mediaTasks.complete, args);
  await f.drain();
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'completed', attempt: 1, progress: 100 });
  expect((await f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId })).analysis?.transcript).toEqual(transcript);
});
test('shot completion preserves verified video PTS coverage inside a longer audio/container duration', async () => {
  const f = await fixture(), taskId = await f.start('shots'); await f.drain();
  const work = (await f.claim())!;
  const shots = { fps: 30, sourceTiming: { basis: 'pts' as const, videoStart: 0, videoEnd: 2, frameCount: 60 }, shots: [{ start: 0, end: 1, startFrame: 0, endFrame: 30 }, { start: 1, end: 2, startFrame: 30, endFrame: 60 }] };
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { shots: { ...shots, sourceTiming: { ...shots.sourceTiming, frameCount: 61 } } } } })).rejects.toThrow('Invalid shot boundaries');
  await f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { shots } } }); await f.drain();
  const saved = await f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId });
  expect(saved.duration).toBe(3);
  expect(saved.analysis?.shots).toEqual(shots);
  expect(saved.analysisCompletedAt?.shots).toBeTypeOf('number');
});

test('an expired worker lease retries and rejects the former worker', async () => {
  const f = await fixture(), taskId = await f.start('transcribe'); await f.drain();
  const first = (await f.claim())!;
  await f.t.run(ctx => ctx.db.patch(taskId, { leaseExpiresAt: Date.now() - 1 }));
  await f.t.mutation(internal.mediaTasks.expire, { taskId, leaseToken: first.leaseToken });
  await f.drain();
  const second = (await f.claim())!;
  expect(second.taskId).toBe(taskId); expect(second.leaseToken).not.toBe(first.leaseToken);
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ attempt: 2, status: 'running' });
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: first.leaseToken, result: { analysis: { transcript } } })).rejects.toThrow('lease');
  await f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: second.leaseToken, result: { analysis: { transcript } } }); await f.drain();
});

test('worker credentials, ownership and result validation are enforced', async () => {
  const f = await fixture(), taskId = await f.start('transcribe'); await f.drain();
  await expect(f.stranger.query(api.mediaTasks.get, { taskId })).rejects.toThrow('not found');
  await expect(f.stranger.mutation(api.mediaTasks.start, { projectId: f.projectId, assetId: f.assetId, kind: 'transcribe' })).rejects.toThrow('Project not found');
  await expect(f.t.mutation(api.mediaTasks.claim, { workerSecret: 'wrong' })).rejects.toThrow('authentication');
  const work = (await f.claim())!;
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).not.toHaveProperty('leaseToken');
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { transcript: { segments: [{ start: 2, end: 10, text: 'Out of range' }], words: [] } } } })).rejects.toThrow('timing');
  await expect(f.t.query(internal.r2.authorize, { projectId: f.projectId, taskId, leaseToken: work.leaseToken, kind: 'video', contentType: 'video/mp4' })).rejects.toThrow('cannot upload');
  await f.t.mutation(api.mediaTasks.fail, { taskId, leaseToken: work.leaseToken, error: 'Invalid source', retryable: false }); await f.drain();
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'failed', attempt: 1 });
});

test('retry exhaustion fails the export instead of leaving it rendering forever', async () => {
  const f = await fixture();
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 0, timeline: { fps: 30, aspectRatio: 'vertical', clips: [{ id: 'title', kind: 'graphic', text: 'Snapshot', start: 0, duration: 1, sourceStart: 0 }] } });
  const jobId = await f.owner.mutation(api.renders.start, { projectId: f.projectId, resolution: 720, fps: 30, quality: 'standard' });
  await f.drain();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const work = (await f.claim())!;
    await f.t.mutation(api.mediaTasks.fail, { taskId: work.taskId, leaseToken: work.leaseToken, error: 'Renderer unavailable', retryable: true });
    await f.drain();
  }
  expect(await f.owner.query(api.renders.get, { jobId })).toMatchObject({ status: 'failed', error: 'Renderer unavailable' });
  expect(await f.claim()).toBeNull();
});

test('exports use their saved snapshot and reuse a previously stored MP4 on retry', async () => {
  const f = await fixture();
  const first = { fps: 30, aspectRatio: 'vertical' as const, clips: [{ id: 'title', kind: 'graphic' as const, text: 'Original', start: 0, duration: 1, sourceStart: 0 }] };
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 0, timeline: first });
  const jobId = await f.owner.mutation(api.renders.start, { projectId: f.projectId, resolution: 720, fps: 30, quality: 'standard' });
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 1, timeline: { ...first, clips: [{ ...first.clips[0], text: 'Later edit' }] } });
  await f.drain(); const work = (await f.claim())!;
  expect(work.render?.timeline.clips[0].text).toBe('Original');
  await f.t.run(ctx => ctx.db.patch(jobId, { outputR2Key: 'media/owner/test/finished.mp4' }));
  await f.t.mutation(api.mediaTasks.fail, { taskId: work.taskId, leaseToken: work.leaseToken, error: 'Lost connection after storing output', retryable: true }); await f.drain();
  const retry = (await f.claim())!; expect(retry.outputStored).toBe(true);
  await f.t.mutation(api.mediaTasks.complete, { taskId: retry.taskId, leaseToken: retry.leaseToken, result: {} }); await f.drain();
  expect(await f.owner.query(api.renders.get, { jobId })).toMatchObject({ status: 'completed', progress: 100 });
});

test('stopping an AI request cancels its analysis and prevents later worker writes', async () => {
  const f = await fixture(); await f.t.run(ctx => writeProject(ctx,f.projectId, { aiRunning: true, aiRunId: 'run' }));
  const requestId = await f.t.mutation(internal.assistant.requestAnalysis, { projectId: f.projectId, ownerId: 'owner', runId: 'run', assetId: f.assetId, mode: 'transcribe' });
  await f.drain(); await f.t.run(ctx=>ctx.db.patch(requestId,{expiresAt:Date.now()+240000})); const work = (await f.claim())!;
  await f.owner.mutation(api.assistant.stop, { projectId: f.projectId });
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { analysis: { transcript } } })).rejects.toThrow('lease');
  expect(await f.t.run(ctx => ctx.db.get(requestId))).toBeNull(); await f.drain();
});


test('chat activity ignores background work and follows only pending analysis in the current turn', async () => {
  const f = await fixture();
  await f.t.run(async ctx => {
    await writeProject(ctx,f.projectId, { aiRunning: true, aiRunId: 'greeting' });
    await ctx.db.insert('mediaTasks', { ownerId: 'owner', projectId: f.projectId, assetId: f.assetId, kind: 'understand', status: 'running', attempt: 1, progress: 10, createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.insert('analysisRequests', { ownerId: 'owner', projectId: f.projectId, assetId: f.assetId, aiRunId: 'previous-turn', mode: 'understand', status: 'running', createdAt: Date.now(), expiresAt: Date.now() + 240_000 });
  });
  expect(await f.owner.query(api.assistant.status, { projectId: f.projectId })).toMatchObject({ running: true, activity: null });
  const requestId = await f.t.run(ctx => ctx.db.insert('analysisRequests', { ownerId: 'owner', projectId: f.projectId, assetId: f.assetId, aiRunId: 'greeting', mode: 'understand', status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 240_000 }));
  expect(await f.owner.query(api.assistant.status, { projectId: f.projectId })).toMatchObject({ activity: 'Analyzing footage…' });
  await f.t.run(ctx => ctx.db.patch(requestId, { status: 'completed' }));
  expect(await f.owner.query(api.assistant.status, { projectId: f.projectId })).toMatchObject({ activity: null });
  await expect(f.stranger.query(api.assistant.status, { projectId: f.projectId })).rejects.toThrow();
});

test('worker phase heartbeats drive honest chat status and retries reset old progress', async () => {
  const f=await fixture(),taskId=await f.start('transcribe');await f.drain();const work=(await f.claim())!;
  await f.t.run(async ctx=>{
    await writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'phase-run'});
    const requestId=await ctx.db.insert('analysisRequests',{ownerId:'owner',projectId:f.projectId,assetId:f.assetId,aiRunId:'phase-run',mode:'transcribe',status:'running',taskId,createdAt:Date.now(),expiresAt:Date.now()+240000});
    await ctx.db.patch(taskId,{analysisRequestId:requestId});
  });
  for(const [activity,label] of [['downloading','Downloading footage…'],['sending-gemini','Sending to Gemini…'],['preparing-gemini','Preparing video…'],['analyzing','Analyzing footage…'],['retrying-analysis','Retrying analysis…']] as const){
    await f.t.mutation(api.mediaTasks.heartbeat,{taskId,leaseToken:work.leaseToken,progress:30,activity});
    expect(await f.owner.query(api.assistant.status,{projectId:f.projectId})).toMatchObject({activity:label,activityProgress:null});
  }
  const before=await f.owner.query(api.mediaTasks.get,{taskId});
  await f.t.mutation(api.mediaTasks.heartbeat,{taskId,leaseToken:work.leaseToken,progress:31});
  expect((await f.owner.query(api.mediaTasks.get,{taskId})).activityStartedAt).toBe(before.activityStartedAt);
  await f.t.mutation(api.mediaTasks.fail,{taskId,leaseToken:work.leaseToken,error:'Transient disconnect',retryable:true});await f.drain();
  expect(await f.owner.query(api.mediaTasks.get,{taskId})).toMatchObject({attempt:2,progress:0});
  expect(await f.owner.query(api.assistant.status,{projectId:f.projectId})).toMatchObject({activity:'Retrying analysis…',activityProgress:null});
});

test('compact claims return a lease only; owned snapshots are read separately and revoked leases are refused',async()=>{
  const f=await fixture(),taskId=await f.start('transcribe');await f.drain();
  const lease=(await f.t.mutation(api.mediaTasks.claim,{workerSecret:'task-test-secret',compact:true}))!;
  expect(Object.keys(lease).sort()).toEqual(['kind','leaseToken','projectId','taskId']);
  const snapshot=await f.t.query(api.mediaTasks.work,{taskId,leaseToken:lease.leaseToken});
  expect(snapshot.asset?._id).toBe(f.assetId);
  await expect(f.t.query(api.mediaTasks.work,{taskId,leaseToken:'wrong'})).rejects.toThrow('lease');
  await f.owner.mutation(api.mediaTasks.cancel,{taskId});
  await expect(f.t.query(api.mediaTasks.work,{taskId,leaseToken:lease.leaseToken})).rejects.toThrow('lease');await f.drain();
});
test.each(['missing','expired','stopped','old-run'] as const)('rejects %s AI analysis before worker claim',async condition=>{
  const f=await fixture();
  await f.t.run(async ctx=>{
    await writeProject(ctx,f.projectId,{aiRunning:condition!=='stopped',aiRunId:'current'});
    const requestId=await ctx.db.insert('analysisRequests',{ownerId:'owner',projectId:f.projectId,assetId:f.assetId,aiRunId:condition==='old-run'?'old':'current',mode:'understand',status:'pending',createdAt:Date.now(),expiresAt:Date.now()+(condition==='expired'?-1:60000)});
    await ctx.db.insert('mediaTasks',{ownerId:'owner',projectId:f.projectId,assetId:f.assetId,analysisRequestId:requestId,kind:'understand',status:'queued',claimable:true,attempt:1,progress:0,createdAt:Date.now(),updatedAt:Date.now()});
    if(condition==='missing')await ctx.db.delete(requestId);
  });
  expect(await f.claim()).toBeNull();
  expect((await f.owner.query(api.mediaTasks.list,{projectId:f.projectId}))[0].status).toBe('cancelled');
});
