/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { saveAssetAnalysis } from './assets';
import type { AudioActivity } from '../lib/media-analysis/audio-activity';

const activity: AudioActivity = { version: 1, duration: 3.02, frameSeconds: .01, quiet: [{ start: 1, end: 3.02 }], level: { noiseFloorDb: -65, speechDb: -20, quietThresholdDb: -45, separationDb: 45 }, reliable: true };
const transcript = { words: [{ start: .2, end: 2.9, text: 'Goodbye.' }], segments: [{ start: .2, end: 2.9, text: 'Goodbye.' }] };
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  vi.stubEnv('BILLING_ENABLED', 'false'); vi.stubEnv('RENDER_WORKER_SECRET', 'fixture-secret');
  const t = convexTest(schema, import.meta.glob('./**/*.ts')), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Audio activity fixture', aspectRatio: 'landscape' });
  const assetId = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['fixture'], { type: 'audio/mp4' }));
    return ctx.db.insert('assets', { ownerId: 'owner', projectId, storageId, kind: 'audio', contentType: 'audio/mp4', fileName: 'speech.m4a', duration: 3, size: 10, createdAt: 0, analysis: { transcript } });
  });
  const save = (audioActivity: AudioActivity) => owner.mutation(internal.assets.saveAnalysis, { projectId, assetId, workerSecret: 'fixture-secret', audioActivity });
  return { t, owner, projectId, assetId, save };
}

test('audio activity backfill preserves source transcript timings and survives shared analysis hydration', async () => {
  const f = await fixture();
  await f.save(activity);
  const copiedProjectId = await f.owner.mutation(api.projects.create, { title: 'Copied source', aspectRatio: 'landscape', assetIds: [f.assetId] });
  const sources = await f.t.run(ctx => ctx.db.query('assets').collect()), copied = sources.find(asset => asset.projectId === copiedProjectId)!;
  expect(sources[0].analysisId).toBe(copied.analysisId);
  expect(sources.every(asset => asset.analysis === undefined)).toBe(true);
  const original = await f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId });
  expect(original.analysis).toEqual({ transcript, audioActivity: activity });
  expect((await f.owner.query(api.assets.get, { projectId: copiedProjectId, assetId: copied._id })).analysis).toEqual(original.analysis);
  expect((await f.owner.query(api.assets.list, { projectId: copiedProjectId }))[0].analysis).toBeUndefined();

  await f.t.run(async ctx => saveAssetAnalysis(ctx, (await ctx.db.get(copied._id))!, { focus: [{ time: 0, x: .5, y: .5 }] }));
  expect((await f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId })).analysis).toEqual({ transcript, audioActivity: activity, focus: [{ time: 0, x: .5, y: .5 }] });
});

test.each([
  { ...activity, duration: 4 },
  { ...activity, duration: Number.NaN },
  { ...activity, quiet: [{ start: -.1, end: 1 }] },
  { ...activity, quiet: [{ start: 1, end: 1.1 }] },
  { ...activity, quiet: [{ start: 1, end: 2 }, { start: 1.8, end: 3 }] },
  { ...activity, quiet: [{ start: 1, end: 3.5 }] },
  { ...activity, quiet: Array.from({ length: 5001 }, () => ({ start: 1, end: 2 })) },
  { ...activity, level: { ...activity.level, noiseFloorDb: Number.NEGATIVE_INFINITY } },
  { ...activity, level: { ...activity.level, separationDb: -1 } },
])('refuses unbounded, nonfinite or invalid source-time audio measurements', async invalid => {
  const f = await fixture();
  await expect(f.save(invalid)).rejects.toThrow('Invalid audio activity measurements');
  expect((await f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId })).analysis).toEqual({ transcript });
});
