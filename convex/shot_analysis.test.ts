/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `https://test.clerk.accounts.dev|${subject}` });
const shots = { fps: 24, shots: [{ start: 0, end: 1, startFrame: 0, endFrame: 24 }, { start: 1, end: 3, startFrame: 24, endFrame: 72 }] };
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('RENDER_WORKER_SECRET', 'test-secret'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture() {
  const t = convexTest(schema, modules); workflowTest.register(t);
  const owner = t.withIdentity(identity('owner'));
  const projectId = await owner.mutation(api.projects.create, { title: 'Shot fixture', aspectRatio: 'vertical' });
  const assetId = await t.run(async ctx => ctx.db.insert('assets', { storageId: await ctx.storage.store(new Blob(['source'])), ownerId: 'owner', projectId, fileName: 'source.mp4', contentType: 'video/mp4', size: 100, kind: 'video', duration: 3, createdAt: Date.now() }));
  return { t, owner, projectId, assetId };
}
test('persists both semantic descriptions and measured shots and records fresh completion', async () => {
  const { t, owner, projectId, assetId } = await fixture();
  await owner.mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: 'test-secret', shots, understanding: { summary: 'A launch.', scenes: [{ start: 0.8, end: 3, description: 'A launch.', score: 0.9 }] } });
  const asset = await t.run(ctx => ctx.db.get(assetId));
  expect(asset?.analysis?.shots).toEqual(shots);
  expect(asset?.analysisCompletedAt?.shots).toBeGreaterThan(0);
  expect(asset?.analysisCompletedAt?.understand).toBe(asset?.analysisCompletedAt?.shots);
});
test('rejects cross-user and malformed source-frame results', async () => {
  const { t, owner, projectId, assetId } = await fixture();
  await expect(t.withIdentity(identity('stranger')).mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: 'test-secret', shots })).rejects.toThrow('Project not found');
  await expect(owner.mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: 'test-secret', shots: { ...shots, shots: [{ start: 0, end: 9, startFrame: 0, endFrame: 216 }] } })).rejects.toThrow('Invalid shot boundaries');
});
test('shot-only requests complete only after fresh results are saved', async () => {
  const { t, projectId, assetId } = await fixture();
  await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: 'test-run' }));
  const requestId = await t.mutation(internal.assistant.requestAnalysis, { projectId, ownerId: 'owner', runId: 'test-run', assetId, mode: 'shots' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const work = (await t.mutation(api.mediaTasks.claim, { workerSecret: 'test-secret' }))!;
  await expect(t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: {} })).rejects.toThrow('result is missing');
  expect((await t.run(ctx => ctx.db.get(requestId)))?.status).toBe('running');
  await t.mutation(api.mediaTasks.complete, { taskId: work.taskId, leaseToken: work.leaseToken, result: { analysis: { shots } } });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.run(ctx => ctx.db.get(requestId)))?.status).toBe('completed');
});
