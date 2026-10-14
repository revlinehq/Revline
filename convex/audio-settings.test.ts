import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import schema from './schema';
import {api,internal} from './_generated/api';
import {DEFAULT_AUDIO_SETTINGS,configureAudio} from '../lib/editor/audio-settings';
import {splitClip} from '../lib/editor/operations';
import type {Timeline} from '../lib/editor/types';

const modules=import.meta.glob('./**/*.ts');
beforeEach(()=>vi.stubEnv('BILLING_ENABLED','false'));
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'audio-owner'}),projectId=await owner.mutation(api.projects.create,{title:'Audio regression',aspectRatio:'landscape'});
  const assetId=await t.run(ctx=>ctx.db.insert('assets',{ownerId:'audio-owner',projectId,kind:'audio',fileName:'Synthetic tone.wav',contentType:'audio/wav',size:1,duration:30,createdAt:Date.now()}));
  const timeline:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:0,overlay:0,audio:2,effects:0},clips:[{id:'music',kind:'audio',assetId,track:2,start:0,duration:10,sourceStart:3,volume:.8},{id:'voice',kind:'audio',assetId,track:1,start:2,duration:2,sourceStart:5,volume:.6}]};
  return {t,owner,projectId,timeline};
}
test('manual/AI audio controls persist through owned shared copies without changing source or timing',async()=>{
  const f=await fixture(),timeline=configureAudio(configureAudio(f.timeline,'voice',{role:'voice'}),'music',{role:'music',fadeIn:.5,fadeOut:1,ducking:{enabled:true,amount:.75,attack:.2,release:.4}});
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:0});
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'audio-run'}));
  const changed=configureAudio(timeline,'music',{ducking:{amount:.5}});
  await f.t.mutation(internal.assistant.apply,{projectId:f.projectId,ownerId:'audio-owner',runId:'audio-run',timeline:changed,expectedRevision:1});
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:false}));
  const saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;expect(saved).toEqual(changed);
  expect(saved.clips.map(({audio,...clip})=>clip)).toEqual(f.timeline.clips);
  const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId}),copier=f.t.withIdentity({subject:'audio-copy'}),copyId=await copier.mutation(api.timelineShares.useTimeline,{shareId});
  const copy=(await copier.query(api.projects.get,{projectId:copyId})).timeline!;expect(copy.clips.map(clip=>clip.audio)).toEqual(saved.clips.map(clip=>clip.audio));
  expect(copy.clips[0].assetId).not.toBe(saved.clips[0].assetId);
  await expect(f.owner.query(api.projects.get,{projectId:copyId})).rejects.toThrow('Project not found');
});
test('raw saves reject invalid roles/fades/ducking settings and nonaudio settings',async()=>{
  const f=await fixture(),music=f.timeline.clips[0];
  for(const audio of [{...DEFAULT_AUDIO_SETTINGS,fadeIn:-1},{...DEFAULT_AUDIO_SETTINGS,fadeOut:NaN},{...DEFAULT_AUDIO_SETTINGS,role:'speech'},{...DEFAULT_AUDIO_SETTINGS,ducking:{enabled:true,amount:1.1,attack:.2,release:.2}},{...DEFAULT_AUDIO_SETTINGS,ducking:{enabled:true,amount:.5,attack:6,release:.2}}]){
    await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,clips:[{...music,audio:audio as NonNullable<typeof music.audio>},f.timeline.clips[1]]},expectedRevision:0})).rejects.toThrow();
  }
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{...music,kind:'caption',assetId:undefined,text:'Actual saved words',track:1,audio:{...DEFAULT_AUDIO_SETTINGS}}]},expectedRevision:0})).rejects.toThrow('audio clips');
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).revision).toBe(0);
});

test('frozen split fade phases persist through saves and shared copies, and malformed phases are rejected',async()=>{
  const f=await fixture(),timeline=splitClip(configureAudio(f.timeline,'music',{fadeIn:1,fadeOut:2}),'music',5,'right');
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:0});
  const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId}),copier=f.t.withIdentity({subject:'audio-copy'}),copyId=await copier.mutation(api.timelineShares.useTimeline,{shareId});
  expect((await copier.query(api.projects.get,{projectId:copyId})).timeline!.clips.map(clip=>clip.audioFadeTiming)).toEqual(timeline.clips.map(clip=>clip.audioFadeTiming));
  for(const audioFadeTiming of [{duration:0,offset:0},{duration:1,offset:NaN}])await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...timeline,clips:timeline.clips.map(clip=>clip.id==='right'?{...clip,audioFadeTiming}:clip)},expectedRevision:1})).rejects.toThrow('Audio fade timing');
});
