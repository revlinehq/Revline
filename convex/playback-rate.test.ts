/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { addEffectClip, addMediaClip, setClipPlaybackRate } from '../lib/editor/operations';
import { EMPTY_TIMELINE, type Timeline } from '../lib/editor/types';

const modules = import.meta.glob('./**/*.ts');
async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'owner', issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: 'test|owner' });
  const projectId = await owner.mutation(api.projects.create, { title: 'Speed checks', aspectRatio: 'vertical' });
  const [videoId, audioId] = await t.run(async ctx => Promise.all([
    ctx.db.insert('assets', { projectId, ownerId: 'owner', kind: 'video', fileName: 'source.mp4', contentType: 'video/mp4', r2Key: 'test/video', size: 100, duration: 10, createdAt: 1 }),
    ctx.db.insert('assets', { projectId, ownerId: 'owner', kind: 'audio', fileName: 'source.m4a', contentType: 'audio/mp4', r2Key: 'test/audio', size: 100, duration: 10, createdAt: 1 }),
  ]));
  await t.run(ctx => ctx.db.patch(videoId, { audioAssetId: audioId, audioExtracted: true }));
  const timeline = addMediaClip(EMPTY_TIMELINE, { _id: videoId, kind: 'video', audioAssetId: audioId, duration: 10 }, 'v');
  return { owner, projectId, timeline };
}

describe('persisted playback speed', () => {
  it('saves slow and fast linked video with its real source range, and keeps speed through undo', async () => {
    const { owner, projectId, timeline } = await setup();
    const slow = setClipPlaybackRate(timeline, 'v', .5);
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: slow, expectedRevision: 0 });
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips.map(clip => [clip.duration, clip.playbackRate])).toEqual([[20, .5], [20, .5]]);
    const fast = setClipPlaybackRate(slow, 'v', 2);
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: fast, expectedRevision: 1 });
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips.map(clip => [clip.duration, clip.playbackRate])).toEqual([[5, 2], [5, 2]]);
    await owner.mutation(api.projects.undo, { projectId });
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips.map(clip => [clip.duration, clip.playbackRate])).toEqual([[20, .5], [20, .5]]);
  });
  it('rejects source ranges beyond the media and mismatched linked speeds', async () => {
    const { owner, projectId, timeline } = await setup();
    const beyond: Timeline = { ...timeline, clips: timeline.clips.map(clip => ({ ...clip, playbackRate: 2 })) };
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: beyond, expectedRevision: 0 })).rejects.toThrow('beyond the media');
    const mismatch: Timeline = { ...timeline, clips: timeline.clips.map(clip => ({ ...clip, duration: 5, playbackRate: clip.kind === 'video' ? 2 : 1 })) };
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: mismatch, expectedRevision: 0 })).rejects.toThrow('synchronized');
    const invalid: Timeline = { ...timeline, clips: timeline.clips.map(clip => ({ ...clip, playbackRate: .1 })) };
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: invalid, expectedRevision: 0 })).rejects.toThrow('playback speed');
  });
  it('accepts quick zoom presets as ordinary timed effect clips', async () => {
    const { owner, projectId, timeline } = await setup();
    const effects = addEffectClip(addEffectClip(timeline, 'in', 'quick-zoom-in', 0), 'out', 'quick-zoom-out', 1);
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: effects, expectedRevision: 0 });
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips.filter(clip => clip.kind === 'effect').map(clip => clip.effectPreset)).toEqual(['quick-zoom-in', 'quick-zoom-out']);
  });
});
