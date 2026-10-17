import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import {beforeEach,afterEach,expect,test,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {api,internal} from './_generated/api';
import schema from './schema';
import {type Timeline} from '../lib/editor/types';

beforeEach(()=>vi.stubEnv('BILLING_ENABLED','false'));
afterEach(()=>vi.unstubAllEnvs());
const before:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{id:'title',kind:'caption',track:1,start:0,duration:3,sourceStart:0,text:'Original words'}]};
async function setup(history:Timeline[]=[before]){
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Owned undo fixture',aspectRatio:'landscape'});
  const current={...before,clips:before.clips.map(c=>({...c,duration:1,text:'Edited words'}))};
  await t.run(ctx=>writeProject(ctx,projectId,{timeline:current,history,revision:4,aiRunning:true,aiEditing:false,aiRunId:'run',aiUndoRecorded:false}));
  return {t,owner,projectId,current,args:{projectId,ownerId:'owner',runId:'run',expectedRevision:4}};
}

test('active undo restores only the actual last snapshot and pops one history entry atomically',async()=>{
  const x=await setup();const result=await x.t.mutation(internal.assistant.undoLatestEdit,x.args);
  expect(result).toMatchObject({undone:true,revision:5,timeline:{clips:before.clips}});
  expect(await x.owner.query(api.projects.get,{projectId:x.projectId})).toMatchObject({revision:5,history:[],aiRunning:true,aiEditing:true,aiUndoRecorded:false,timeline:{clips:before.clips}});
});

test('empty saved history reports no undo and preserves the revision',async()=>{
  const x=await setup([]);const result=await x.t.mutation(internal.assistant.undoLatestEdit,x.args);
  expect(result).toMatchObject({undone:false,revision:4,timeline:{clips:x.current.clips}});
  expect((await x.owner.query(api.projects.get,{projectId:x.projectId})).aiEditing).toBe(false);
});

test('undo refuses wrong ownership, stale revisions/runs, stopped runs and published current-turn checkpoints',async()=>{
  const x=await setup();
  await expect(x.t.mutation(internal.assistant.undoLatestEdit,{...x.args,ownerId:'other'})).rejects.toThrow();
  await expect(x.t.mutation(internal.assistant.undoLatestEdit,{...x.args,runId:'old'})).rejects.toThrow('no longer active');
  await expect(x.t.mutation(internal.assistant.undoLatestEdit,{...x.args,expectedRevision:3})).rejects.toThrow('changed elsewhere');
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunning:false}));
  await expect(x.t.mutation(internal.assistant.undoLatestEdit,x.args)).rejects.toThrow('no longer active');
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunning:true,aiUndoRecorded:true}));
  await expect(x.t.mutation(internal.assistant.undoLatestEdit,x.args)).rejects.toThrow('before making changes');
  expect(await x.owner.query(api.projects.get,{projectId:x.projectId})).toMatchObject({revision:4,history:[expect.objectContaining({clips:before.clips})],timeline:{clips:x.current.clips}});
});

test('a stored snapshot with unavailable source handles cannot bypass media validation during undo',async()=>{
  const x=await setup();
  await x.t.run(async ctx=>{
    const assetId=await ctx.db.insert('assets',{ownerId:'owner',projectId:x.projectId,kind:'video',fileName:'Owned.mp4',contentType:'video/mp4',size:1,duration:3,createdAt:1});
    await writeProject(ctx,x.projectId,{history:[{...before,clips:[{id:'video',kind:'video',assetId,track:1,start:0,duration:2,sourceStart:9}]}]});
  });
  await expect(x.t.mutation(internal.assistant.undoLatestEdit,x.args)).rejects.toThrow();
  expect(await x.owner.query(api.projects.get,{projectId:x.projectId})).toMatchObject({revision:4,timeline:{clips:x.current.clips}});
});
