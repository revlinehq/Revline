import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { EditSession } from './lib/editSession';
import type { Timeline } from '../lib/editor/types';
import { addMediaClip, deleteClip } from '../lib/editor/operations';

const modules = import.meta.glob('./**/*.ts');
const original: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [{ id: 'original', kind: 'caption', text: 'Original edit', start: 0, sourceStart: 0, duration: 5, track: 1 }] };

async function setup(signal?: AbortSignal) {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Atomic replacement', aspectRatio: 'landscape' });
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: original, expectedRevision: 0 });
  await t.run(ctx => writeProject(ctx,projectId, { aiRunning: true, aiRunId: 'run' }));
  const run = { projectId, ownerId: 'owner', runId: 'run' };
  const read = () => owner.query(api.projects.get, { projectId });
  const session = new EditSession(original, 1, {
    apply: (timeline, expectedRevision) => t.mutation(internal.assistant.apply, { ...run, timeline, expectedRevision }),
    validate: (timeline, expectedRevision) => t.query(internal.assistant.validateDraft, { ...run, timeline, expectedRevision }),
  }, signal);
  return { t, owner, projectId, run, read, session };
}

test('inspection and unchanged checkpoints do not begin a timeline edit', async () => {
  let starts = 0;
  const session = new EditSession(original, 1, {
    beforeChange: async () => { starts++; },
    apply: async () => { throw new Error('No change should be published'); },
    validate: async () => { throw new Error('No draft should be staged'); },
  });
  await session.inspect(async () => ({ timeline: original, revision: 1 }));
  expect(await session.checkpoint(timeline => structuredClone(timeline))).toMatchObject({ unchanged: true, saved: false });
  expect(starts).toBe(0);
});

test.each(['live', 'staged'])('%s checkpoints wait for the timeline lock before changing the working snapshot', async mode => {
  const started = Promise.withResolvers<void>(), unlocked = Promise.withResolvers<void>();
  const events: string[] = [];
  const session = new EditSession(original, 1, {
    beforeChange: async () => { events.push('begin'); started.resolve(); await unlocked.promise; events.push('locked'); },
    apply: async () => { events.push('apply'); return 2; },
    validate: async () => { events.push('validate'); },
  });
  const change = session.checkpoint(timeline => mode === 'staged' ? { ...timeline, clips: [] } : { ...timeline, clips: timeline.clips.map(clip => ({ ...clip, text: 'Changed' })) });
  await started.promise;
  expect(events).toEqual(['begin']);
  expect(session.staged).toBe(false);
  expect(session.timeline.clips).toEqual(original.clips);
  unlocked.resolve(); await change;
  expect(events).toEqual(['begin', 'locked', mode === 'staged' ? 'validate' : 'apply']);
  expect(session.staged).toBe(mode === 'staged');
});

test('delete-all then rebuild never publishes an empty checkpoint and saves once', async () => {
  const { session, read } = await setup();
  const deletion = await session.checkpoint(t => ({ ...t, clips: [] }));
  expect((await read()).timeline?.clips).toEqual(original.clips);
  expect(deletion).toMatchObject({ applied: false, saved: false, staged: true, revision: 1 });
  await session.checkpoint(t => ({ ...t, clips: [{ ...original.clips[0], id: 'replacement', text: 'Replacement' }] }));
  expect((await read()).revision).toBe(1);
  await session.complete('stop');
  expect((await read()).timeline?.clips[0].id).toBe('replacement');
  expect((await read()).revision).toBe(2);
});

test('inspection keeps the private replacement and delete-all can intentionally complete', async () => {
  const { session, read, owner, projectId } = await setup();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  const inspected = await session.inspect(async () => { const p = await read(); return { timeline: p.timeline!, revision: p.revision! }; });
  expect(inspected.timeline.clips).toEqual([]);
  expect(inspected.staged).toBe(true);
  expect((await read()).timeline?.clips).toEqual(original.clips);
  await session.complete('stop');
  expect((await read()).timeline?.clips).toEqual([]);
  await owner.mutation(api.projects.undo, { projectId });
  expect((await read()).timeline?.clips).toEqual(original.clips);
});

test.each(['error', 'length', 'tool-calls'])('incomplete %s generation discards replacement', async finishReason => {
  const { session, read } = await setup();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await expect(session.complete(finishReason)).rejects.toThrow('replacement was not saved');
  expect((await read()).timeline?.clips).toEqual(original.clips);
  expect((await read()).revision).toBe(1);
});

test('failed tool never publishes a partial replacement even when generation ends normally', async () => {
  const { session, read } = await setup();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await expect(session.checkpoint(t => ({ ...t, clips: [{ ...original.clips[0], duration: -1 }] }))).rejects.toThrow('Clip timing');
  await expect(session.complete('stop')).rejects.toThrow('replacement was not saved');
  expect((await read()).timeline?.clips).toEqual(original.clips);
});

test('analysis/tool errors outside checkpoint also block destructive completion', async () => {
  const { session, read } = await setup();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await expect(session.complete('stop', true)).rejects.toThrow('replacement was not saved');
  expect((await read()).revision).toBe(1);
});

test('stop invalidates the run and prevents publishing its staged deletion', async () => {
  const { session, read, owner, projectId } = await setup();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await owner.mutation(api.assistant.stop, { projectId });
  await expect(session.complete('stop')).rejects.toThrow('AI run is no longer active');
  expect((await read()).timeline?.clips).toEqual(original.clips);
});

test('abort signal discards pending replacement', async () => {
  const controller = new AbortController();
  const { session, read } = await setup(controller.signal);
  await session.checkpoint(t => ({ ...t, clips: [] }));
  controller.abort();
  await expect(session.complete('stop')).rejects.toThrow();
  expect((await read()).revision).toBe(1);
});

test('concurrent manual changes win over the staged replacement, including inspect refresh', async () => {
  const { session, read, owner, projectId } = await setup();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: { ...original, clips: [{ ...original.clips[0], text: 'Manual edit' }] } });
  await expect(session.inspect(async () => { const p = await read(); return { timeline: p.timeline!, revision: p.revision! }; })).rejects.toThrow('timeline changed elsewhere');
  await expect(session.complete('stop')).rejects.toThrow('replacement was not saved');
  expect((await read()).timeline?.clips[0].text).toBe('Manual edit');
});

test('manual change immediately before publication is protected by final mutation', async () => {
  const { session, read, owner, projectId } = await setup();
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: { ...original, aspectRatio: 'square' } });
  await expect(session.complete('stop')).rejects.toThrow('timeline changed elsewhere');
  expect((await read()).timeline?.aspectRatio).toBe('square');
  expect((await read()).timeline?.clips).toEqual(original.clips);
});

test('ordinary text edits remain live and parallel tools serialize from the latest draft', async () => {
  const { session, read } = await setup();
  const results = await Promise.all([
    session.checkpoint(t => ({ ...t, clips: t.clips.map(c => ({ ...c, text: 'Live update' })) })),
    session.checkpoint(t => ({ ...t, clips: t.clips.map(c => ({ ...c, fontSize: 48 })) })),
  ]);
  expect(results.every(result => result.saved && !result.staged)).toBe(true);
  expect((await read()).timeline?.clips[0]).toMatchObject({ text: 'Live update', fontSize: 48 });
  expect((await read()).revision).toBe(3);
  await session.complete('stop');
  expect((await read()).revision).toBe(3);
});

test('staging validation rejects foreign ownership, stale runs, and foreign media', async () => {
  const { t, run, session, read } = await setup();
  await expect(t.query(internal.assistant.validateDraft, { ...run, ownerId: 'stranger', expectedRevision: 1, timeline: original })).rejects.toThrow('Project not found');
  await expect(t.query(internal.assistant.validateDraft, { ...run, runId: 'old-run', expectedRevision: 1, timeline: original })).rejects.toThrow('AI run is no longer active');
  await session.checkpoint(t => ({ ...t, clips: [] }));
  await expect(session.checkpoint(t => ({ ...t, clips: [{ id: 'foreign', kind: 'video', assetId: 'not-owned', track: 1, start: 0, sourceStart: 0, duration: 5 }] }))).rejects.toThrow('Clip media must belong');
  expect((await read()).revision).toBe(1);
});

test('linked video/audio delete and replacement publish together with one undo', async () => {
  const { t, owner, projectId, run, read } = await setup();
  const asset = await t.run(async ctx => {
    const common = { ownerId: 'owner', projectId, size: 100, duration: 20, createdAt: 1 };
    const audioAssetId = await ctx.db.insert('assets', { ...common, kind: 'audio', fileName: 'audio.m4a', contentType: 'audio/mp4' });
    const id = await ctx.db.insert('assets', { ...common, kind: 'video', fileName: 'video.mp4', contentType: 'video/mp4', audioAssetId, audioExtracted: true });
    return { _id: id, kind: 'video' as const, audioAssetId, duration: 20 };
  });
  const initial = addMediaClip({ ...original, clips: [], tracks: { visual: 1, overlay: 0, audio: 1 } }, asset, 'old-video');
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: initial });
  const session = new EditSession(initial, 2, {
    apply: (timeline, expectedRevision) => t.mutation(internal.assistant.apply, { ...run, timeline, expectedRevision }),
    validate: (timeline, expectedRevision) => t.query(internal.assistant.validateDraft, { ...run, timeline, expectedRevision }),
  });
  await session.checkpoint(t => deleteClip(t, 'old-video'));
  expect(session.timeline.clips).toHaveLength(0);
  expect((await read()).timeline?.clips).toEqual(initial.clips);
  await session.checkpoint(t => addMediaClip(t, asset, 'new-video'));
  expect((await read()).timeline?.clips).toEqual(initial.clips);
  await session.complete('stop');
  expect((await read()).timeline?.clips.map(clip => clip.id)).toEqual(['new-video', 'new-video-audio']);
  await owner.mutation(api.projects.undo, { projectId });
  expect((await read()).timeline?.clips).toEqual(initial.clips);
});

test('immediate conflicts refresh and rebase an unrelated manual field once', async () => {
  const f = await setup();
  const session = new EditSession(original, 1, {
    apply: (timeline, expectedRevision) => f.t.mutation(internal.assistant.apply, { ...f.run, timeline, expectedRevision }),
    validate: (timeline, expectedRevision) => f.t.query(internal.assistant.validateDraft, { ...f.run, timeline, expectedRevision }),
    refresh: async () => { const project = await f.read(); return { timeline: project.timeline!, revision: project.revision! }; },
  });
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 1, timeline: { ...original, clips: original.clips.map(clip => ({ ...clip, fontSize: 72 })) } });
  await expect(session.checkpoint(t => ({ ...t, clips: t.clips.map(clip => ({ ...clip, text: 'AI words' })) }))).resolves.toMatchObject({ saved: true, revision: 3 });
  expect((await f.read()).timeline?.clips[0]).toMatchObject({ text: 'AI words', fontSize: 72 });
});

test('same-field conflicts require inspection and never submit repeated stale writes', async () => {
  const f = await setup(); let attempts = 0;
  const session = new EditSession(original, 1, {
    apply: (timeline, expectedRevision) => { attempts++; return f.t.mutation(internal.assistant.apply, { ...f.run, timeline, expectedRevision }); },
    validate: (timeline, expectedRevision) => f.t.query(internal.assistant.validateDraft, { ...f.run, timeline, expectedRevision }),
    refresh: async () => { const project = await f.read(); return { timeline: project.timeline!, revision: project.revision! }; },
  });
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 1, timeline: { ...original, clips: original.clips.map(clip => ({ ...clip, text: 'Manual wins' })) } });
  await expect(session.checkpoint(t => ({ ...t, clips: t.clips.map(clip => ({ ...clip, text: 'AI words' })) }))).rejects.toThrow('Inspect');
  await expect(session.checkpoint(t => ({ ...t, clips: t.clips.map(clip => ({ ...clip, color: '#ffffff' })) }))).rejects.toThrow('Inspect');
  expect(attempts).toBe(1); expect(session.revision).toBe(2);
  await session.inspect(async () => { const project = await f.read(); return { timeline: project.timeline!, revision: project.revision! }; });
  await session.checkpoint(t => ({ ...t, clips: t.clips.map(clip => ({ ...clip, color: '#ffffff' })) }));
  expect((await f.read()).timeline?.clips[0]).toMatchObject({ text: 'Manual wins', color: '#ffffff' });
});

test('immediate tool failures are not reported as successful completion after prior saves', async () => {
  const f = await setup();
  await f.session.checkpoint(t => ({ ...t, clips: t.clips.map(clip => ({ ...clip, text: 'Already saved' })) }));
  await expect(f.session.complete('stop', true)).rejects.toThrow('saved');
  expect((await f.read()).timeline?.clips[0].text).toBe('Already saved');
  expect(f.session.savedEdits).toBe(1);
});

test('a second concurrent writer is bounded to one retry and requires inspection afterward', async () => {
  const f = await setup(); let attempts = 0;
  const session = new EditSession(original, 1, {
    apply: async (timeline, expectedRevision) => { attempts++; await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision, timeline: { ...original, clips: original.clips.map(clip => ({ ...clip, fontSize: 70 + attempts })) } }); return f.t.mutation(internal.assistant.apply, { ...f.run, timeline, expectedRevision }); },
    validate: (timeline, expectedRevision) => f.t.query(internal.assistant.validateDraft, { ...f.run, timeline, expectedRevision }),
    refresh: async () => { const project = await f.read(); return { timeline: project.timeline!, revision: project.revision! }; },
  });
  await expect(session.checkpoint(t => ({ ...t, clips: t.clips.map(clip => ({ ...clip, text: 'AI words' })) }))).rejects.toThrow('changed elsewhere');
  await expect(session.checkpoint(t => ({ ...t, aspectRatio: 'square' }))).rejects.toThrow('Inspect');
  expect(attempts).toBe(2); expect((await f.read()).timeline?.clips[0]).toMatchObject({ text: 'Original edit', fontSize: 72 });
});

test('retained source timing fields are one conflict group during an automatic rebase', async () => {
  const f = await setup();
  const session = new EditSession(original, 1, {
    apply: (timeline, expectedRevision) => f.t.mutation(internal.assistant.apply, { ...f.run, timeline, expectedRevision }),
    validate: (timeline, expectedRevision) => f.t.query(internal.assistant.validateDraft, { ...f.run, timeline, expectedRevision }),
    refresh: async () => { const project = await f.read(); return { timeline: project.timeline!, revision: project.revision! }; },
  });
  await f.owner.mutation(api.projects.saveTimeline, { projectId: f.projectId, expectedRevision: 1, timeline: { ...original, clips: original.clips.map(clip => ({ ...clip, sourceStart: 1 })) } });
  await expect(session.checkpoint(t => ({ ...t, clips: t.clips.map(clip => ({ ...clip, duration: 3 })) }))).rejects.toThrow('Inspect');
  expect((await f.read()).timeline?.clips[0]).toMatchObject({ sourceStart: 1, duration: 5 });
});
