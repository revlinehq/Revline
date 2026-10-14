/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import mediaWorker from '../cloudflare/media/worker';

const modules = import.meta.glob('./**/*.ts');
const fixture = internal.processorDiagnostics.createExportFixture;
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('RENDER_WORKER_SECRET', 'processor-check-secret'); vi.stubEnv('MEDIA_PROCESSOR_WAKE_URL', ''); vi.stubEnv('BILLING_ENABLED', 'true'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test('the admin fixture queues an isolated one-second render through the normal worker interface', async () => {
  const t = convexTest(schema, modules); workflowTest.register(t);
  const created = await t.mutation(fixture, {});
  expect(created.ownerId).toMatch(/^revline-hosting-smoke-[\da-f-]+$/);
  const owner = t.withIdentity({ subject: created.ownerId });
  const project = await owner.query(api.projects.get, { projectId: created.projectId });
  expect(project.timeline).toMatchObject({ fps: 24, aspectRatio: 'landscape', clips: [{ kind: 'graphic', start: 0, duration: 1, text: 'Hosted export check' }] });
  expect(await owner.query(api.assets.list, { projectId: created.projectId })).toEqual([]);
  expect(await owner.query(api.renders.get, { jobId: created.jobId })).toMatchObject({ status: 'queued', resolution: 720, fps: 24, quality: 'draft', taskId: created.taskId, assetIds: [] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const work = await t.mutation(api.mediaTasks.claim, { workerSecret: 'processor-check-secret' });
  expect(work).toMatchObject({ taskId: created.taskId, projectId: created.projectId, renderJobId: created.jobId, kind: 'render', render: { resolution: 720, fps: 24, quality: 'draft', assets: [] } });
  await expect(t.withIdentity({ subject: 'customer' }).query(api.projects.get, { projectId: created.projectId })).rejects.toThrow('Project not found');
});

test('the hosted export fixture can open a signed multipart upload through the storage Worker', async () => {
  vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example'); vi.stubEnv('MEDIA_SIGNING_SECRET', 'fixture-storage-secret');
  const t = convexTest(schema, modules); workflowTest.register(t);
  const created = await t.mutation(fixture, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const task = (await t.mutation(api.mediaTasks.claim, { workerSecret: 'processor-check-secret' }))!;
  const responses: number[] = [];
  const env = { MEDIA_SIGNING_SECRET: 'fixture-storage-secret', ALLOWED_ORIGINS: '', MEDIA: { createMultipartUpload: async () => ({ uploadId: 'storage-fixture-upload' }) } } as unknown as Parameters<typeof mediaWorker.fetch>[1];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await mediaWorker.fetch(new Request(input, init) as Parameters<typeof mediaWorker.fetch>[0], env);
    responses.push(response.status); return response;
  });
  const result = await t.action(api.r2.start, { projectId: created.projectId, jobId: created.jobId, taskId: task.taskId, leaseToken: task.leaseToken, fileName: 'video.mp4', kind: 'video', contentType: 'video/mp4', size: 1024, duration: 1, width: 1280, height: 720 }).catch(() => null);
  expect(responses).toEqual([200]);
  expect(result).toMatchObject({ uploadId: expect.any(String), partCount: 1, partSize: 33554432 });
});

test('the stacked shader fixture stores generated media, preserves both timed passes and cleans up normally', async () => {
  const t = convexTest(schema, modules); workflowTest.register(t);
  const created = await t.action(internal.processorDiagnostics.createStackedEffectsFixture, {});
  const owner = t.withIdentity({ subject: created.ownerId });
  const project = await owner.query(api.projects.get, { projectId: created.projectId });
  expect(project.timeline?.clips).toMatchObject([
    { kind: 'image', dither: { enabled: true, amount: 1, levels: 2, size: 8 } },
    { kind: 'effect', track: 1, effectPreset: 'zoom-blur', zoomBlur: { amount: .15 } },
    { kind: 'effect', track: 2, effectPreset: 'zoom-blur', zoomBlur: { amount: .15 } },
    { kind: 'graphic', text: '', background: 'transparent' },
  ]);
  const assets = await owner.query(api.assets.list, { projectId: created.projectId });
  expect(assets).toHaveLength(1);
  expect(assets[0]).toMatchObject({ fileName: 'generated-shader-check.svg', kind: 'image', width: 640, height: 360, ownerId: created.ownerId });
  const storageId = assets[0].storageId!;
  const pixels = await t.run(async ctx => (await ctx.storage.get(storageId))?.text());
  expect(pixels).toContain('<svg'); expect(pixels).not.toMatch(/(?:<script|(?:href|src)=)/);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const task = (await t.mutation(api.mediaTasks.claim, { workerSecret: 'processor-check-secret' }))!;
  expect(task).toMatchObject({ taskId: created.taskId, render: { assets: [{ _id: assets[0]._id, kind: 'image' }], timeline: project.timeline } });
  await expect(t.withIdentity({ subject: 'customer' }).query(api.projects.get, { projectId: created.projectId })).rejects.toThrow('Project not found');
  await t.run(async ctx => { await ctx.db.patch(created.jobId, { status: 'failed' }); });
  await owner.mutation(api.projects.remove, { projectId: created.projectId });
  expect(await t.run(ctx => ctx.storage.get(storageId))).toBeNull();
  expect(await t.run(ctx => ctx.db.get(created.projectId))).toBeNull();
  expect(await t.run(ctx => ctx.db.get(created.taskId))).toBeNull();
});
