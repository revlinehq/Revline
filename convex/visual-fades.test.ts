/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { configureVisualFade } from '../lib/editor/visual-fades';
import { splitClip } from '../lib/editor/operations';
import { normalizeTimeline } from '../lib/editor/types';
import type { Timeline } from '../lib/editor/types';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('BILLING_ENABLED', 'false'));
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'visual-fade-owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Owned visual fade check', aspectRatio: 'landscape' });
  const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'visual-fade-owner', projectId, kind: 'image', fileName: 'Owned.png', contentType: 'image/png', size: 1, width: 320, height: 180, createdAt: Date.now() }));
  const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: [{ id: 'still', kind: 'image', assetId, track: 1, start: 0, duration: 10, sourceStart: 0 }] };
  return { t, owner, projectId, timeline };
}
test('saved splits, undo and shared copies preserve the original visual fade phase', async () => {
  const f = await fixture(), faded = configureVisualFade(f.timeline, 'still', { fadeIn: 1, fadeOut: 2 }), split = splitClip(faded, 'still', 5, 'tail');
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: faded, expectedRevision: 0 });
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: split, expectedRevision: 1 });
  const shareId = await f.owner.mutation(api.timelineShares.publish, { projectId: f.projectId });
  const copier = f.t.withIdentity({ subject: 'visual-fade-copy' }), copyId = await copier.mutation(api.timelineShares.useTimeline, { shareId });
  expect((await copier.query(api.projects.get, { projectId: copyId })).timeline!.clips.map(clip => clip.visualFadeTiming)).toEqual(split.clips.map(clip => clip.visualFadeTiming));
  await f.owner.mutation(api.projects.undo, { projectId: f.projectId });
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).timeline).toEqual(normalizeTimeline(faded));
});
test('raw saves reject wrong clip kinds and malformed fades before changing revision', async () => {
  const f = await fixture();
  for (const patch of [{ visualFade: { fadeIn: -1, fadeOut: 0 } }, { visualFadeTiming: { duration: 0, offset: 0 } }, { kind: 'caption' as const, assetId: undefined, text: 'Owned words', visualFade: { fadeIn: 1, fadeOut: 0 } }]) {
    await expect(f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 0, timeline: { ...f.timeline, clips: [{ ...f.timeline.clips[0], ...patch }] } })).rejects.toThrow();
  }
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).revision).toBe(0);
});
