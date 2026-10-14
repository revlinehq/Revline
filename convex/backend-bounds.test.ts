/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import schema from './schema';
import { api,internal } from './_generated/api';
import { completeDeletion } from '../lib/test-support/convex-deletion';
beforeEach(()=>{vi.stubEnv('BILLING_ENABLED','false');vi.stubEnv('RENDER_WORKER_SECRET','fixture-worker');});
afterEach(()=>vi.unstubAllEnvs());
test('unprepared tasks do not block prepared work and a leased task cannot be claimed twice',async()=>{
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Queue fixture',aspectRatio:'landscape'});
  const taskId=await t.run(async ctx=>{
    const storageId=await ctx.storage.store(new Blob(['owned media']));
    const assetId=await ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'video',fileName:'Owned.mp4',contentType:'video/mp4',size:11,duration:3,storageId,createdAt:0});
    for(let i=0;i<15;i++)await ctx.db.insert('mediaTasks',{ownerId:'owner',projectId,assetId,kind:'transcribe',status:'queued',claimable:false,attempt:0,progress:0,createdAt:i,updatedAt:i});
    return ctx.db.insert('mediaTasks',{ownerId:'owner',projectId,assetId,kind:'transcribe',status:'queued',claimable:true,workflowId:'fixture-workflow',attempt:1,progress:0,createdAt:16,updatedAt:16});
  });
  expect(await t.query(api.mediaTasks.ready,{workerSecret:'fixture-worker'})).toBe(`${taskId}:1`);
  const claims=await Promise.all([t.mutation(api.mediaTasks.claim,{workerSecret:'fixture-worker'}),t.mutation(api.mediaTasks.claim,{workerSecret:'fixture-worker'})]);
  expect(claims.filter(Boolean)).toHaveLength(1);expect(claims.find(Boolean)?.taskId).toBe(taskId);
});
test('projects with over a thousand task records hide immediately and delete through bounded pages',async()=>{
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Long history',aspectRatio:'landscape'});
  await t.run(async ctx=>{for(let i=0;i<1050;i++)await ctx.db.insert('mediaTasks',{ownerId:'owner',projectId,kind:'transcribe',status:'completed',attempt:1,progress:100,createdAt:i,updatedAt:i});});
  await owner.mutation(api.projects.remove,{projectId});
  await expect(owner.query(api.projects.get,{projectId})).rejects.toThrow('Project not found');
  expect(await owner.query(api.projects.list,{})).toEqual([]);
  await completeDeletion(t,projectId);
  expect(await t.run(ctx=>ctx.db.query('mediaTasks').collect())).toEqual([]);
  expect(await t.run(ctx=>ctx.db.get(projectId))).toBeNull();
});
test('history pruning retains fresh and active processing records',async()=>{
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Cleanup fixture',aspectRatio:'landscape'});
  await t.run(async ctx=>{for(const [status,updatedAt] of [['completed',0],['failed',0],['running',0],['completed',Date.now()]] as const)await ctx.db.insert('mediaTasks',{ownerId:'owner',projectId,kind:'transcribe',status,attempt:1,progress:50,createdAt:0,updatedAt});});
  await t.mutation(internal.mediaTasks.pruneFinished,{});
  const rows=await t.run(ctx=>ctx.db.query('mediaTasks').collect());expect(rows).toHaveLength(2);expect(rows.map(row=>row.status)).toEqual(['running','completed']);
});
