/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { BLEND_MODES, EFFECT_PRESETS, MOTION_PRESETS, configureTimedEffectPatch, motionPreset } from '../lib/editor/clip-effects';
import { addEffectClip, addMediaClip, convertSolidColorToVisual, patchClip, splitClip } from '../lib/editor/operations';
import { EMPTY_TIMELINE } from '../lib/editor/types';
import { isTransitionPreset } from '../lib/editor/clip-transitions';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('BILLING_ENABLED', 'false');
  vi.stubEnv('RENDER_WORKER_SECRET', 'effects-test-worker');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Effects regression', aspectRatio: 'vertical' });
  const asset = await t.run(async ctx => {
    const fields = { ownerId: 'owner', projectId, size: 1, duration: 200, createdAt: Date.now() };
    const audioAssetId = await ctx.db.insert('assets', { ...fields, kind: 'audio', fileName: 'source.m4a', contentType: 'audio/mp4' });
    const _id = await ctx.db.insert('assets', { ...fields, kind: 'video', fileName: 'source.mp4', contentType: 'video/mp4', audioAssetId, audioExtracted: true });
    return { _id, kind: 'video' as const, duration: 200, audioAssetId };
  });
  return { t, owner, projectId, asset, drain: () => t.finishAllScheduledFunctions(vi.runAllTimers) };
}

test.each(MOTION_PRESETS)('saves and reloads %s with every blend mode after five minutes, keeping linked audio synchronized', async preset => {
  const f = await fixture();
  const base = patchClip(addMediaClip(EMPTY_TIMELINE, f.asset, 'video', 600), 'video', { sourceStart: 33.733333333333334, duration: 158.89999999999998 });
  let revision = 0;
  for (const blendMode of BLEND_MODES) {
    const timeline = patchClip(base, 'video', { ...motionPreset(base.clips[0], preset), blendMode });
    await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline, expectedRevision: revision++ });
    const saved = (await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline!;
    expect(saved.clips.find(clip => clip.id === 'video')).toMatchObject(timeline.clips[0]);
    expect(saved.clips.find(clip => clip.id === 'video-audio')).toMatchObject({ start: 600, sourceStart: 33.733333333333334, duration: 158.89999999999998, linkedClipId: 'video' });
    expect(saved.clips.find(clip => clip.id === 'video-audio')).not.toHaveProperty('motion');
  }
});

test('effect saves still reject another owner and invalid motion values', async () => {
  const f = await fixture();
  const base = addMediaClip(EMPTY_TIMELINE, f.asset, 'video', 600);
  const timeline = patchClip(base, 'video', { ...motionPreset(base.clips[0], 'punch'), blendMode: 'screen' });
  await expect(f.t.withIdentity({ subject: 'stranger' }).mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline, expectedRevision: 0 })).rejects.toThrow('Project not found');
  timeline.clips[0].motion![1].scale = 100;
  await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline, expectedRevision: 0 })).rejects.toThrow('Motion scale is out of range');
});

test.each(EFFECT_PRESETS.filter(preset=>!isTransitionPreset(preset)))('independent %s effect clips persist without media and survive splitting', async preset => {
  const f = await fixture();
  const base = addMediaClip(EMPTY_TIMELINE, f.asset, 'video', 600);
  const next = addEffectClip(base, 'effect', preset, 610, { aboveClipId: 'video', duration: 2 });
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: next, expectedRevision: 0 });
  const split = splitClip(next, 'effect', 611, 'tail');
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: split, expectedRevision: 1 });
  const saved = (await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline!;
  expect(saved.clips.find(clip => clip.id === 'video')).toEqual(base.clips[0]);
  expect(saved.clips.find(clip => clip.id === 'tail')).toMatchObject({ ...(preset==='solid-color'?{kind:'solid',solidColor:next.clips.at(-1)!.solidColor}:{kind:'effect',effectPreset:preset,motionOffset:1}), start: 611, duration: 1, sourceStart: 0 });
  const invalid = patchClip(split, 'tail', { assetId: f.asset._id });
  await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: invalid, expectedRevision: 2 })).rejects.toThrow('cannot reference media');
});

test('saved legacy FX color remains intact until an explicit V conversion and rejects media references',async()=>{
  const f=await fixture();
  const legacy={...EMPTY_TIMELINE,tracks:{visual:1,overlay:0,audio:0,effects:1},clips:[{id:'legacy',kind:'effect' as const,effectPreset:'solid-color' as const,track:1,start:0,duration:3,sourceStart:0,solidColor:{color:'#fedcba',width:1,height:1,x:.5,y:.5,opacity:1}}]};
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:legacy,expectedRevision:0});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline.clips[0]).toEqual(legacy.clips[0]);
  const next=convertSolidColorToVisual(legacy,'legacy');
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:next,expectedRevision:1});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline.clips[0]).toMatchObject({kind:'solid',solidColor:legacy.clips[0].solidColor});
  await expect(f.t.withIdentity({subject:'stranger'}).mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:next,expectedRevision:2})).rejects.toThrow('Project not found');
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:patchClip(next,'legacy',{assetId:f.asset._id}),expectedRevision:2})).rejects.toThrow('cannot reference media');
});

test('Punch keeps absent legacy timing and optional seconds through save, split and bounded validation',async()=>{
  const f=await fixture(),base=addMediaClip(EMPTY_TIMELINE,f.asset,'video',600);
  const old={amount:1.6,speed:.5,centerX:.3,centerY:.7};
  const legacy=patchClip(addEffectClip(base,'effect','punch',610,{duration:2}),'effect',{punch:old});
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:legacy,expectedRevision:0});
  let saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
  expect(saved.clips.find(clip=>clip.id==='effect')).toEqual(legacy.clips.find(clip=>clip.id==='effect'));
  expect(saved.clips.find(clip=>clip.id==='effect')!.punch).toEqual(old);
  const effect=legacy.clips.find(clip=>clip.id==='effect')!;
  const timed=patchClip(legacy,'effect',configureTimedEffectPatch(effect,{punch:{attack:5,release:9}}));
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:timed,expectedRevision:1});
  const split=splitClip(timed,'effect',611,'tail');
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:split,expectedRevision:2});
  saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
  for(const id of ['effect','tail'])expect(saved.clips.find(clip=>clip.id===id)?.punch).toEqual({...old,attack:5,release:9});
  expect(saved.clips.filter(clip=>clip.kind!=='effect')).toEqual(base.clips);
  for(const field of ['attack','release'] as const)for(const value of [.009,30.01,NaN,Infinity]){
    const invalid={...split,clips:split.clips.map(clip=>clip.id==='tail'?{...clip,punch:{...clip.punch!,[field]:value}}:clip)};
    await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:invalid,expectedRevision:3})).rejects.toThrow(/punch/);
  }
});

test('a stored video import appends after five minutes once, without discarding the current effects', async () => {
  const f = await fixture();
  const { taskId } = await f.owner.mutation(api.mediaTasks.importVideo, { projectId: f.projectId, url: 'https://cdn.example.com/video.mp4' });
  await f.drain();
  const work = (await f.t.mutation(api.mediaTasks.claim, { workerSecret: 'effects-test-worker' }))!;
  await f.t.run(ctx => ctx.db.patch(taskId, { outputAssetId: f.asset._id }));
  const base = patchClip(addMediaClip(EMPTY_TIMELINE, f.asset, 'existing', 600), 'existing', { duration: 12 });
  const timeline = patchClip(base, 'existing', { ...motionPreset(base.clips[0], 'fade'), blendMode: 'screen' });
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline, expectedRevision: 0 });
  const completion = { taskId, leaseToken: work.leaseToken, result: {} };
  await f.t.mutation(api.mediaTasks.complete, completion);
  await f.t.mutation(api.mediaTasks.complete, completion);
  await f.drain();
  const saved = (await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline!;
  expect(saved.clips.find(clip => clip.id === 'existing')).toMatchObject(timeline.clips[0]);
  expect(saved.clips.filter(clip => clip.id === `import-${taskId}`)).toHaveLength(1);
  expect(saved.clips.find(clip => clip.id === `import-${taskId}`)).toMatchObject({ start: 612, duration: 200 });
  expect(saved.clips.find(clip => clip.id === `import-${taskId}-audio`)).toMatchObject({ start: 612, duration: 200 });
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'completed', progress: 100 });
});

test('a subframe import reports its source problem instead of claiming the timeline is full', async () => {
  const f = await fixture();
  const { taskId } = await f.owner.mutation(api.mediaTasks.importVideo, { projectId: f.projectId, url: 'https://cdn.example.com/short.mp4' });
  await f.drain();
  const work = (await f.t.mutation(api.mediaTasks.claim, { workerSecret: 'effects-test-worker' }))!;
  await f.t.run(async ctx => {
    await ctx.db.patch(f.asset._id, { duration: .01 });
    await ctx.db.patch(taskId, { outputAssetId: f.asset._id });
  });
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: {} })).rejects.toThrow('shorter than one timeline frame');
  expect(await f.t.run(ctx => ctx.db.get(f.asset._id))).not.toBeNull();
  await f.t.mutation(api.mediaTasks.fail, { taskId, leaseToken: work.leaseToken, error: 'Source is shorter than one frame', retryable: false });
  await f.drain();
});
