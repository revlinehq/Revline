import { writeProject,readProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { normalizeTimeline, type Timeline } from '../lib/editor/types';

const modules = import.meta.glob('./**/*.ts');
const identity = { subject: 'owner', issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: 'https://test.clerk.accounts.dev|owner' };
async function setup() {
  vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example.com'); vi.stubEnv('MEDIA_SIGNING_SECRET', 'mixed-test-secret');
  const t = convexTest(schema, modules), owner = t.withIdentity(identity);
  const projectId = await owner.mutation(api.projects.create, { title: 'Mixed edit', aspectRatio: 'vertical' });
  const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId, r2Key: 'media/owner/mixed-clip', fileName: 'clip.mp4', kind: 'video', contentType: 'video/mp4', size: 12, createdAt: Date.now(), duration: 10, width: 1920, height: 1080 }));
  const legacy: Timeline = { aspectRatio: 'vertical', fps: 30, tracks: { visual: 2, overlay: 2, audio: 0 }, clips: [
    { id: 'video', kind: 'video', assetId, track: 2, start: 0, duration: 3, sourceStart: 1 },
    { id: 'title', kind: 'graphic', track: 1, start: 0, duration: 3, sourceStart: 0, text: 'Title' },
    { id: 'caption', kind: 'caption', track: 2, start: 0, duration: 3, sourceStart: 0, text: 'Caption' },
  ] };
  return { t, owner, projectId, assetId, legacy };
}
afterEach(() => vi.unstubAllEnvs());

test('new projects start canonical before attaching or adding source media', async () => {
  const { t, owner, projectId, assetId } = await setup();
  const initial = (await owner.query(api.projects.get, { projectId })).timeline!;
  expect(initial.tracks?.overlay).toBe(0);
  const attached = await owner.mutation(api.projects.create, { title: 'Attached footage', aspectRatio: 'square', assetIds: [assetId] });
  const timeline = (await owner.query(api.projects.get, { projectId: attached })).timeline!;
  expect(timeline.tracks?.overlay).toBe(0); expect(timeline.clips[0].track).toBe(1);
  expect((await t.run(ctx => ctx.db.get(attached)))!.timeline).toEqual(timeline);
});

test('legacy read, save, list and undo preserve text above video without repeated offsets', async () => {
  const { t, owner, projectId, legacy } = await setup();
  await t.run(ctx => writeProject(ctx,projectId, { timeline: legacy, history: [legacy], revision: 7 }));
  const canonical = normalizeTimeline(legacy);
  expect(canonical.tracks).toEqual({ visual: 4, overlay: 0, audio: 0, effects: 0 });
  expect(canonical.clips.map(clip => clip.track)).toEqual([2, 3, 4]);
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(canonical);
  expect((await owner.query(api.projects.get, { projectId })).history).toEqual([canonical]);
  expect((await owner.query(api.projects.list, {}))[0].clipCount).toBe(canonical.clips.length);
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 7, timeline: legacy });
  expect((await t.run(ctx => readProject(ctx,projectId)))!.timeline).toEqual(canonical);
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 8, timeline: { ...canonical, aspectRatio: 'square' } });
  await owner.mutation(api.projects.undo, { projectId });
  const restored = (await t.run(ctx => readProject(ctx,projectId)))!;
  expect(restored.timeline).toEqual(canonical); expect(restored.history).toEqual([canonical, canonical]);
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(canonical);
});

test('mixed visual kinds share a V track, with visual 24/audio 12 limits and declared counts enforced', async () => {
  const { t, owner, projectId, legacy } = await setup();
  const audioId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId, fileName: 'music.mp3', kind: 'audio', contentType: 'audio/mpeg', size: 12, createdAt: Date.now(), duration: 10 }));
  const mixed: Timeline = { ...legacy, tracks: { visual: 24, overlay: 0, audio: 12 }, clips: [
    { ...legacy.clips[0], track: 24 }, { ...legacy.clips[1], track: 24 }, { ...legacy.clips[2], track: 1 },
    { id: 'audio', kind: 'audio', assetId: audioId, track: 12, start: 0, duration: 3, sourceStart: 0 },
  ] };
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: mixed });
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(mixed);
  const invalid: Timeline[] = [
    { ...mixed, clips: [{ ...mixed.clips[1], track: 25 }] },
    { ...mixed, clips: [{ ...mixed.clips[3], track: 13 }] },
    { ...mixed, tracks: { visual: 23, overlay: 0, audio: 12 } },
    { ...mixed, tracks: { visual: 24, overlay: 0, audio: 13 } },
    { ...legacy, tracks: { visual: 1, overlay: 2, audio: 0 } },
    { ...legacy, tracks: { visual: 2, overlay: 1, audio: 0 } },
    { ...legacy, clips: [{ ...legacy.clips[1], track: 13 }] },
  ];
  for (const timeline of invalid) await expect(owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline })).rejects.toThrow();
  const foreignAsset = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'stranger', projectId, fileName: 'foreign.mp4', kind: 'video', contentType: 'video/mp4', size: 12, createdAt: Date.now(), duration: 10 }));
  await expect(owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: { ...mixed, clips: [{ ...mixed.clips[0], assetId: foreignAsset }] } })).rejects.toThrow('must belong to this project');
  expect((await owner.query(api.projects.get, { projectId })).revision).toBe(1);
});

test('AI checkpoints and legacy queued render snapshots stay canonical and immutable', async () => {
  const { t, owner, projectId, legacy } = await setup();
  await t.run(ctx => writeProject(ctx,projectId, { timeline: legacy, aiRunning: true, aiRunId: 'mixed-run', aiUndoRecorded: false }));
  const run = { projectId, ownerId: 'owner', runId: 'mixed-run' };
  expect((await t.query(internal.assistant.getRun, run)).project.timeline).toEqual(normalizeTimeline(legacy));
  await t.mutation(internal.assistant.apply, { ...run, expectedRevision: 0, timeline: legacy });
  await t.mutation(internal.assistant.apply, { ...run, expectedRevision: 1, timeline: { ...legacy, aspectRatio: 'square' } });
  expect((await t.run(ctx => readProject(ctx,projectId)))!.timeline).toEqual(normalizeTimeline({ ...legacy, aspectRatio: 'square' }));
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(normalizeTimeline(legacy));
  vi.stubEnv('RENDER_WORKER_SECRET', 'mixed-test-secret');
  const jobId = await t.run(ctx => ctx.db.insert('renderJobs', { ownerId: 'owner', projectId, timeline: { ...legacy, clips: legacy.clips.filter(clip => clip.kind !== 'video') }, assetIds: [] as Id<'assets'>[], status: 'queued', createdAt: Date.now(), updatedAt: Date.now() }));
  const snapshot = normalizeTimeline({ ...legacy, clips: legacy.clips.filter(clip => clip.kind !== 'video') });
  const claimed = await owner.mutation(internal.renders.claim, { jobId, workerSecret: 'mixed-test-secret' });
  expect(claimed.timeline).toEqual(snapshot);
  expect((await t.run(ctx => ctx.db.get(jobId)))!.timeline).toEqual(snapshot);
});
