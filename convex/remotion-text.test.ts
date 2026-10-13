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
  await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: 'run' }));
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
