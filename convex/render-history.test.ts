import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { mediaUrl } from './lib/media_storage';
beforeEach(()=>vi.stubEnv('BILLING_ENABLED','false'));
afterEach(()=>vi.unstubAllEnvs());
test('export start ignores large finished history, stamps the saved revision and prevents a second active render',async()=>{
  const t=convexTest(schema,import.meta.glob('./**/*.ts'));workflowTest.register(t);
  const owner=t.withIdentity({subject:'owner'}),projectId=await owner.mutation(api.projects.create,{title:'Export history',aspectRatio:'landscape'});
  await t.run(async ctx=>{
    const timeline={fps:30,aspectRatio:'landscape' as const,clips:[{id:'text',kind:'caption' as const,start:0,duration:3,sourceStart:0,text:'Owned'}]};
    await writeProject(ctx,projectId,{timeline,revision:9});
    for(let i=0;i<520;i++)await ctx.db.insert('renderJobs',{projectId,ownerId:'owner',status:'completed',timeline,createdAt:i,updatedAt:i});
  });
  const jobId=await owner.mutation(api.renders.start,{projectId,resolution:720,fps:30,quality:'standard'});
  expect(await t.run(ctx=>ctx.db.get(jobId))).toMatchObject({sourceRevision:9,status:'queued'});
  await expect(owner.mutation(api.renders.start,{projectId,resolution:720,fps:30,quality:'standard'})).rejects.toThrow('already in progress');
});
test('read URLs are stable within a day and renew across the next day',async()=>{
  vi.stubEnv('MEDIA_WORKER_URL','https://fixture.invalid');vi.stubEnv('MEDIA_SIGNING_SECRET','fixture-only');
  const t=convexTest(schema,import.meta.glob('./**/*.ts'));
  const now=vi.spyOn(Date,'now');now.mockReturnValue(Date.UTC(2026,9,14,10));
  const first=await t.run(ctx=>mediaUrl(ctx,{r2Key:'owned/file'}));
  now.mockReturnValue(Date.UTC(2026,9,14,23));expect(await t.run(ctx=>mediaUrl(ctx,{r2Key:'owned/file'}))).toBe(first);
  now.mockReturnValue(Date.UTC(2026,9,15));expect(await t.run(ctx=>mediaUrl(ctx,{r2Key:'owned/file'}))).not.toBe(first);now.mockRestore();
});
