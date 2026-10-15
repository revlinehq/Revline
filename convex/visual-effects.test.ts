import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import { addEffectClip, addMediaClip, patchClip, duplicateClip } from '../lib/editor/operations';
import { EMPTY_TIMELINE, type Clip } from '../lib/editor/types';
import { DEFAULT_COLOR_GRADE, DEFAULT_DITHER, DEFAULT_INVERT, DEFAULT_GLITCH, DEFAULT_ZOOM_BLUR, DEFAULT_LENS_DISTORTION, DEFAULT_FRAME_DISTORTION, DEFAULT_FILM_OVERLAY, DEFAULT_SOFT_BLUR, DEFAULT_VHS, DEFAULT_LIGHT_LEAK, DEFAULT_DIRECTIONAL_BLUR, DEFAULT_TURBULENT_DISPLACE, DEFAULT_LIGHT_SWEEP, VISUAL_EFFECT_LIMITS } from '../lib/editor/visual-effects';
import { subtitleStylePatch } from '../lib/editor/subtitle-styles';
import { visualEffectsPatch } from '../lib/editor/visual-effects';
import { splitClip } from '../lib/editor/operations';
import { deleteEmptyLayer, removeEmptyLayers } from '../lib/editor/timeline-controls';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('BILLING_ENABLED', 'false'));
afterEach(() => vi.unstubAllEnvs());
const effects = { directionalBlur:{...DEFAULT_DIRECTIONAL_BLUR,enabled:true,amount:24,angle:45},turbulentDisplace:{...DEFAULT_TURBULENT_DISPLACE,enabled:true,amount:40,scale:180,speed:1.2},lightSweep:{...DEFAULT_LIGHT_SWEEP,enabled:true,color:'#AAFFFF',position:.3,width:.2}, vhs:{...DEFAULT_VHS,enabled:true,scanlines:.6,speed:1.4},lightLeak:{...DEFAULT_LIGHT_LEAK,enabled:true,color:'#FF8844',position:.75,speed:.8}, frameCorners:{enabled:true,amount:.25}, softBlur:{...DEFAULT_SOFT_BLUR,enabled:true,amount:8}, lensDistortion:{...DEFAULT_LENS_DISTORTION,enabled:true},frameDistortion:{...DEFAULT_FRAME_DISTORTION,enabled:true,horizontal:.4,vertical:-.3,skew:.2},filmOverlay:{...DEFAULT_FILM_OVERLAY,enabled:true}, dither: { ...DEFAULT_DITHER, enabled: true, amount: .7, levels: 3, size: 4, shadowColor: '#101080', highlightColor: '#FFFF00' }, invert: { ...DEFAULT_INVERT, enabled: true }, colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: .5, temperature: -30 }, zoomBlur: { ...DEFAULT_ZOOM_BLUR, enabled: true, centerY: .3 }, glitch: { ...DEFAULT_GLITCH, enabled: true, intensity: .8 } };
async function fixture(kind: 'video' | 'image' = 'video') {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Visual controls', aspectRatio: 'vertical' });
  const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId, kind, fileName: `source.${kind === 'video' ? 'mp4' : 'png'}`, contentType: kind === 'video' ? 'video/mp4' : 'image/png', size: 1, duration: 10, createdAt: Date.now() }));
  const timeline = patchClip(addMediaClip(EMPTY_TIMELINE, { _id: assetId, kind, duration: 10 }, 'visual'), 'visual', effects);
  return { t, owner, projectId, timeline };
}
test.each(['video', 'image'] as const)('all visual controls round-trip on %s through manual and AI save', async kind => {
  const f = await fixture(kind);
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: f.timeline, expectedRevision: 0 });
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline?.clips[0]).toMatchObject(effects);
  await f.t.run(ctx => writeProject(ctx,f.projectId, { aiRunning: true, aiRunId: 'run' }));
  const next = patchClip(f.timeline, 'visual', { glitch: { ...effects.glitch, enabled: false }, dither: { ...effects.dither, enabled: false }, frameDistortion: { ...effects.frameDistortion, enabled: false },vhs:{...effects.vhs,enabled:false},lightLeak:{...effects.lightLeak,enabled:false} });
  await f.t.mutation(internal.assistant.apply, { projectId: f.projectId, ownerId: 'owner', runId: 'run', expectedRevision: 1, timeline: next });
  const saved=(await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline!.clips[0];
  expect(saved.vhs).toEqual({...effects.vhs,enabled:false});
  expect(saved.lightLeak).toEqual({...effects.lightLeak,enabled:false});
  expect(saved.glitch).toEqual({ ...effects.glitch, enabled: false });
  expect(saved.dither).toEqual({ ...effects.dither, enabled: false });
  expect(saved.frameDistortion).toEqual({ ...effects.frameDistortion, enabled: false });
});
test('invalid controls and wrong clip kinds cannot be saved', async () => {
  const f = await fixture();
  for (const patch of [{frameCorners:{enabled:true,amount:-.01}},{frameCorners:{enabled:true,amount:1.01}},{frameDistortion:{...effects.frameDistortion,bend:1.01}},{frameDistortion:{...effects.frameDistortion,horizontal:1.01}},{frameDistortion:{...effects.frameDistortion,vertical:-1.01}},{frameDistortion:{...effects.frameDistortion,skew:1.01}},{lensDistortion:{...effects.lensDistortion,amount:1}},{filmOverlay:{...effects.filmOverlay,grain:-1}},{ dither: {...effects.dither, levels:17} }, { dither: {...effects.dither, size:0} }, { dither: {...effects.dither, amount:1.1} }, { invert: { enabled: true, amount: -1 } }, { colorGrade: { ...effects.colorGrade, exposure: 3 } }, { zoomBlur: { ...effects.zoomBlur, amount: -1 } }, { glitch: { ...effects.glitch, rgbSplit: 51 } }]) {
    await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: patchClip(f.timeline, 'visual', patch), expectedRevision: 0 })).rejects.toThrow('must be between');
  }
  for (const dither of [{...effects.dither,levels:2.5},{...effects.dither,size:1.5}]) {
    await expect(f.owner.mutation(api.projects.saveTimeline, {projectId:f.projectId,timeline:patchClip(f.timeline,'visual',{dither}),expectedRevision:0})).rejects.toThrow('whole number');
  }
  for (const color of ['red', '#xyzxyz', '#12345678', '#123']) {
    await expect(f.owner.mutation(api.projects.saveTimeline, {projectId:f.projectId,timeline:patchClip(f.timeline,'visual',{dither:{...effects.dither,shadowColor:color}}),expectedRevision:0})).rejects.toThrow('six-digit hex');
  }
  for (const kind of ['audio', 'caption', 'graphic', 'effect'] as const) {
    const bad: Clip = { ...f.timeline.clips[0], kind };
    await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: { ...f.timeline, tracks: { ...f.timeline.tracks!, effects: 1 }, clips: [bad] }, expectedRevision: 0 })).rejects.toThrow('video or image');
  }
});
test('visual controls cannot bypass project or asset ownership', async () => {
  const f = await fixture();
  await expect(f.t.withIdentity({ subject: 'stranger' }).mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: f.timeline, expectedRevision: 0 })).rejects.toThrow('Project not found');
  await f.t.run(async ctx => { const assetId = ctx.db.normalizeId('assets', f.timeline.clips[0].assetId!)!; await ctx.db.patch(assetId, { ownerId: 'stranger' }); });
  await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: f.timeline, expectedRevision: 0 })).rejects.toThrow('must belong to this project');
});
test('AI empty-track cleanup saves one/all empty rows without deleting graded footage', async () => {
  const f = await fixture();
  const before = { ...f.timeline, tracks: { visual: 4, overlay: 0, audio: 3 }, clips: f.timeline.clips.map(clip => ({ ...clip, track: 3 })) };
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: before, expectedRevision: 0 });
  await f.t.run(ctx => writeProject(ctx,f.projectId, { aiRunning: true, aiRunId: 'run' }));
  expect(() => deleteEmptyLayer(before, 'visual', 3)).toThrow('Remove the clips');
  for (const track of [NaN, 1.5, 0, 5]) expect(() => deleteEmptyLayer(before, 'visual', track)).toThrow('existing layer');
  const one = deleteEmptyLayer(before, 'visual', 2);
  await f.t.mutation(internal.assistant.apply, { projectId: f.projectId, ownerId: 'owner', runId: 'run', expectedRevision: 1, timeline: one });
  const all = removeEmptyLayers(one);
  await f.t.mutation(internal.assistant.apply, { projectId: f.projectId, ownerId: 'owner', runId: 'run', expectedRevision: 2, timeline: all });
  const saved = (await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline!;
  expect(saved.tracks).toEqual({ visual: 1, overlay: 0, audio: 0, effects: 0 });
  expect(saved.clips).toEqual(before.clips.map(clip => ({ ...clip, track: 1 })));
});

test('timed zoom blur saves on its own FX track and preserves media and split settings',async()=>{
 const f=await fixture();
 const withEffect=addEffectClip(f.timeline,'blur','zoom-blur',2,{duration:1});
 const blur=withEffect.clips.find(clip=>clip.id==='blur')!;
 expect(blur.kind).toBe('effect');expect(blur.zoomBlur).toMatchObject({enabled:true,amount:.15,centerX:.5,centerY:.5});
 expect(withEffect.clips[0]).toEqual(f.timeline.clips[0]);
 const changed=patchClip(withEffect,'blur',visualEffectsPatch(blur,{zoomBlur:{amount:.6,centerY:.3}}));
 await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:changed,expectedRevision:0});
 const saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
 expect(saved.clips.find(clip=>clip.id==='blur')!.zoomBlur).toMatchObject({amount:.6,centerY:.3});
 await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'blur-run'}));
 const split=splitClip(saved,'blur',2.5,'blur-tail');
 await f.t.mutation(internal.assistant.apply,{projectId:f.projectId,ownerId:'owner',runId:'blur-run',expectedRevision:1,timeline:split});
 const published=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
 expect(published.clips.find(clip=>clip.id==='blur-tail')!.zoomBlur).toEqual(saved.clips.find(clip=>clip.id==='blur')!.zoomBlur);
 expect(()=>visualEffectsPatch(blur,{dither:{enabled:true}})).toThrow('video or image');
 expect(()=>visualEffectsPatch({...blur,effectPreset:'quick-zoom-in'},{zoomBlur:{amount:.6}})).toThrow('video or image');
});

test('Difference caption blending persists and switching looks restores normal blending',async()=>{
 const f=await fixture();
 const caption:Clip={id:'caption',kind:'caption',track:2,text:'Real words',start:1,duration:2,sourceStart:0,animation:'fade',transform:{x:.5,y:.5,scale:1,rotation:8,opacity:1},...subtitleStylePatch('difference')};
 await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,tracks:{...f.timeline.tracks!,visual:2},clips:[...f.timeline.clips,caption]},expectedRevision:0});
 const saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
 expect(saved.clips.find(clip=>clip.id==='caption')).toEqual(caption);
 const clean=patchClip(saved,'caption',subtitleStylePatch('clean'));
 await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:clean,expectedRevision:1});
 expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!.clips.find(clip=>clip.id==='caption')).toMatchObject({text:'Real words',start:1,duration:2,blendMode:'normal',animation:'fade',transform:{rotation:8}});
});


test('legacy frame perspective saves without silently adding a bend or corner setting',async()=>{
  const f=await fixture();
  const legacy={enabled:true,horizontal:.4,vertical:0,skew:0};
  const timeline=patchClip(f.timeline,'visual',{frameDistortion:legacy,frameCorners:{enabled:true,amount:.35}});
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:0});
  const saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!.clips[0];
  expect(saved.frameDistortion).toEqual(legacy);
  expect(saved.frameCorners).toEqual({enabled:true,amount:.35});
});


test.each(['video','image'] as const)('footage effect controls retain through split, duplicate and editable share of %s',async kind=>{
  const f=await fixture(kind);
  const divided=splitClip(f.timeline,'visual',f.timeline.clips[0].duration/2,'tail');
  const copied=duplicateClip(divided,'tail','copy');
  await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:copied,expectedRevision:0});
  const saved=(await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline!;
  expect(saved).toEqual(copied);
  for(const clip of saved.clips)expect(clip).toMatchObject(effects);
  const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId});
  const copier=f.t.withIdentity({subject:'texture-copy-owner'}),copyId=await copier.mutation(api.timelineShares.useTimeline,{shareId});
  const copy=(await copier.query(api.projects.get,{projectId:copyId})).timeline!;
  expect(copy.clips.map(({assetId,...clip})=>clip)).toEqual(saved.clips.map(({assetId,...clip})=>clip));
  for(const clip of copy.clips)expect((await f.t.run(ctx=>ctx.db.get('assets',ctx.db.normalizeId('assets',clip.assetId!)!)))?.ownerId).toBe('texture-copy-owner');
});

test.each(['vhs','lightLeak','directionalBlur','turbulentDisplace','lightSweep'] as const)('%s rejects every invalid numeric boundary, incomplete data and non-footage kind',async group=>{
  const f=await fixture(),settings=effects[group];
  for(const [key,[minimum,maximum]] of Object.entries(VISUAL_EFFECT_LIMITS[group])){
    for(const value of [minimum-.01,maximum+.01,NaN,Infinity])for(const enabled of [true,false]){
      const timeline=patchClip(f.timeline,'visual',{[group]:{...settings,enabled,[key]:value}});
      await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:0})).rejects.toThrow('must be between');
    }
  }
  const incomplete={...settings} as Partial<typeof settings>;delete incomplete.amount;
  await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:patchClip(f.timeline,'visual',{[group]:incomplete}),expectedRevision:0})).rejects.toThrow();
  for(const kind of ['audio','caption','graphic','solid','effect'] as const){
    const clip:Clip={id:'wrong-kind',kind,track:1,start:0,duration:1,sourceStart:0,...(kind==='effect'?{effectPreset:'zoom-blur' as const}:{}),[group]:settings};
    await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:{...f.timeline,tracks:{visual:1,audio:1,overlay:0,effects:1},clips:[clip]},expectedRevision:0})).rejects.toThrow('video or image');
  }
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).revision).toBe(0);
});

test('texture boundary values save without clamping, and Light leak requires a six-digit solid hex color',async()=>{
  const f=await fixture();let revision=0;
  for(const end of [0,1]){
    const vhs={...effects.vhs,...Object.fromEntries(Object.entries(VISUAL_EFFECT_LIMITS.vhs).map(([key,range])=>[key,range[end]]))};
    const lightLeak={...effects.lightLeak,...Object.fromEntries(Object.entries(VISUAL_EFFECT_LIMITS.lightLeak).map(([key,range])=>[key,range[end]])),color:end?'#ABCDEF':'#000000'};
    const timeline=patchClip(f.timeline,'visual',{vhs,lightLeak});
    await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:revision});revision++;
    expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline).toEqual(timeline);
  }
  for(const color of ['red','#xyzxyz','#12345678','#123','transparent','url(example)']){
    const timeline=patchClip(f.timeline,'visual',{lightLeak:{...effects.lightLeak,color}});
    await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:revision})).rejects.toThrow('six-digit hex');
  }
});


test.each(['directionalBlur','turbulentDisplace','lightSweep'] as const)('%s preserves exact allowed boundary values and rejects invalid light colors',async group=>{
  const f=await fixture();let revision=0;
  for(const end of [0,1]){
    const settings={...effects[group],...Object.fromEntries(Object.entries(VISUAL_EFFECT_LIMITS[group]).map(([key,range])=>[key,range[end]]))};
    const timeline=patchClip(f.timeline,'visual',{[group]:settings});
    await f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline,expectedRevision:revision++});
    expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline).toEqual(timeline);
  }
  if(group==='lightSweep')for(const color of ['red','#123','#12345678','transparent','url(example)'])await expect(f.owner.mutation(api.projects.saveTimeline,{projectId:f.projectId,timeline:patchClip(f.timeline,'visual',{lightSweep:{...effects.lightSweep,color}}),expectedRevision:revision})).rejects.toThrow('six-digit hex');
});
