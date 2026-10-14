import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import { EMPTY_TIMELINE, type Timeline } from '../lib/editor/types';
import { removeTimelineMarker, removeTimelineMarkers } from '../lib/editor/timeline-markers';
import { EditSession } from './lib/editSession';

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

async function markerSession() {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Remove markers', aspectRatio: 'vertical' });
  const original: Timeline = {
    ...EMPTY_TIMELINE,
    clips: [{ id: 'title', kind: 'caption', track: 1, start: 0, duration: 5, sourceStart: 0, text: 'Keep this' }],
    markers: [{ id: 'beat-1', time: 1 }, { id: 'manual', time: 2, label: 'My cue' }, { id: 'beat-2', time: 3 }],
  };
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: original, expectedRevision: 0 });
  await t.run(ctx => writeProject(ctx,projectId, { aiRunning: true, aiRunId: 'remove-markers' }));
  const run = { projectId, ownerId: 'owner', runId: 'remove-markers' };
  const storage = {
    apply: (timeline: Timeline, expectedRevision: number) => t.mutation(internal.assistant.apply, { ...run, timeline, expectedRevision }),
    validate: (timeline: Timeline, expectedRevision: number) => t.query(internal.assistant.validateDraft, { ...run, timeline, expectedRevision }),
  };
  const session = new EditSession(original, 1, storage);
  const read = () => owner.query(api.projects.get, { projectId });
  return { t, owner, projectId, original, run, storage, session, read };
}

test('AI individual and clear-all marker edits save live, preserve clips, and share one undo group', async () => {
  const { owner, projectId, original, session, read } = await markerSession();
  const one = await session.checkpoint(t => removeTimelineMarker(t, 'beat-1'));
  expect(one).toMatchObject({ saved: true, staged: false, changedClips: [], removedClipIds: [], removedMarkerIds: ['beat-1'] });
  expect((await read()).timeline?.markers).toEqual(original.markers!.slice(1));
  const rest = await session.checkpoint(removeTimelineMarkers);
  expect(rest).toMatchObject({ saved: true, staged: false, removedMarkerIds: ['manual', 'beat-2'] });
  expect((await read()).timeline).toMatchObject({ clips: original.clips, markers: [] });
  const empty = await session.checkpoint(removeTimelineMarkers);
  expect(empty).toMatchObject({ unchanged: true, saved: false, removedMarkerIds: [], revision: rest.revision });
  expect((await read()).revision).toBe(rest.revision);
  await session.complete('stop');
  await owner.mutation(api.projects.undo, { projectId });
  expect((await read()).timeline).toMatchObject({ clips: original.clips, markers: original.markers });
});

test('AI selected marker removal preserves manual cues and unknown IDs make no save', async () => {
  const { original, session, read } = await markerSession();
  const absent = await session.checkpoint(t => removeTimelineMarker(t, 'missing'));
  expect(absent).toMatchObject({ unchanged: true, saved: false, removedMarkerIds: [], revision: 1 });
  const selected = await session.checkpoint(t => removeTimelineMarkers(t, ['beat-1', 'beat-1', 'beat-2', 'missing']));
  expect(selected.removedMarkerIds).toEqual(['beat-1', 'beat-2']);
  expect((await read()).timeline).toMatchObject({ clips: original.clips, markers: [original.markers![1]] });
});

test('marker removal in a staged replacement remains private until the replacement saves', async () => {
  const { original, session, read } = await markerSession();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  const removal = await session.checkpoint(removeTimelineMarkers);
  expect(removal).toMatchObject({ saved: false, staged: true, removedMarkerIds: original.markers!.map(marker => marker.id), changedClips: [], removedClipIds: [] });
  expect((await read()).timeline?.markers).toEqual(original.markers);
  await session.checkpoint(t => ({ ...t, clips: [{ ...original.clips[0], text: 'Replacement' }] }));
  await session.complete('stop');
  expect((await read()).timeline?.markers).toEqual([]);
});

test('failed replacement never publishes its marker removal', async () => {
  const { original, session, read } = await markerSession();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await session.checkpoint(removeTimelineMarkers);
  await expect(session.complete('length')).rejects.toThrow('replacement was not saved');
  expect((await read()).timeline?.markers).toEqual(original.markers);
});

test('AI marker removal enforces ownership and preserves a competing manual revision', async () => {
  const { t, owner, projectId, original, run, session, read } = await markerSession();
  await expect(t.mutation(internal.assistant.apply, { ...run, ownerId: 'stranger', timeline: removeTimelineMarkers(original), expectedRevision: 1 })).rejects.toThrow('Project not found');
  const manual = { ...original, markers: [...original.markers!, { id: 'new-manual-cue', time: 4 }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: manual, expectedRevision: 1 });
  await expect(session.checkpoint(removeTimelineMarkers)).rejects.toThrow('timeline changed elsewhere');
  expect((await read()).timeline?.markers).toEqual(manual.markers);
});
