/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const fixture = internal.processorDiagnostics.createExportFixture;
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('RENDER_WORKER_SECRET', 'processor-check-secret'); vi.stubEnv('MEDIA_PROCESSOR_WAKE_URL', ''); vi.stubEnv('BILLING_ENABLED', 'true'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

test('the admin fixture queues an isolated one-second render through the normal worker interface', async () => {
  const t = convexTest(schema, modules); workflowTest.register(t);
  const created = await t.mutation(fixture, {});
  expect(created.ownerId).toMatch(/^revline-hosting-smoke:[\da-f-]+$/);
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
