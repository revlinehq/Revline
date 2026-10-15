import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import { duplicateClip, patchClip, splitClip } from '../lib/editor/operations';
import { resizeSelectedClips } from '../lib/editor/timeline-controls';
import { EMPTY_TIMELINE, type Clip, type Timeline } from '../lib/editor/types';
import { VFX_TEXT_PRESETS, remotionTextProps, type RemotionTextTemplate } from '../lib/editor/remotion-text';
import { textEffectPatch, textTemplatePatch } from '../lib/editor/text-effects';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('BILLING_ENABLED', 'false'));
afterEach(() => vi.unstubAllEnvs());
const text: Clip = { id: 'title', kind: 'graphic', text: 'Make your next idea', start: 2, duration: 4, sourceStart: 0, track: 1, textTemplate: { preset: 'karaoke', highlightColor: '#FFCC00' } };
const timeline: Timeline = { ...EMPTY_TIMELINE, clips: [text] };
const promotedPresets = ['rgb-split','type-trails','blur-focus','character-scramble','spotlight-sweep','ink-write','tunnel-zoom'] as const;

test.each(promotedPresets)('%s settings and original clock survive save, split, trim, duplicate, AI save and Undo',async preset=>{
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Promoted text animation',aspectRatio:'vertical'});
  const original:Timeline={...timeline,clips:[{...text,textTemplate:{preset,strength:.75,revealDuration:.9,stagger:.08,highlightColor:'#AD90FF',duration:4,offset:0}}]};
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:original,expectedRevision:0});
  const divided=splitClip(original,'title',4,'ending'),trimmed=resizeSelectedClips(divided,[],['ending'],'left',.2),copied=duplicateClip(trimmed,'ending','copy');
  const ending=copied.clips.find(clip=>clip.id==='ending')!,copy=copied.clips.find(clip=>clip.id==='copy')!;
  expect(ending.textTemplate).toEqual({...original.clips[0].textTemplate,offset:2.2});
  expect(copy.textTemplate).toEqual(ending.textTemplate);
  expect(remotionTextProps(ending,5.3,30)).toEqual(remotionTextProps(original.clips[0],5.3,30));
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:copied,expectedRevision:1});
  expect((await owner.query(api.projects.get,{projectId})).timeline).toEqual(copied);
  await t.run(ctx=>writeProject(ctx,projectId,{aiRunning:true,aiRunId:'promoted-text-run',aiUndoRecorded:false}));
  const adjusted=patchClip(copied,'ending',{textTemplate:{...ending.textTemplate!,strength:1.4}});
  await t.mutation(internal.assistant.apply,{projectId,ownerId:'owner',runId:'promoted-text-run',timeline:adjusted,expectedRevision:2});
  expect((await owner.query(api.projects.get,{projectId})).timeline).toEqual(adjusted);
  await owner.mutation(api.projects.undo,{projectId});
  expect((await owner.query(api.projects.get,{projectId})).timeline).toEqual(copied);
  await owner.mutation(api.projects.undo,{projectId});
  expect((await owner.query(api.projects.get,{projectId})).timeline).toEqual(original);
});

test('new animation controls are optional for saved legacy text and reject nonfinite or out-of-range values',async()=>{
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Text control validation',aspectRatio:'vertical'});
  for(const [control,values]of Object.entries({strength:[.19,2.01,NaN,Infinity],revealDuration:[.14,3.01,NaN,Infinity],stagger:[-.01,.19,NaN,Infinity]}))for(const value of values){
    const invalid={...timeline,clips:[{...text,textTemplate:{preset:'rgb-split' as const,[control]:value}}]};
    await expect(owner.mutation(api.projects.saveTimeline,{projectId,timeline:invalid,expectedRevision:0})).rejects.toThrow();
  }
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline,expectedRevision:0});
  expect((await owner.query(api.projects.get,{projectId})).timeline).toEqual(timeline);
});

test('speech-timed captions save, retain their clock after splits, and discard stale timing on word edits',async()=>{
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Speech captions',aspectRatio:'vertical'});
  const timed:Clip={...text,textTemplate:{preset:'karaoke',highlightColor:'#C4B5FD',wordTimings:[{start:0,end:.2},{start:.5,end:.9},{start:1.4,end:2},{start:2.8,end:3.9}]}};
  const source={...timeline,clips:[timed]},divided=splitClip(source,'title',4,'tail');
  expect(remotionTextProps(divided.clips[1],5,30)).toEqual(remotionTextProps(timed,5,30));
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:divided,expectedRevision:0});
  expect((await owner.query(api.projects.get,{projectId})).timeline).toEqual(divided);
  const changed=patchClip(divided,'tail',{text:'Replacement words'});
  expect(changed.clips.find(c=>c.id==='tail')?.textTemplate?.wordTimings).toBeUndefined();
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:changed,expectedRevision:1});
  const reselected=patchClip(divided,'tail',textTemplatePatch(divided.clips[1],'karaoke'));
  const {textStyle: _style,...reselectedProps}=remotionTextProps(reselected.clips[1],5,30)!;
  const {textStyle: _originalStyle,...originalProps}=remotionTextProps(timed,5,30)!;
  expect(reselectedProps).toEqual(originalProps);
});

test('template saves survive split, trim, duplicate and AI save with their original word timing', async () => {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Text templates', aspectRatio: 'vertical' });
  const split = splitClip(timeline, 'title', 4, 'second');
  expect(split.clips[0].textTemplate).toMatchObject({ duration: 4, offset: 0 });
  expect(split.clips[1].textTemplate).toMatchObject({ duration: 4, offset: 2 });
  expect(remotionTextProps(split.clips[1], 5, 30)).toEqual(remotionTextProps(text, 5, 30));
  const trimmed = resizeSelectedClips(split, [], ['second'], 'left', .5);
  expect(trimmed.clips[1].textTemplate?.offset).toBe(2.5);
  expect(remotionTextProps(trimmed.clips[1], 5, 30)).toEqual(remotionTextProps(text, 5, 30));
  const duplicated = duplicateClip(trimmed, 'second', 'copy');
  expect(duplicated.clips.find(clip => clip.id === 'copy')?.textTemplate).toEqual(trimmed.clips[1].textTemplate);
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: duplicated, expectedRevision: 0 });
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(duplicated);
  await t.run(ctx => writeProject(ctx,projectId, { aiRunning: true, aiRunId: 'run' }));
  const templated = patchClip(duplicated, 'title', textTemplatePatch(duplicated.clips[0], 'word-pop'));
  const updated = patchClip(templated, 'title', textEffectPatch(templated.clips[0], 'fade'));
  await t.mutation(internal.assistant.apply, { projectId, ownerId: 'owner', runId: 'run', timeline: updated, expectedRevision: 1 });
  expect((await owner.query(api.projects.get, { projectId })).timeline?.clips[0]).toMatchObject({ textTemplate:{preset:'word-pop'}, animation:'fade' });
  await expect(t.withIdentity({ subject: 'other' }).mutation(api.projects.saveTimeline, { projectId, timeline: updated, expectedRevision: 2 })).rejects.toThrow('Project not found');
});

test('right trims freeze missing template duration; left extension preserves entrance; entrances preserve templates', () => {
  expect(resizeSelectedClips(timeline, [], ['title'], 'right', -1).clips[0].textTemplate?.duration).toBe(4);
  expect(patchClip(timeline, 'title', { duration: 2 }).clips[0].textTemplate?.duration).toBe(4);
  const extended = resizeSelectedClips(timeline, [], ['title'], 'left', -1).clips[0];
  expect(extended.textTemplate?.offset).toBe(-1);
  expect(remotionTextProps(extended, 3, 30)).toEqual(remotionTextProps(text, 3, 30));
  const legacy = patchClip(timeline, 'title', textEffectPatch(text, 'fade')).clips[0];
  expect(legacy.textTemplate).toEqual(text.textTemplate); expect(legacy.animation).toBe('fade');
});

test('schema and save validation reject unknown templates, invalid settings and nontext kinds', async () => {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Validate templates', aspectRatio: 'vertical' });
  for (const template of [{ preset: 'unknown' }, { preset: 'word-pop', duration: 0 }, { preset: 'karaoke', highlightColor: 'red' }, { preset: 'karaoke', offset: Infinity }]) {
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...timeline, clips: [{ ...text, textTemplate: template as RemotionTextTemplate }] }, expectedRevision: 0 })).rejects.toThrow();
  }
  for (const kind of ['audio', 'video', 'image', 'effect'] as const) await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...timeline, tracks: { ...timeline.tracks!, effects: 1 }, clips: [{ ...text, kind }] }, expectedRevision: 0 })).rejects.toThrow('captions and text graphics');
});

test.each(VFX_TEXT_PRESETS)('%s persists through public save, split/trim and Undo without restarting motion',async preset=>{
  const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Animated lyric',aspectRatio:'vertical'});
  const original=patchClip(timeline,'title',textTemplatePatch(text,preset));
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:original,expectedRevision:0});
  const divided=splitClip(original,'title',4,'ending');
  const trimmed=resizeSelectedClips(divided,[],['ending'],'left',.2);
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:trimmed,expectedRevision:1});
  const saved=(await owner.query(api.projects.get,{projectId})).timeline!;
  expect(saved).toEqual(trimmed);
  expect(remotionTextProps(saved.clips.find(clip=>clip.id==='ending')!,5.8,30)).toEqual(remotionTextProps(original.clips[0],5.8,30));
  await owner.mutation(api.projects.undo,{projectId});
  expect((await owner.query(api.projects.get,{projectId})).timeline).toEqual(original);
});
