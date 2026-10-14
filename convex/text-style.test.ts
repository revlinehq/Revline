/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import schema from './schema';
import { api,internal } from './_generated/api';
import { DEFAULT_TEXT_APPEARANCE } from '../lib/editor/text-style';
import type { Timeline } from '../lib/editor/types';

const modules=import.meta.glob('./**/*.ts');
beforeEach(()=>vi.stubEnv('BILLING_ENABLED','false'));
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'text-style-owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Text style regression',aspectRatio:'vertical'});
  const timeline:Timeline={fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{id:'caption',kind:'caption',track:1,start:1,duration:2,sourceStart:0,text:'Saved spoken words',fontFamily:'anton',fontSize:52,color:'#ffffff',background:'transparent',animation:'fade',textTemplate:{preset:'word-reveal',duration:2,offset:.2},transform:{x:.5,y:.5,scale:1,rotation:12,opacity:1},textStyle:{...DEFAULT_TEXT_APPEARANCE,strokeWidth:3,strokeColor:'#221122',shadowBlur:14,shadowX:4,shadowY:8,glowBlur:18,glowColor:'#aabbff'}}]};
  return {t,owner,projectId,timeline};
}

test('manual and AI text appearance saves retain words, timing, animation and editable share copies',async()=>{
  const f=await fixture();
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:f.timeline,expectedRevision:0});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline).toEqual(f.timeline);
  await f.t.run(ctx=>ctx.db.patch(f.projectId,{aiRunning:true,aiRunId:'text-run'}));
  const changed={...f.timeline,clips:f.timeline.clips.map(clip=>({...clip,textStyle:{...clip.textStyle!,glowBlur:0,shadowX:-20}}))};
  await f.t.mutation(internal.assistant.apply,{projectId:f.projectId,ownerId:'text-style-owner',runId:'text-run',expectedRevision:1,timeline:changed});
  await f.t.run(ctx=>ctx.db.patch(f.projectId,{aiRunning:false}));
  const saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
  expect(saved).toEqual(changed);
  expect({...saved.clips[0],textStyle:undefined}).toEqual({...f.timeline.clips[0],textStyle:undefined});
  const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId});
  const copier=f.t.withIdentity({subject:'text-copy-owner'}),copyId=await copier.mutation(api.timelineShares.useTimeline,{shareId});
  expect((await copier.query(api.projects.get,{projectId:copyId})).timeline).toEqual(saved);
  await expect(f.owner.query(api.projects.get,{projectId:copyId})).rejects.toThrow('Project not found');
});

test('raw text appearance rejects invalid colors, numeric bounds, missing fields and nontext clips',async()=>{
  const f=await fixture(),clip=f.timeline.clips[0];
  for(const patch of [{strokeWidth:21},{strokeWidth:-1},{shadowBlur:81},{shadowX:-101},{shadowY:101},{glowBlur:101},{glowBlur:NaN},{strokeColor:'red'},{shadowColor:'url(example)'},{glowColor:'linear-gradient(red,blue)'}]){
    await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,clips:[{...clip,textStyle:{...clip.textStyle!,...patch}}]},expectedRevision:0})).rejects.toThrow();
  }
  const incomplete={...clip.textStyle!};delete (incomplete as Partial<typeof incomplete>).glowColor;
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,clips:[{...clip,textStyle:incomplete}]},expectedRevision:0})).rejects.toThrow();
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,clips:[{...clip,fontFamily:'arbitrary-font' as typeof clip.fontFamily}]},expectedRevision:0})).rejects.toThrow();
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,tracks:{visual:0,overlay:0,audio:0,effects:1},clips:[{...clip,kind:'effect',effectPreset:'solid-color',text:undefined,textTemplate:undefined,transform:undefined,animation:undefined}]},expectedRevision:0})).rejects.toThrow(/text|caption/i);
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).revision).toBe(0);
});
