/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject:string) => ({ subject, issuer:'https://test.clerk.accounts.dev', tokenIdentifier:`test|${subject}` });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('BILLING_ENABLED','false'); vi.stubEnv('RENDER_WORKER_SECRET','upload-overview-worker');
  vi.stubEnv('MEDIA_WORKER_URL','https://media.example.com'); vi.stubEnv('MEDIA_SIGNING_SECRET','upload-overview-signing');
  vi.stubGlobal('fetch',vi.fn(async (_url,init) => {
    const command = JSON.parse(init.body);
    return new Response(JSON.stringify(command.action === 'create' ? { uploadId:'multipart-fixture' } : { size:128,contentType:'video/mp4' }),{status:200});
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test('a completed public video upload queues one overview, saves grounded suggestions, and leaves the timeline intact',async () => {
  const t=convexTest(schema,modules); workflowTest.register(t);
  const owner=t.withIdentity(identity('owner')), stranger=t.withIdentity(identity('stranger'));
  const projectId=await owner.mutation(api.projects.create,{title:'Uploaded footage',aspectRatio:'vertical'});
  const uploaded=await owner.action(api.r2.start,{projectId,fileName:'walk.mp4',contentType:'video/mp4',kind:'video',size:128,duration:12,width:1920,height:1080});
  const finish={uploadId:uploaded.uploadId,parts:[{partNumber:1,etag:'uploaded-part'}]};
  await expect(stranger.action(api.r2.complete,finish)).rejects.toThrow('another user');
  const assetId=(await owner.action(api.r2.complete,finish))!;
  expect(await owner.action(api.r2.complete,finish)).toBe(assetId);
  const jobs=await owner.query(api.mediaTasks.list,{projectId});
  expect(jobs.map(job=>job.kind).sort()).toEqual(['extract','understand']);
  expect((await owner.query(api.assets.get,{projectId,assetId})).analysis).toBeUndefined();
  const before=await owner.query(api.projects.get,{projectId});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const work=await Promise.all([t.mutation(api.mediaTasks.claim,{workerSecret:'upload-overview-worker'}),t.mutation(api.mediaTasks.claim,{workerSecret:'upload-overview-worker'})]);
  const overview=work.find(task=>task?.kind==='understand')!;
  const understanding={summary:'A person walks to a lookout and points at the view.',scenes:[{start:0,end:12,description:'Walks toward a lookout, then points toward the landscape.',score:0.8}],suggestions:[{label:'Open on the reveal',prompt:'Use the moment where the person points toward the landscape as the opening.',start:7,end:11},{label:'Keep the walk and reveal',prompt:'Keep the walk into the lookout and the pointing gesture together.',start:2,end:11}]};
  await expect(t.mutation(api.mediaTasks.complete,{taskId:overview.taskId,leaseToken:overview.leaseToken,result:{analysis:{understanding:{...understanding,suggestions:[{...understanding.suggestions[0],end:13}]}}}})).rejects.toThrow('Invalid source edit suggestions');
  await t.mutation(api.mediaTasks.complete,{taskId:overview.taskId,leaseToken:overview.leaseToken,result:{analysis:{understanding}}});
  const saved=await owner.query(api.assets.get,{projectId,assetId});
  expect(saved.analysis?.understanding?.suggestions).toEqual(understanding.suggestions);
  expect(saved.analysisCompletedAt?.understand).toBeTypeOf('number');
  const after=await owner.query(api.projects.get,{projectId});
  expect(after.timeline).toEqual(before.timeline); expect(after.revision).toBe(before.revision);
  await expect(stranger.query(api.assets.get,{projectId,assetId})).rejects.toThrow('Project not found');
  const reused=await owner.mutation(api.projects.create,{title:'Reuse cached footage',aspectRatio:'vertical',assetIds:[assetId]});
  expect(await owner.query(api.mediaTasks.list,{projectId:reused})).toEqual([]);
  expect((await owner.query(api.assets.list,{projectId:reused}))[0].analysis?.understanding?.suggestions).toEqual(understanding.suggestions);
});
