/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import { api,internal } from './_generated/api';
import schema from './schema';
import { writeProject,readProject } from './lib/project_data';
import { projectRun } from './lib/project_data';
const timeline={fps:30,aspectRatio:'landscape' as const,clips:[{id:'title',kind:'caption' as const,track:1,start:0,sourceStart:0,duration:2,text:'Original'}]};
beforeEach(()=>vi.stubEnv('BILLING_ENABLED','false'));afterEach(()=>vi.unstubAllEnvs());
test('legacy migration preserves undo and failed-run recovery while removing heavy fields from project records',async()=>{
  const t=convexTest(schema,import.meta.glob('./**/*.ts'));
  const projectId=await t.run(ctx=>ctx.db.insert('projects',{ownerId:'owner',title:'Legacy',aspectRatio:'landscape',createdAt:0,updatedAt:0,timeline,revision:5,history:[timeline],aiRunning:false,aiRunId:'old',aiRecovery:{requests:['Finish this edit'],status:'failed',runId:'old',revision:5,reason:'Stop',updatedAt:0}}));
  await t.mutation(internal.projectDataMigration.initialize,{});
  for(let page=0;page<3;page++)await t.mutation(internal.projectDataMigration.batch,{});
  const stored=await t.run(ctx=>ctx.db.get(projectId));expect(stored?.history).toBeUndefined();expect(stored?.aiRecovery).toBeUndefined();
  expect(await t.run(ctx=>readProject(ctx,projectId))).toMatchObject({history:[expect.objectContaining({clips:[expect.objectContaining({text:'Original',duration:2})]})],aiRecovery:{requests:['Finish this edit']}});
  expect(await t.withIdentity({subject:'owner'}).query(api.projects.list,{})).toMatchObject([{_id:projectId,clipCount:1,aiRunning:false}]);
});
test('append and undo reuse retained revision records; lightweight identity stays unchanged during edits',async()=>{
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'}),projectId=await owner.mutation(api.projects.create,{title:'Revision fixture',aspectRatio:'landscape'});
  await t.run(ctx=>writeProject(ctx,projectId,{timeline,history:[timeline]}));
  const identity=await t.run(ctx=>ctx.db.query('projectAccess').collect()),first=await t.run(ctx=>ctx.db.query('timelineRevisions').collect());
  await t.run(ctx=>writeProject(ctx,projectId,{history:[timeline,{...timeline,clips:[]}],revision:1}));
  const rows=await t.run(ctx=>ctx.db.query('timelineRevisions').collect());expect(rows[0]._id).toBe(first[0]._id);expect(rows).toHaveLength(2);
  expect(await t.run(ctx=>ctx.db.query('projectAccess').collect())).toEqual(identity);
  await t.run(ctx=>writeProject(ctx,projectId,{history:[timeline]}));expect((await t.run(ctx=>ctx.db.query('timelineRevisions').collect()))[0]._id).toBe(first[0]._id);
});
test('copied uploads share source observations, compact lists omit dense evidence, and explicit reads preserve it',async()=>{
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'}),projectId=await owner.mutation(api.projects.create,{title:'Original',aspectRatio:'landscape'});
  const assetId=await t.run(async ctx=>{const storageId=await ctx.storage.store(new Blob(['owned source']));return ctx.db.insert('assets',{projectId,ownerId:'owner',storageId,kind:'video',fileName:'Source.mp4',contentType:'video/mp4',duration:3,size:12,createdAt:0,analysis:{understanding:{summary:'Subject enters',scenes:[{start:0,end:2,score:.8,description:'Subject enters the frame'}],suggestions:[{start:0,end:2,label:'Entrance',prompt:'Highlight this entrance'}]},focus:[{time:0,x:.3,y:.4},{time:1,x:.6,y:.4}]}});});
  const copy=await owner.mutation(api.projects.create,{title:'Copy',aspectRatio:'landscape',assetIds:[assetId]});
  const sources=await t.run(ctx=>ctx.db.query('assets').collect());expect(sources).toHaveLength(2);expect(sources[0].analysisId).toBe(sources[1].analysisId);expect(sources.every(asset=>asset.analysis===undefined)).toBe(true);
  const list=await owner.query(api.assets.list,{projectId:copy});expect(list[0].analysis).not.toHaveProperty('focus');expect(list[0].analysis?.understanding?.suggestions).toHaveLength(1);
  const observed=await owner.query(api.assets.get,{projectId:copy,assetId:list[0]._id});expect(observed.analysis?.focus).toHaveLength(2);expect(observed.analysis?.understanding?.scenes[0].description).toBe('Subject enters the frame');
});
test('run polling reads only immutable identity and the small run record',async()=>{
  const tables:string[]=[];
  const ctx={db:{get:()=>{throw new Error('Polling must not load the project timeline');},query:(table:string)=>{tables.push(table);return {withIndex:()=>({unique:async()=>table==='projectAccess'?{projectId:'project',ownerId:'owner',historyStored:true}:{projectId:'project',ownerId:'owner',aiRunning:true,aiRunId:'run'}})};}}} as unknown as Parameters<typeof projectRun>[0];
  expect(await projectRun(ctx,'project' as Parameters<typeof projectRun>[1],'owner')).toMatchObject({aiRunId:'run',aiRunning:true});
  expect(tables).toEqual(['projectAccess','aiRuns']);
});
