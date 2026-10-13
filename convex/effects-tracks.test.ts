/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import type { Timeline } from '../lib/editor/types';
import { deleteClip, placeOnFreeLayer } from '../lib/editor/operations';
import { deleteEmptyLayer } from '../lib/editor/timeline-controls';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('BILLING_ENABLED', 'false'));
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'FX tracks', aspectRatio: 'landscape' });
  const { videoId, audioId } = await t.run(async ctx => {
    const base = { ownerId: 'owner', projectId, size: 4, duration: 20, createdAt: Date.now() };
    return {
      videoId: await ctx.db.insert('assets', { ...base, kind: 'video', fileName: 'clip.mp4', contentType: 'video/mp4', r2Key: 'video' }),
      audioId: await ctx.db.insert('assets', { ...base, kind: 'audio', fileName: 'music.m4a', contentType: 'audio/mp4', r2Key: 'audio' }),
    };
  });
  const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 1, effects: 2 }, clips: [
    { id: 'video', kind: 'video', assetId: videoId, track: 1, start: 0, duration: 10, sourceStart: 0 },
    { id: 'music', kind: 'audio', assetId: audioId, track: 1, start: 0, duration: 10, sourceStart: 0 },
    { id: 'flash', kind: 'effect', effectPreset: 'flash', track: 1, start: 2, duration: .5, sourceStart: 0 },
  ] };
  const read = () => owner.query(api.projects.get, { projectId });
  const save = (next: Timeline, expectedRevision: number) => owner.mutation(api.projects.saveTimeline, { projectId, timeline: next, expectedRevision });
  return { t, owner, projectId, timeline, read, save };
}

test('effect-only track counts persist alongside footage and music', async () => {
  const f = await fixture();
  await f.save(f.timeline, 0);
  expect((await f.read()).timeline).toEqual(f.timeline);
});

test('moving an FX clip and removing an empty FX track preserve footage, music and undo', async () => {
  const f = await fixture(); await f.save(f.timeline, 0);
  const moved = placeOnFreeLayer(f.timeline, { ...f.timeline.clips[2], start: 5 });
  await f.save(moved, 1);
  expect((await f.read()).timeline?.clips).toEqual([...f.timeline.clips.slice(0, 2), { ...f.timeline.clips[2], start: 5 }]);
  const compact = deleteEmptyLayer(moved, 'effects', 2);
  await f.save(compact, 2);
  expect((await f.read()).timeline).toMatchObject({ clips: moved.clips, tracks: { effects: 1, visual: 1, audio: 1 } });
  await f.owner.mutation(api.projects.undo, { projectId: f.projectId });
  expect((await f.read()).timeline).toEqual(moved);
  await f.owner.mutation(api.projects.undo, { projectId: f.projectId });
  expect((await f.read()).timeline).toEqual(f.timeline);
});

test('deleting an FX clip leaves footage and music saved and undo restores its exact timing', async () => {
  const f = await fixture(); await f.save(f.timeline, 0);
  await f.save(deleteClip(f.timeline, 'flash'), 1);
  expect((await f.read()).timeline?.clips).toEqual(f.timeline.clips.slice(0, 2));
  await f.owner.mutation(api.projects.undo, { projectId: f.projectId });
  expect((await f.read()).timeline).toEqual(f.timeline);
});

test('old saved effect clips without explicit FX counts keep their timing and track number', async () => {
  const f = await fixture();
  const legacy: Timeline = { ...f.timeline, tracks: { visual: 3, overlay: 0, audio: 1 }, clips: [...f.timeline.clips.slice(0, 2), { ...f.timeline.clips[2], track: 3 }] };
  await f.save(legacy, 0);
  expect((await f.read()).timeline).toEqual(legacy);
  const explicit: Timeline = { ...legacy, tracks: { visual: 3, overlay: 0, audio: 1, effects: 3 } };
  await f.save(explicit, 1);
  expect((await f.read()).timeline).toEqual(explicit);
});

test('FX limits and declared counts reject malformed edits without changing the saved project', async () => {
  const f = await fixture(); await f.save(f.timeline, 0);
  for (const effects of [-1, .5, 25, Infinity]) {
    await expect(f.save({ ...f.timeline, tracks: { ...f.timeline.tracks!, effects } }, 1)).rejects.toThrow('Use 0–24 visual/effects tracks');
  }
  await expect(f.save({ ...f.timeline, tracks: { ...f.timeline.tracks!, effects: 0 } }, 1)).rejects.toThrow('declared layer count');
  await expect(f.save({ ...f.timeline, clips: [...f.timeline.clips.slice(0, 2), { ...f.timeline.clips[2], track: 25 }] }, 1)).rejects.toThrow('integers between 1 and 24');
  expect((await f.read()).timeline).toEqual(f.timeline);
});

test('FX24 can overlap V1 and A1 without being rejected as a footage layer', async () => {
  const f = await fixture();
  const high: Timeline = { ...f.timeline, tracks: { visual: 1, overlay: 0, audio: 1, effects: 24 }, clips: [...f.timeline.clips.slice(0, 2), { ...f.timeline.clips[2], track: 24 }] };
  await f.save(high, 0);
  expect((await f.read()).timeline).toEqual(high);
  await expect(f.t.withIdentity({ subject: 'stranger' }).mutation(api.projects.saveTimeline, { projectId: f.projectId, timeline: high, expectedRevision: 1 })).rejects.toThrow('Project not found');
});

test('an undeclared FX24 count is inferred without adding footage tracks', async () => {
  const f = await fixture();
  const { tracks: _tracks, ...base } = f.timeline;
  const high: Timeline = { ...base, clips: [...base.clips.slice(0, 2), { ...base.clips[2], track: 24 }] };
  await f.save(high, 0);
  expect((await f.read()).timeline).toMatchObject({ clips: high.clips, tracks: { effects: 24, visual: 1, audio: 1 } });
});
