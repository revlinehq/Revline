/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const workerSecret = 'beat-test-secret';
const measured = { engine: 'beat-this-final0-v1' as const, beats: [0.5, 1.5, 2.5], downbeats: [0.5, 2.5], accents: [], dropCandidates: [], bpm: 60, confidence: 0.5 };
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('RENDER_WORKER_SECRET', workerSecret); vi.stubEnv('BILLING_ENABLED', 'false'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
  const t = convexTest(schema, modules); workflowTest.register(t);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Beat analysis', aspectRatio: 'vertical' });
  const assetId = await t.run(async ctx => ctx.db.insert('assets', { storageId: await ctx.storage.store(new Blob(['song'], { type: 'audio/mp4' })), ownerId: 'owner', projectId, fileName: 'song.m4a', contentType: 'audio/mp4', size: 4, kind: 'audio', duration: 3, createdAt: Date.now() }));
  const start = () => owner.mutation(api.mediaTasks.start, { projectId, assetId, kind: 'beats' });
  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const read = () => owner.query(api.assets.get, { projectId, assetId });
  const claim = () => t.mutation(api.mediaTasks.claim, { workerSecret });
  return { t, owner, projectId, assetId, start, drain, read, claim };
}

test('background beat analysis persists engine and downbeats through the source result interface', async () => {
  const f = await fixture(), taskId = await f.start(); await f.drain();
  const work = (await f.claim())!;
  await f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { beats: measured } } });
  await f.drain();
  expect((await f.read()).analysis?.beats).toEqual(measured);
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'completed', progress: 100 });
});

test('invalid downbeat timing cannot replace a saved source analysis', async () => {
  const f = await fixture();
  const save = (downbeats: number[]) => f.owner.mutation(api.assets.saveAnalysis, { projectId: f.projectId, assetId: f.assetId, workerSecret, beats: { ...measured, downbeats } });
  await save(measured.downbeats);
  for (const downbeats of [[-1], [4], [NaN], [0.5, 0.5], [2.5, 0.5], [1]]) {
    await expect(save(downbeats)).rejects.toThrow('Invalid beat analysis');
  }
  expect((await f.read()).analysis?.beats).toEqual(measured);
});

test('a current dedicated beat map is available immediately without queuing another worker', async () => {
  const f = await fixture();
  await f.owner.mutation(api.assets.saveAnalysis, { projectId: f.projectId, assetId: f.assetId, workerSecret, beats: measured });
  const taskId = await f.start();
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'completed', progress: 100 });
  expect(await f.claim()).toBeNull();
  expect((await f.read()).analysis?.beats).toEqual(measured);
});

test('legacy onset results stay readable but a new beat request waits for dedicated tracking', async () => {
  const f = await fixture();
  const legacy = { beats: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75], bpm: 240, confidence: 0.9 };
  await f.owner.mutation(api.assets.saveAnalysis, { projectId: f.projectId, assetId: f.assetId, workerSecret, beats: legacy });
  const taskId = await f.start();
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'queued' });
  await f.drain(); const work = (await f.claim())!;
  await expect(f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { beats: legacy } } })).rejects.toThrow('dedicated beat tracking');
  expect((await f.read()).analysis?.beats).toEqual(legacy);
  await f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { beats: measured } } });
  await f.drain();
  expect((await f.read()).analysis?.beats).toEqual(measured);
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'completed' });
});

test('background audio analysis saves audible accents and uncertain drop candidates separately from beats', async () => {
  const f = await fixture(), taskId = await f.start(); await f.drain();
  const work = (await f.claim())!;
  const analyzed = { ...measured, accents: [{ time: 1.25, strength: 0.8 }], dropCandidates: [{ time: 2, strength: 1 }] };
  await f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { beats: analyzed } } });
  await f.drain();
  expect((await f.read()).analysis?.beats).toEqual(analyzed);
});

test.each(['accents', 'dropCandidates'] as const)('invalid %s cannot replace saved source analysis', async kind => {
  const f = await fixture();
  const save = (hits: { time: number; strength: number }[]) => f.owner.mutation(api.assets.saveAnalysis, { projectId: f.projectId, assetId: f.assetId, workerSecret, beats: { ...measured, [kind]: hits } });
  const valid = [{ time: 1, strength: 0 }, { time: 2, strength: 1 }];
  await save(valid);
  for (const hits of [
    [{ time: -1, strength: 0.8 }], [{ time: 4, strength: 0.8 }], [{ time: Infinity, strength: 0.8 }],
    [{ time: 1, strength: -0.1 }], [{ time: 1, strength: 1.1 }], [{ time: 1, strength: NaN }],
    [{ time: 1, strength: 0.8 }, { time: 1, strength: 0.9 }], [{ time: 2, strength: 0.8 }, { time: 1, strength: 0.9 }],
    Array.from({ length: 1001 }, (_, index) => ({ time: index / 1000, strength: 0.8 })),
  ]) await expect(save(hits)).rejects.toThrow('Invalid beat analysis');
  expect((await f.read()).analysis?.beats).toEqual({ ...measured, [kind]: valid });
});

test('an older tagged beat map is refreshed when audible-hit metadata is missing', async () => {
  const f = await fixture();
  const older = { engine: 'beat-this-final0-v1' as const, beats: [0.5, 1.5, 2.5], downbeats: [0.5, 2.5], bpm: 60, confidence: 0.5 };
  await f.owner.mutation(api.assets.saveAnalysis, { projectId: f.projectId, assetId: f.assetId, workerSecret, beats: older });
  const taskId = await f.start();
  expect(await f.owner.query(api.mediaTasks.get, { taskId })).toMatchObject({ status: 'queued' });
  await f.drain(); const work = (await f.claim())!;
  await f.t.mutation(api.mediaTasks.complete, { taskId, leaseToken: work.leaseToken, result: { analysis: { beats: measured } } });
  await f.drain();
  expect((await f.read()).analysis?.beats).toEqual(measured);
});
