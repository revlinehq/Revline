/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { EMPTY_TIMELINE, type Timeline } from '../lib/editor/types';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('BILLING_ENABLED', 'false'));
afterEach(() => vi.unstubAllEnvs());

test('beat markers persist, rebase independent live edits, and undo with the project', async () => {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Beat edit', aspectRatio: 'vertical' });
  const original: Timeline = { ...EMPTY_TIMELINE, markers: [{ id: 'drop', time: 1, label: 'Beat drop' }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: original, expectedRevision: 0 });
  const remote: Timeline = { ...original, markers: [{ ...original.markers![0], label: 'Main drop' }, { id: 'outro', time: 600 }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: remote, expectedRevision: 1 });
  const moved: Timeline = { ...original, markers: [{ ...original.markers![0], time: 2.5 }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: moved, baseTimeline: original, expectedRevision: 1 });
  expect((await owner.query(api.projects.get, { projectId })).timeline?.markers).toEqual([{ id: 'drop', time: 2.5, label: 'Main drop' }, { id: 'outro', time: 600 }]);
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline?.markers).toEqual(remote.markers);
  await expect(t.withIdentity({ subject: 'stranger' }).mutation(api.projects.saveTimeline, { projectId, timeline: moved, expectedRevision: 4 })).rejects.toThrow('Project not found');
});

test('invalid marker timing, identifiers and labels cannot change the saved project', async () => {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Beat edit', aspectRatio: 'vertical' });
  for (const markers of [[{ id: 'bad', time: -1 }], [{ id: 'bad', time: Infinity }], [{ id: 'same', time: 1 }, { id: 'same', time: 2 }], [{ id: 'long', time: 1, label: 'x'.repeat(121) }]]) {
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...EMPTY_TIMELINE, markers }, expectedRevision: 0 })).rejects.toThrow(/Marker/);
  }
  expect((await owner.query(api.projects.get, { projectId })).revision).toBe(0);
});
