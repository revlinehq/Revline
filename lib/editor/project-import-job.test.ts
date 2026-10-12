import { afterEach, expect, test, vi } from 'vitest';
import type { Id } from '@/convex/_generated/dataModel';
import { createProjectImportSession, importProjectSources } from './project-import';
import { clearProjectImportJob, getOrCreateProjectImportJob, getProjectImportJob, ProjectImportJob } from './project-import-job';
import { EMPTY_TIMELINE, type Timeline } from './types';

const projectId = 'project' as Id<'projects'>;
const assetId = 'asset' as Id<'assets'>;
const input = () => ({ title: 'My footage', files: [{ id: 'source-one', file: new File(['footage'], 'footage.mp4', { type: 'video/mp4' }) }], assetIds: [] });

function harness() {
  let timeline: Timeline = { ...EMPTY_TIMELINE, clips: [] };
  let revision = 0;
  const dependencies = {
    stage: vi.fn(async () => undefined),
    create: vi.fn(async () => projectId),
    project: vi.fn(async () => ({ timeline, revision })),
    upload: vi.fn(async (_projectId, _file, progress) => { progress(41, 'uploading'); return assetId; }),
    asset: vi.fn(async () => ({ _id: assetId, fileName: 'footage.mp4', kind: 'video' as const, duration: 12, url: null })),
    save: vi.fn(async (_projectId, next, expectedRevision) => { expect(expectedRevision).toBe(revision); timeline = next; return ++revision; }),
    acknowledge: vi.fn(async () => undefined),
  } satisfies Parameters<typeof importProjectSources>[2];
  return { dependencies, timeline: () => timeline };
}

afterEach(() => {
  for (const ownerId of ['owner-a', 'owner-b']) {
    const job = getProjectImportJob(ownerId);
    if (job) clearProjectImportJob(job);
  }
});

test('simultaneous views share one import promise, creation, and upload', async () => {
  const h = harness();
  const first = getOrCreateProjectImportJob('owner-a', createProjectImportSession(), input());
  const firstRun = first.start(h.dependencies);
  const remounted = getOrCreateProjectImportJob('owner-a', createProjectImportSession(), input());
  const secondRun = remounted.start(h.dependencies);
  expect(remounted).toBe(first);
  expect(secondRun).toBe(firstRun);
  await expect(firstRun).resolves.toBe(projectId);
  expect(h.dependencies.create).toHaveBeenCalledTimes(1);
  expect(h.dependencies.upload).toHaveBeenCalledTimes(1);
  expect(h.timeline().clips).toHaveLength(1);
});

test('a completed job returns its project without importing again', async () => {
  const h = harness();
  const job = new ProjectImportJob('owner-a', createProjectImportSession(), input());
  await job.start(h.dependencies);
  await expect(job.start(h.dependencies)).resolves.toBe(projectId);
  expect(h.dependencies.create).toHaveBeenCalledTimes(1);
  expect(h.dependencies.upload).toHaveBeenCalledTimes(1);
});

test('publishes upload progress and keeps the session for retry after a save failure', async () => {
  const h = harness();
  const session = createProjectImportSession();
  const job = new ProjectImportJob('owner-a', session, input());
  const snapshots: Array<{ phase: string; percent: number; error: string | null }> = [];
  const unsubscribe = job.subscribe(() => snapshots.push({ phase: job.progress.phase, percent: job.progress.percent, error: job.error }));
  h.dependencies.save.mockRejectedValueOnce(new Error('Saving was interrupted.'));
  await expect(job.start(h.dependencies)).rejects.toThrow('Saving was interrupted.');
  expect(job.session).toBe(session);
  expect(job.error).toBe('Saving was interrupted.');
  expect(job.progress.phase).toBe('error');
  expect(snapshots).toContainEqual({ phase: 'uploading', percent: 41, error: null });
  await expect(job.start(h.dependencies)).resolves.toBe(projectId);
  expect(job.error).toBeNull();
  expect(job.progress.phase).toBe('opening');
  expect(h.dependencies.create).toHaveBeenCalledTimes(1);
  expect(h.dependencies.upload).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test('a disconnected view can unsubscribe while another view observes the ongoing upload', async () => {
  const h = harness();
  const job = new ProjectImportJob('owner-a', createProjectImportSession(), input());
  const oldView = vi.fn();
  const unsubscribe = job.subscribe(oldView);
  const run = job.start(h.dependencies);
  unsubscribe();
  const oldCallCount = oldView.mock.calls.length;
  const newView = vi.fn();
  job.subscribe(newView);
  expect(job.start(h.dependencies)).toBe(run);
  await run;
  expect(oldView).toHaveBeenCalledTimes(oldCallCount);
  expect(newView).toHaveBeenCalled();
  expect(h.dependencies.upload).toHaveBeenCalledTimes(1);
});

test('jobs are scoped by owner and an old job cannot clear a newer owner’s job', () => {
  const first = getOrCreateProjectImportJob('owner-a', createProjectImportSession(), input());
  expect(getProjectImportJob('owner-a')).toBe(first);
  expect(getProjectImportJob('owner-b')).toBeUndefined();
  expect(getProjectImportJob(undefined)).toBeUndefined();
  const second = getOrCreateProjectImportJob('owner-b', createProjectImportSession(), input());
  clearProjectImportJob(first);
  expect(getProjectImportJob('owner-b')).toBe(second);
  expect(getProjectImportJob('owner-a')).toBeUndefined();
  clearProjectImportJob(second);
  expect(getProjectImportJob('owner-b')).toBeUndefined();
});

test('non-Error failures still expose a readable retry message', async () => {
  const h = harness();
  const job = new ProjectImportJob('owner-a', createProjectImportSession(), input());
  h.dependencies.create.mockRejectedValueOnce(null);
  await expect(job.start(h.dependencies)).rejects.toBeNull();
  expect(job.error).toBe('Could not prepare your footage. Retry to continue from where it stopped.');
  expect(job.progress.phase).toBe('error');
});
