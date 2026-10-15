import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import { addMediaClip, addTransitionClip, patchClip } from '../lib/editor/operations';
import { TRANSITION_PRESETS, transitionSources } from '../lib/editor/clip-transitions';
import { copyTimelineClips,pasteTimelineClips } from '../lib/editor/clipboard';
import { EMPTY_TIMELINE, type Clip } from '../lib/editor/types';

const modules=import.meta.glob('./**/*.ts');
beforeEach(()=>vi.stubEnv('BILLING_ENABLED','false'));
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'transition-owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Transition regression',aspectRatio:'landscape'});
  const media=await t.run(async ctx=>{
    const fields={ownerId:'transition-owner',projectId,size:1,duration:30,createdAt:Date.now()};
    const audioAssetId=await ctx.db.insert('assets',{...fields,kind:'audio',fileName:'Owned sound.wav',contentType:'audio/wav'});
    const videoId=await ctx.db.insert('assets',{...fields,kind:'video',fileName:'Owned footage.mp4',contentType:'video/mp4',audioAssetId,audioExtracted:true});
    const imageId=await ctx.db.insert('assets',{...fields,kind:'image',fileName:'Owned still.png',contentType:'image/png'});
    return {videoId,imageId,audioAssetId};
  });
  let timeline=patchClip(addMediaClip({...EMPTY_TIMELINE,aspectRatio:'landscape'},{_id:media.videoId,kind:'video',duration:30,audioAssetId:media.audioAssetId},'from',2),'from',{duration:3,sourceStart:4,playbackRate:2});
  timeline=patchClip(addMediaClip(timeline,{_id:media.imageId,kind:'image'},'to',5),'to',{duration:2});
  return {t,owner,projectId,media,timeline};
}

test.each(TRANSITION_PRESETS)('%s persists through manual save, AI controls, sharing and an owned editable copy',async preset=>{
  const f=await fixture(),wipe=preset==='gradient-wipe'||preset==='iris-wipe',controls={wipeDirection:'down' as const,softness:.3,centerX:.2,centerY:.8,shape:'ellipse' as const},timeline=addTransitionClip(f.timeline,'transition',preset,'from','to',{direction:'clockwise',...(wipe?controls:{})});
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:0});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline).toEqual(timeline);
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'transition-run'}));
  const changed=patchClip(timeline,'transition',{duration:1,transition:{...timeline.clips.at(-1)!.transition!,direction:'counter-clockwise',...(wipe?{softness:.45,centerX:.7}:{})}});
  await f.t.mutation(internal.assistant.apply,{projectId:f.projectId,ownerId:'transition-owner',runId:'transition-run',expectedRevision:1,timeline:changed});
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:false}));
  const saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
  expect(saved.clips.slice(0,f.timeline.clips.length)).toEqual(f.timeline.clips);
  expect(saved.clips.at(-1)).toMatchObject({effectPreset:preset,start:4.5,duration:1,transition:{fromClipId:'from',toClipId:'to',direction:'counter-clockwise'}});
  if(wipe)expect(saved.clips.at(-1)!.transition).toEqual({fromClipId:'from',toClipId:'to',direction:'counter-clockwise',...controls,softness:.45,centerX:.7});
  const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId});
  const shared=(await f.t.query(api.timelineShares.get,{shareId}))!;
  expect(shared.timeline).toEqual(saved);
  const copier=f.t.withIdentity({subject:'copy-owner'}),copyId=await copier.mutation(api.timelineShares.useTimeline,{shareId});
  const copied=(await copier.query(api.projects.get,{projectId:copyId})).timeline!;
  expect(transitionSources(copied.clips,copied.fps)[0].clip.transition).toEqual(saved.clips.at(-1)!.transition);
  expect(copied.clips.find(clip=>clip.id==='from')!.assetId).not.toBe(f.media.videoId);
  expect(copied.clips.find(clip=>clip.id==='from-audio')).toMatchObject({start:2,duration:3,sourceStart:4,playbackRate:2,linkedClipId:'from'});
  await expect(f.owner.query(api.projects.get,{projectId:copyId})).rejects.toThrow('Project not found');
});

test('raw saves reject dangling pairs, nonadjacent layers, invalid bands and overlapping transitions',async()=>{
  const f=await fixture(),valid=addTransitionClip(f.timeline,'transition','spin-zoom','from','to'),effect=valid.clips.at(-1)!;
  const invalid:Clip[]=[
    {...effect,transition:{...effect.transition!,toClipId:'missing'}},
    {...effect,start:5},
    {...effect,duration:1/30},
    {...effect,transition:undefined},
    {...effect,kind:'image'},
  ];
  for(const clip of invalid)await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...valid,clips:[...f.timeline.clips,clip]},expectedRevision:0})).rejects.toThrow();
  for(const changes of [{start:5.1},{start:4.9},{track:2}]){
    const clips=valid.clips.map(clip=>clip.id==='to'?{...clip,...changes}:clip);
    await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...valid,tracks:{...valid.tracks!,visual:2},clips},expectedRevision:0})).rejects.toThrow(/same V track|gap or overlap/);
  }
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...valid,tracks:{...valid.tracks!,effects:2},clips:[...valid.clips,{...effect,id:'second',track:2}]},expectedRevision:0})).rejects.toThrow('cannot overlap');
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...valid,clips:valid.clips.map(clip=>clip.id==='from'?{...clip,blendMode:'difference' as const}:clip)},expectedRevision:0})).rejects.toThrow('same blend mode');
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).revision).toBe(0);
});

test('transition references cannot bypass project, media or AI run ownership',async()=>{
  const f=await fixture(),timeline=addTransitionClip(f.timeline,'transition','blur-dissolve','from','to');
  await expect(f.t.withIdentity({subject:'stranger'}).mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:0})).rejects.toThrow('Project not found');
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'owned-run'}));
  await expect(f.t.mutation(internal.assistant.apply,{projectId:f.projectId,ownerId:'stranger',runId:'owned-run',expectedRevision:0,timeline})).rejects.toThrow();
  await f.t.run(ctx=>ctx.db.patch(f.media.videoId,{ownerId:'stranger'}));
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:0})).rejects.toThrow('must belong to this project');
});


test.each(['gradient-wipe','iris-wipe'] as const)('%s preserves custom masks through pair copy and rejects malformed wipe controls',async preset=>{
  const f=await fixture(),settings={wipeDirection:'left' as const,softness:0,centerX:0,centerY:1,shape:'ellipse' as const};
  const timeline=addTransitionClip(f.timeline,'transition',preset,'from','to',settings),transition=timeline.clips.at(-1)!;
  for(const key of ['softness','centerX','centerY'] as const)for(const value of [-.01,1.01,NaN,Infinity]){
    await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...timeline,clips:timeline.clips.map(clip=>clip.id==='transition'?{...clip,transition:{...transition.transition!,[key]:value}}:clip)},expectedRevision:0})).rejects.toThrow();
  }
  for(const invalid of [{wipeDirection:'diagonal' as 'left'},{shape:'square' as 'circle'}])await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...timeline,clips:timeline.clips.map(clip=>clip.id==='transition'?{...clip,transition:{...transition.transition!,...invalid}}:clip)},expectedRevision:0})).rejects.toThrow();
  const pasted=pasteTimelineClips(timeline,copyTimelineClips(timeline,['from','to','transition']),12).timeline;
  const copy=pasted.clips.find(clip=>clip.transition&&clip.id!=='transition')!;
  expect(copy.transition).toMatchObject(settings);expect(copy.transition!.fromClipId).not.toBe('from');expect(copy.transition!.toClipId).not.toBe('to');
  expect(transitionSources(pasted.clips,pasted.fps)).toHaveLength(2);
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:pasted,expectedRevision:0});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline).toEqual(pasted);
  const full=patchClip(pasted,'transition',{transition:{...transition.transition!,softness:1,centerX:1,centerY:0,wipeDirection:'up',shape:'circle'}});
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:full,expectedRevision:1});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline).toEqual(full);
});
