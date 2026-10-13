/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import { addMediaClip, patchClip } from '../lib/editor/operations';
import { EMPTY_TIMELINE, type Clip } from '../lib/editor/types';
import { DEFAULT_COLOR_GRADE, DEFAULT_GLITCH, DEFAULT_ZOOM_BLUR } from '../lib/editor/visual-effects';
import { deleteEmptyLayer, removeEmptyLayers } from '../lib/editor/timeline-controls';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('BILLING_ENABLED', 'false'));
afterEach(() => vi.unstubAllEnvs());
const effects = { colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: .5, temperature: -30 }, zoomBlur: { ...DEFAULT_ZOOM_BLUR, enabled: true, centerY: .3 }, glitch: { ...DEFAULT_GLITCH, enabled: true, intensity: .8 } };
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
  await f.t.run(ctx => ctx.db.patch(f.projectId, { aiRunning: true, aiRunId: 'run' }));
  const next = patchClip(f.timeline, 'visual', { glitch: { ...effects.glitch, enabled: false } });
  await f.t.mutation(internal.assistant.apply, { projectId: f.projectId, ownerId: 'owner', runId: 'run', expectedRevision: 1, timeline: next });
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline?.clips[0].glitch).toEqual({ ...effects.glitch, enabled: false });
});
test('invalid controls and wrong clip kinds cannot be saved', async () => {
  const f = await fixture();
  for (const patch of [{ colorGrade: { ...effects.colorGrade, exposure: 3 } }, { zoomBlur: { ...effects.zoomBlur, amount: -1 } }, { glitch: { ...effects.glitch, rgbSplit: 51 } }]) {
    await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: patchClip(f.timeline, 'visual', patch), expectedRevision: 0 })).rejects.toThrow('must be between');
  }
  for (const kind of ['audio', 'caption', 'graphic', 'effect'] as const) {
    const bad: Clip = { ...f.timeline.clips[0], kind };
    await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: { ...f.timeline, clips: [bad] }, expectedRevision: 0 })).rejects.toThrow('video or image');
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
  await f.t.run(ctx => ctx.db.patch(f.projectId, { aiRunning: true, aiRunId: 'run' }));
  expect(() => deleteEmptyLayer(before, 'visual', 3)).toThrow('Remove the clips');
  for (const track of [NaN, 1.5, 0, 5]) expect(() => deleteEmptyLayer(before, 'visual', track)).toThrow('existing layer');
  const one = deleteEmptyLayer(before, 'visual', 2);
  await f.t.mutation(internal.assistant.apply, { projectId: f.projectId, ownerId: 'owner', runId: 'run', expectedRevision: 1, timeline: one });
  const all = removeEmptyLayers(one);
  await f.t.mutation(internal.assistant.apply, { projectId: f.projectId, ownerId: 'owner', runId: 'run', expectedRevision: 2, timeline: all });
  const saved = (await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline!;
  expect(saved.tracks).toEqual({ visual: 1, overlay: 0, audio: 0 });
  expect(saved.clips).toEqual(before.clips.map(clip => ({ ...clip, track: 1 })));
});
