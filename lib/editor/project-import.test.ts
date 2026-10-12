import { describe, expect, test, vi } from 'vitest';
import type { Id } from '@/convex/_generated/dataModel';
import { createProjectImportSession, importProjectSources, type ProjectImportProgress } from './project-import';
import { EMPTY_TIMELINE, type Timeline } from './types';

const projectId = 'project' as Id<'projects'>;
const assetId = 'asset' as Id<'assets'>;
const source = (id = 'one') => ({ id, file: new File(['footage'], id + '.mp4', { type: 'video/mp4' }) });

function harness(duration = 12) {
  let timeline: Timeline = { ...EMPTY_TIMELINE, clips: [] };
  let revision = 0;
  let draft = new Set<File>();
  const dependencies = {
    stage: vi.fn(async (files: File[]) => { draft = new Set(files); }),
    create: vi.fn(async () => projectId),
    project: vi.fn(async () => ({ timeline, revision })),
    upload: vi.fn(async (_id, _file, progress) => { progress(0, 'reading'); progress(41, 'uploading'); return assetId; }),
    asset: vi.fn(async (_id, id) => ({ _id: id, fileName: 'footage.mp4', kind: 'video' as const, duration, url: null })),
    save: vi.fn(async (_id, next, expectedRevision) => { expect(expectedRevision).toBe(revision); timeline = next; return ++revision; }),
    acknowledge: vi.fn(async (file: File) => { draft.delete(file); }),
  } satisfies Parameters<typeof importProjectSources>[2];
  return { dependencies, timeline: () => timeline, draft: () => [...draft] };
}

describe('automatic project import', () => {
  test('imports immediately, saves the clip before acknowledging, and reports real progress', async () => {
    const h = harness();
    const progress: ProjectImportProgress[] = [];
    await expect(importProjectSources(createProjectImportSession(), { title: 'My footage', files: [source()], assetIds: [] }, h.dependencies, value => progress.push(value))).resolves.toBe(projectId);
    expect(progress.map(value => value.phase)).toEqual(['preparing', 'reading', 'uploading', 'saving', 'opening']);
    expect(progress[2].percent).toBe(41);
    expect(h.timeline().clips).toHaveLength(1);
    expect(h.dependencies.save.mock.invocationCallOrder[0]).toBeLessThan(h.dependencies.acknowledge.mock.invocationCallOrder[0]);
  });

  test('retry preserves the project and completed upload after a failed timeline save', async () => {
    const h = harness();
    const session = createProjectImportSession();
    const input = { title: 'My footage', files: [source()], assetIds: [] };
    h.dependencies.save.mockRejectedValueOnce(new Error('Connection interrupted'));
    await expect(importProjectSources(session, input, h.dependencies, () => {})).rejects.toThrow('Connection interrupted');
    expect(h.dependencies.acknowledge).not.toHaveBeenCalled();
    await importProjectSources(session, input, h.dependencies, () => {});
    expect(h.dependencies.create).toHaveBeenCalledTimes(1);
    expect(h.dependencies.upload).toHaveBeenCalledTimes(1);
    expect(h.timeline().clips).toHaveLength(1);
  });

  test('an acknowledgement retry never adds a second copy of a saved clip', async () => {
    const h = harness();
    const session = createProjectImportSession();
    const input = { title: 'My footage', files: [source()], assetIds: [] };
    h.dependencies.acknowledge.mockRejectedValueOnce(new Error('Draft storage unavailable'));
    await expect(importProjectSources(session, input, h.dependencies, () => {})).rejects.toThrow('Draft storage unavailable');
    await importProjectSources(session, input, h.dependencies, () => {});
    expect(h.dependencies.upload).toHaveBeenCalledTimes(1);
    expect(h.dependencies.save).toHaveBeenCalledTimes(1);
    expect(h.timeline().clips).toHaveLength(1);
  });

  test('keeps earlier successful files when a later upload needs a retry', async () => {
    const h = harness();
    const session = createProjectImportSession();
    const input = { title: 'Two files', files: [source(), source('two')], assetIds: [] };
    h.dependencies.upload.mockResolvedValueOnce(assetId).mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValueOnce('asset-two' as Id<'assets'>);
    await expect(importProjectSources(session, input, h.dependencies, () => {})).rejects.toThrow('Upload failed');
    expect(session.completed.has('one')).toBe(true);
    await importProjectSources(session, input, h.dependencies, () => {});
    expect(h.dependencies.create).toHaveBeenCalledTimes(1);
    expect(h.dependencies.upload).toHaveBeenCalledTimes(3);
    expect(h.timeline().clips).toHaveLength(2);
    expect(h.draft()).toEqual([]);
    expect(h.dependencies.stage.mock.calls[1][0]).toEqual([input.files[1].file]);
  });

  test('imports saved cloud footage through project creation without uploading it again', async () => {
    const h = harness();
    await importProjectSources(createProjectImportSession(), { title: 'Saved footage', files: [], assetIds: [assetId] }, h.dependencies, () => {});
    expect(h.dependencies.create).toHaveBeenCalledWith('Saved footage', [assetId]);
    expect(h.dependencies.upload).not.toHaveBeenCalled();
  });

  test('keeps full source duration while fitting the initial clip into the composition limit', async () => {
    const h = harness(900);
    await importProjectSources(createProjectImportSession(), { title: 'Long footage', files: [source()], assetIds: [] }, h.dependencies, () => {});
    expect(h.timeline().clips[0].duration).toBe(300);
    expect((await h.dependencies.asset(projectId, assetId)).duration).toBe(900);
    expect(h.dependencies.acknowledge).toHaveBeenCalledTimes(1);
  });
});
