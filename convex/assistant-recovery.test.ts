import { writeProject,readProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

beforeEach(() => { vi.stubEnv('BILLING_ENABLED','false'); vi.stubEnv('ANTHROPIC_API_KEY','fixture-only'); vi.stubEnv('AI_GATEWAY_ENABLED','false'); vi.stubEnv('CLAUDE_MODEL','claude-sonnet-5-5'); });
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t=convexTest(schema,import.meta.glob('./**/*.ts')); agentTest.register(t);
  const owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Recovery fixture',aspectRatio:'landscape'});
  const read=()=>t.run(ctx=>readProject(ctx,projectId));
  const send=(prompt:string)=>owner.mutation(api.assistant.send,{projectId,prompt});
  return {t,owner,projectId,read,send};
}

test('responding stays unlocked until a guarded editing signal and stop or completion clears it', async () => {
  const f = await fixture();
  const status = () => f.owner.query(api.assistant.status, { projectId: f.projectId });
  await f.send('Yo');
  const first = (await f.read())!;
  const run = { projectId: f.projectId, ownerId: 'owner', runId: first.aiRunId! };
  expect(await status()).toMatchObject({ running: true, editing: false, workflowActive: false });
  await expect(f.t.mutation(internal.assistant.beginEditing, { ...run, ownerId: 'stranger' })).rejects.toThrow('Project not found');
  await expect(f.t.mutation(internal.assistant.beginEditing, { ...run, runId: 'stale' })).rejects.toThrow('no longer active');
  expect(await status()).toMatchObject({ running: true, editing: false, workflowActive: false });
  await f.t.mutation(internal.assistant.beginEditing, run);
  await f.t.mutation(internal.assistant.beginEditing, run);
  expect(await status()).toMatchObject({ running: true, editing: true, workflowActive: true });
  await f.owner.mutation(api.assistant.stop, { projectId: f.projectId });
  expect(await status()).toMatchObject({ running: false, editing: false, workflowActive: false });
  expect((await f.read())?.aiEditing).toBe(false);
  await expect(f.t.mutation(internal.assistant.beginEditing, run)).rejects.toThrow('no longer active');
  await f.send('What can you do?');
  const next = (await f.read())!;
  expect(await status()).toMatchObject({ running: true, editing: false, workflowActive: false });
  const current = { ...run, runId: next.aiRunId! };
  await f.t.mutation(internal.assistant.beginEditing, current);
  await f.t.mutation(internal.assistant.finish, run);
  expect(await status()).toMatchObject({ running: true, editing: true, workflowActive: true });
  await f.t.mutation(internal.assistant.finish, current);
  expect(await status()).toMatchObject({ running: false, editing: false, workflowActive: false });
  expect((await f.read())?.aiEditing).toBe(false);
});

test('the current analysis workflow stays active through planning and applying, without locking later ordinary replies', async () => {
  const f = await fixture();
  const status = () => f.owner.query(api.assistant.status, { projectId: f.projectId });
  await f.send('Remove the quiet script-checking moments');
  const project = (await f.read())!;
  const run = { projectId: f.projectId, ownerId: 'owner', runId: project.aiRunId! };
  const request = await f.t.run(async ctx => {
    const assetId = await ctx.db.insert('assets', { projectId: f.projectId, ownerId: 'owner', kind: 'video', fileName: 'Owned footage.mp4', contentType: 'video/mp4', size: 1, duration: 5, createdAt: 0 });
    return ctx.db.insert('analysisRequests', { projectId: f.projectId, ownerId: 'owner', assetId, aiRunId: run.runId, mode: 'video', status: 'pending', createdAt: 0, expiresAt: Date.now() + 60_000 });
  });
  expect(await status()).toMatchObject({ running: true, editing: false, workflowActive: true, activity: 'Analyzing footage…' });
  await f.t.run(ctx => ctx.db.patch(request, { status: 'running' }));
  expect(await status()).toMatchObject({ running: true, editing: false, workflowActive: true });
  await f.t.run(ctx => ctx.db.patch(request, { status: 'completed' }));
  // A fresh query (including after client reload) derives the planning lock from
  // persisted run-scoped analysis, even when no analysis label is currently active.
  expect(await status()).toMatchObject({ running: true, editing: false, workflowActive: true, activity: null });
  await f.t.mutation(internal.assistant.beginEditing, run);
  expect(await status()).toMatchObject({ running: true, editing: true, workflowActive: true, activity: 'Applying edits…' });
  await f.t.mutation(internal.assistant.finish, run);
  expect(await status()).toMatchObject({ running: false, editing: false, workflowActive: false });
  // Old run evidence and an upload-time overview must not lock a new greeting.
  await f.t.run(async ctx => {
    const asset = (await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', 'owner').eq('projectId', f.projectId)).take(1))[0];
    for (const aiRunId of [run.runId, 'upload-preparation']) await ctx.db.insert('analysisRequests', { projectId: f.projectId, ownerId: 'owner', assetId: asset._id, aiRunId, mode: 'video', status: 'completed', createdAt: 0, expiresAt: Date.now() + 60_000 });
  });
  await f.send('Yo');
  expect(await status()).toMatchObject({ running: true, editing: false, workflowActive: false, activity: null });
  await expect(f.t.withIdentity({ subject: 'stranger' }).query(api.assistant.status, { projectId: f.projectId })).rejects.toThrow('Project not found');
});

test('failed run retains its request and saved revision, and a rephrased follow-up receives that recovery',async()=>{
  const f=await fixture(); await f.send('Make a hype edit ending on the reaction');
  const run=await f.read();
  await f.t.mutation(internal.assistant.apply,{projectId:f.projectId,ownerId:'owner',runId:run!.aiRunId!,expectedRevision:0,timeline:{fps:30,aspectRatio:'landscape',clips:[{id:'text',kind:'caption',track:1,start:0,duration:2,sourceStart:0,text:'Saved'}]}});
  await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:run!.aiRunId!,error:'Token safety stop',savedEdits:1});
  expect(await f.read()).toMatchObject({revision:1,aiRecovery:{requests:['Make a hype edit ending on the reaction'],revision:1,savedEdits:1,status:'failed'},timeline:{clips:[expect.objectContaining({text:'Saved'})]}});
  await f.send('Finish the ending softly');
  const scheduled=await f.t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
  expect(scheduled.at(-1)?.args[0].recovery).toMatchObject({requests:['Make a hype edit ending on the reaction'],savedEdits:1,revision:1});
  expect((await f.read())?.aiRequest?.prompt).toBe('Finish the ending softly');
});

test('stopping retains facts, a late old callback cannot stop the new run, and success clears recovery',async()=>{
  const f=await fixture(); await f.send('Add a title'); const old=await f.read();
  await f.owner.mutation(api.assistant.stop,{projectId:f.projectId});
  expect((await f.read())?.aiRecovery).toMatchObject({requests:['Add a title'],status:'stopped'});
  await f.send('Use smaller text'); const current=await f.read();
  await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:old!.aiRunId!,error:'Late old failure'});
  expect(await f.read()).toMatchObject({aiRunning:true,aiRunId:current!.aiRunId,aiRequest:{prompt:'Use smaller text'}});
  await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:current!.aiRunId!});
  expect((await f.read())?.aiRecovery).toBeUndefined(); expect((await f.read())?.aiRequest).toBeUndefined();
});

test('repeated failures bound follow-ups but retain the original goal; legacy errors do not invent one',async()=>{
  const f=await fixture();
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiError:'Old timeout'}));
  await f.send('Original goal'); expect((await f.read())?.aiRecovery?.requests).toEqual([]);
  for(const prompt of ['Original goal','follow-up one','follow-up two','follow-up three','follow-up four']) {
    const run=await f.read();
    await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:run!.aiRunId!,error:'Interrupted'});
    if(prompt==='follow-up four')break;
    const next=prompt==='Original goal'?'follow-up one':prompt==='follow-up one'?'follow-up two':prompt==='follow-up two'?'follow-up three':'follow-up four';
    await f.send(next);
  }
  expect((await f.read())?.aiRecovery?.requests).toEqual(['Original goal','follow-up two','follow-up three','follow-up four']);
});
