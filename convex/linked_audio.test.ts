/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { addMediaClip, patchClip, splitClip, unlinkClips } from '../lib/editor/operations';
import { EMPTY_TIMELINE } from '../lib/editor/types';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `test|${subject}` });
beforeEach(() => { vi.stubEnv('RENDER_WORKER_SECRET', 'test-worker'); vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example.com'); vi.stubEnv('MEDIA_SIGNING_SECRET', 'test-signing-secret'); });
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules), owner = t.withIdentity(identity('owner'));
  const projectId = await owner.mutation(api.projects.create, { title: 'Audio checks', aspectRatio: 'vertical' });
  const [videoId, audioId] = await t.run(async ctx => Promise.all([
    ctx.db.insert('assets', { projectId, ownerId: 'owner', kind: 'video', fileName: 'source.mp4', contentType: 'video/mp4', r2Key: 'test/video', size: 100, duration: 10, createdAt: 1 }),
    ctx.db.insert('assets', { projectId, ownerId: 'owner', kind: 'audio', fileName: 'source.m4a', contentType: 'audio/mp4', r2Key: 'test/audio', size: 100, duration: 10, createdAt: 1 }),
  ]));
  return { t, owner, projectId, videoId, audioId };
}
describe('extracted audio ownership and persistence', () => {
  it('persists measured waveforms and refuses invalid data or another owner', async () => {
    const { t, owner, projectId, videoId, audioId } = await setup();
    const waveform = { peaks: 'AID/', samplesPerSecond: 100 };
    const args = { projectId, assetId: audioId, waveform, workerSecret: 'test-worker' };
    await expect(owner.mutation(internal.assets.saveWaveform, { ...args, workerSecret: 'bad' })).rejects.toThrow('worker authentication');
    await expect(t.withIdentity(identity('stranger')).mutation(internal.assets.saveWaveform, args)).rejects.toThrow();
    await expect(owner.mutation(internal.assets.saveWaveform, { ...args, assetId: videoId })).rejects.toThrow('Audio not found');
    await expect(owner.mutation(internal.assets.saveWaveform, { ...args, waveform: { ...waveform, samplesPerSecond: -1 } })).rejects.toThrow('Invalid audio waveform');
    await expect(owner.mutation(internal.assets.saveWaveform, { ...args, waveform: { ...waveform, peaks: 'invalid!' } })).rejects.toThrow('Invalid audio waveform');
    await owner.mutation(internal.assets.saveWaveform, args);
    expect((await owner.query(api.assets.get, { projectId, assetId: audioId })).waveform).toEqual(waveform);
    const clone = await owner.mutation(api.projects.create, { title: 'Reused audio', aspectRatio: 'vertical', assetIds: [audioId] });
    expect((await owner.query(api.assets.list, { projectId: clone }))[0].waveform).toEqual(waveform);
  });
  it('requires both the owner and media worker and records extraction idempotently', async () => {
    const { t, owner, projectId, videoId, audioId } = await setup();
    const args = { projectId, assetId: videoId, audioAssetId: audioId, workerSecret: 'test-worker' };
    await expect(owner.mutation(internal.assets.saveExtractedAudio, { ...args, workerSecret: 'bad' })).rejects.toThrow('worker authentication');
    await expect(t.withIdentity(identity('stranger')).mutation(internal.assets.saveExtractedAudio, args)).rejects.toThrow();
    expect(await owner.mutation(internal.assets.saveExtractedAudio, args)).toBe(audioId);
    expect(await owner.mutation(internal.assets.saveExtractedAudio, args)).toBe(audioId);
    expect(await t.run(ctx => ctx.db.get(videoId))).toMatchObject({ audioAssetId: audioId, audioExtracted: true });
  });
  it('records silent videos without fabricating an audio asset', async () => {
    const { t, owner, projectId, videoId } = await setup();
    expect(await owner.mutation(internal.assets.saveExtractedAudio, { projectId, assetId: videoId, workerSecret: 'test-worker' })).toBeNull();
    expect(await t.run(ctx => ctx.db.get(videoId))).toMatchObject({ audioExtracted: true });
  });
  it('rejects audio from a different project', async () => {
    const { t, owner, projectId, videoId, audioId } = await setup();
    const other = await owner.mutation(api.projects.create, { title: 'Other', aspectRatio: 'vertical' });
    await t.run(ctx => ctx.db.patch(audioId, { projectId: other }));
    await expect(owner.mutation(internal.assets.saveExtractedAudio, { projectId, assetId: videoId, audioAssetId: audioId, workerSecret: 'test-worker' })).rejects.toThrow('belong to this project');
  });
  it('saves edits of complete pairs, rejects broken sync and allows unlinking', async () => {
    const { owner, projectId, videoId, audioId } = await setup();
    await owner.mutation(internal.assets.saveExtractedAudio, { projectId, assetId: videoId, audioAssetId: audioId, workerSecret: 'test-worker' });
    const initial = addMediaClip(EMPTY_TIMELINE, { _id: videoId, kind: 'video', duration: 10, audioAssetId: audioId }, 'v');
    const saved = await owner.mutation(api.projects.saveTimeline, { projectId, timeline: initial, expectedRevision: 0 });
    const split = splitClip(patchClip(initial, 'v', { duration: 6, sourceStart: 1 }), 'v', 3, 'tail');
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: split, expectedRevision: saved.revision });
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips).toHaveLength(4);
    const unsynced = { ...split, clips: split.clips.map(c => c.id === 'v-audio' ? { ...c, start: 1 } : c) };
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: unsynced, expectedRevision: 2 })).rejects.toThrow('synchronized');
    const doubled = { ...split, clips: split.clips.map(c => c.id === 'v' ? { ...c, volume: 1 } : c) };
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: doubled, expectedRevision: 2 })).rejects.toThrow('muted');
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: patchClip(unlinkClips(split, 'v'), 'v-audio', { start: 1 }), expectedRevision: 2 });
  });
  it('reuses a cloud video with its audio retargeted into the new project', async () => {
    const { owner, projectId, videoId, audioId } = await setup();
    await owner.mutation(internal.assets.saveExtractedAudio, { projectId, assetId: videoId, audioAssetId: audioId, workerSecret: 'test-worker' });
    const cloneId = await owner.mutation(api.projects.create, { title: 'Reused', aspectRatio: 'vertical', assetIds: [videoId, audioId] });
    const media = await owner.query(api.assets.list, { projectId: cloneId });
    expect(media).toHaveLength(2);
    const video = media.find(a => a.kind === 'video')!, audio = media.find(a => a.kind === 'audio')!;
    expect(video.audioAssetId).toBe(audio._id);
    const timeline = (await owner.query(api.projects.get, { projectId: cloneId })).timeline!;
    expect(timeline.clips).toHaveLength(2);
    expect(timeline.clips.find(c => c.kind === 'video')).toMatchObject({ assetId: video._id, volume: 0, audioSeparated: true });
    expect(timeline.clips.find(c => c.kind === 'audio')).toMatchObject({ assetId: audio._id, volume: 1 });
  });
});
