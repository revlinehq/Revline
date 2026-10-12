/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import type { Timeline } from '../lib/editor/types';

const modules = import.meta.glob('./**/*.ts');
const base: Timeline = {
  fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1 },
  clips: [{ id: 'caption', kind: 'caption', track: 2, start: 0, duration: 3, sourceStart: 0, text: 'Original', fontSize: 32 }],
};

test('manual timing saves after a live Claude styling update without losing either edit', async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Live edits', aspectRatio: 'landscape' });
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: base, expectedRevision: 0 });
  await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: 'live-run' }));
  await t.mutation(internal.assistant.apply, {
    projectId, ownerId: 'owner', runId: 'live-run', expectedRevision: 1,
    timeline: { ...base, clips: [{ ...base.clips[0], fontSize: 48 }] },
  });
  const manual = { ...base, clips: [{ ...base.clips[0], start: 1 }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: manual, expectedRevision: 1 });
  const saved = await owner.query(api.projects.get, { projectId });
  expect(saved.timeline?.clips[0]).toMatchObject({ start: 1, fontSize: 48 });
  expect(saved.revision).toBe(3);
  // The stale AI working snapshot still cannot overwrite this manual edit.
  await expect(t.mutation(internal.assistant.apply, {
    projectId, ownerId: 'owner', runId: 'live-run', expectedRevision: 2,
    timeline: { ...base, clips: [{ ...base.clips[0], text: 'Stale AI snapshot', fontSize: 48 }] },
  })).rejects.toThrow('timeline changed elsewhere');
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline?.clips[0]).toMatchObject({ start: 0, fontSize: 48 });
});

test('two open editors preserve independent changes and reject foreign or invalid writes', async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Two editors', aspectRatio: 'landscape' });
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: base, expectedRevision: 0 });
  await owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: { ...base, aspectRatio: 'square' }, expectedRevision: 1 });
  const next = { ...base, clips: [{ ...base.clips[0], text: 'Second editor' }] };
  const result = await owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: next, expectedRevision: 1 });
  expect(result.timeline).toMatchObject({ aspectRatio: 'square', clips: [{ text: 'Second editor' }] });
  await expect(t.withIdentity({ subject: 'stranger' }).mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: next, expectedRevision: 1 })).rejects.toThrow('Project not found');
  await expect(owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: next, expectedRevision: 100 })).rejects.toThrow('Invalid timeline revision');
  await expect(owner.mutation(api.projects.saveTimeline, { projectId, baseTimeline: base, timeline: { ...next, clips: [{ ...next.clips[0], duration: -1 }] }, expectedRevision: 1 })).rejects.toThrow('Clip timing');
  expect((await owner.query(api.projects.get, { projectId })).revision).toBe(3);
});
