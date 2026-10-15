import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import type { Timeline } from '../lib/editor/types';

const modules = import.meta.glob('./**/*.ts');
const base: Timeline = {
  fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1 },
  clips: [{ id: 'caption', kind: 'caption', track: 2, start: 0, duration: 3, sourceStart: 0, text: 'Original', fontSize: 32 }],
};

test('manual timing saves after a live Claude styling update without losing either edit', async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Live edits', aspectRatio: 'landscape' });
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: base, expectedRevision: 0 });
  await t.run(ctx => writeProject(ctx,projectId, { aiRunning: true, aiRunId: 'live-run' }));
  await t.mutation(internal.assistant.apply, {
    projectId, ownerId: 'owner', runId: 'live-run', expectedRevision: 1,
    timeline: { ...base, clips: [{ ...base.clips[0], fontSize: 48 }] },
  });
  const manual = { ...base, clips: [{ ...base.clips[0], start: 1 }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: manual, expectedRevision: 1 });
  const saved = await owner.query(api.projects.get, { projectId });
  expect(saved.timeline?.clips[0]).toMatchObject({ start: 1, fontSize: 48 });
  expect(saved.revision).toBe(3);
  // The stale AI working snapshot still cannot overwrite this manual edit.
  await expect(t.mutation(internal.assistant.apply, {
    projectId, ownerId: 'owner', runId: 'live-run', expectedRevision: 2,
    timeline: { ...base, clips: [{ ...base.clips[0], text: 'Stale AI snapshot', fontSize: 48 }] },
  })).rejects.toThrow('timeline changed elsewhere');
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline?.clips[0]).toMatchObject({ start: 0, fontSize: 48 });
});

test('two open editors preserve independent changes and reject foreign or invalid writes', async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Two editors', aspectRatio: 'landscape' });
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: base, expectedRevision: 0 });
  await owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: { ...base, aspectRatio: 'square' }, expectedRevision: 1 });
  const next = { ...base, clips: [{ ...base.clips[0], text: 'Second editor' }] };
  const result = await owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: next, expectedRevision: 1 });
  expect(result.timeline).toMatchObject({ aspectRatio: 'square', clips: [{ text: 'Second editor' }] });
  await expect(t.withIdentity({ subject: 'stranger' }).mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: next, expectedRevision: 1 })).rejects.toThrow('Project not found');
  await expect(owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: next, expectedRevision: 100 })).rejects.toThrow('Invalid timeline revision');
  await expect(owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: { ...next, clips: [{ ...next.clips[0], duration: -1 }] }, expectedRevision: 1 })).rejects.toThrow('Clip timing');
  expect((await owner.query(api.projects.get, { projectId })).revision).toBe(3);
});

test('ordinary saves read each media source once while merged saves validate input and final result', async () => {
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Validation reads',aspectRatio:'landscape'});
  const assetId=await t.run(ctx=>ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'image',fileName:'image.png',contentType:'image/png',size:1,createdAt:0}));
  const timeline:Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'image',kind:'image',assetId,start:0,duration:1,sourceStart:0}]};
  const {saveTimeline}=await import('./projects');
  async function tracedSave(input:typeof timeline,expectedRevision:number,baseTimeline?:Timeline){
    return t.run(async ctx=>{
      let assetReads=0;
      const db=new Proxy(ctx.db,{get(target,property,receiver){
        if(property==='get')return(...args:unknown[])=>{if(args.at(-1)===assetId)assetReads++;return Reflect.apply(target.get,target,args);};
        return Reflect.get(target,property,receiver);
      }});
      const result=await (saveTimeline as unknown as {_handler:(ctx:unknown,args:unknown)=>Promise<{revision:number;timeline:Timeline}>})._handler({...ctx,db,auth:{getUserIdentity:async()=>({subject:'owner'})}},{projectId,timeline:input,expectedRevision,...(baseTimeline?{baseTimeline}:{})});
      return {assetReads,...result};
    });
  }
  expect(await tracedSave(timeline,0)).toMatchObject({assetReads:1,revision:1});
  const changed={...timeline,clips:[{...timeline.clips[0],duration:2}]};
  expect(await tracedSave(changed,0,timeline)).toMatchObject({assetReads:2,revision:2,timeline:{clips:[{duration:2}]}});
});

test('conflict merging validates retained fades against a concurrently shortened clip', async () => {
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Trim merge',aspectRatio:'landscape'});
  const assetId=await t.run(ctx=>ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'video',fileName:'video.mp4',contentType:'video/mp4',size:1,duration:3,createdAt:0}));
  const original:Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'video',kind:'video',assetId,start:0,duration:2,sourceStart:0}]};
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:original,expectedRevision:0});
  const current={...original,clips:[{...original.clips[0],visualFade:{fadeIn:1.8,fadeOut:0}}]};
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:current,expectedRevision:1});
  await expect(owner.mutation(api.projects.saveTimeline,{projectId,timeline:{...original,clips:[{...original.clips[0],duration:1}]},baseTimeline:original,expectedRevision:1})).rejects.toThrow('Visual fades together cannot exceed');
  expect(await owner.query(api.projects.get,{projectId})).toMatchObject({revision:2,timeline:{clips:[{duration:2,visualFade:{fadeIn:1.8,fadeOut:0}}]}});
});
