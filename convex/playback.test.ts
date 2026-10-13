/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { verifyMediaToken } from '../lib/storage/media-tokens';

const modules = import.meta.glob('./**/*.ts');
const refresh = api.playback.refresh;
const signingSecret = 'playback-test-signing-secret';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example'); vi.stubEnv('MEDIA_SIGNING_SECRET', signingSecret);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'owner' });
  const projectId = await t.run(ctx => ctx.db.insert('projects', { ownerId: 'owner', title: 'Playback', aspectRatio: 'landscape', createdAt: Date.now(), updatedAt: Date.now() }));
  const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId, r2Key: 'media/owner/clip', fileName: 'clip.mp4', contentType: 'video/mp4', kind: 'video', size: 4, createdAt: Date.now() }));
  return { t, owner, projectId, assetId };
}

test('an owner can refresh expired playback URLs', async () => {
  const f = await fixture();
  const first = await f.owner.action(refresh, { projectId: f.projectId, assetIds: [f.assetId] });
  const firstToken = new URL(first[0].url!).searchParams.get('token')!;
  expect(await verifyMediaToken(signingSecret, firstToken)).toEqual({ operation: 'read', key: 'media/owner/clip', expires: new Date('2026-10-20T12:00:00Z').getTime() });
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  expect(await verifyMediaToken(signingSecret, firstToken)).toBeNull();
  const current = await f.owner.action(refresh, { projectId: f.projectId, assetIds: [f.assetId] });
  expect(current[0]._id).toBe(f.assetId);
  expect(current[0].url).not.toBe(first[0].url);
  expect(await verifyMediaToken(signingSecret, new URL(current[0].url!).searchParams.get('token')!)).toEqual({ operation: 'read', key: 'media/owner/clip', expires: new Date('2026-10-28T12:00:00Z').getTime() });
});

test('playback refresh refuses another user and anonymous callers', async () => {
  const f = await fixture();
  await expect(f.t.action(refresh, { projectId: f.projectId, assetIds: [f.assetId] })).rejects.toThrow('Authentication required');
  await expect(f.t.withIdentity({ subject: 'intruder' }).action(refresh, { projectId: f.projectId, assetIds: [f.assetId] })).rejects.toThrow('Project not found');
});

test('playback refresh refuses assets outside the requested owned project', async () => {
  const f = await fixture();
  const { foreignAsset, otherAsset } = await f.t.run(async ctx => {
    const otherProject = await ctx.db.insert('projects', { ownerId: 'owner', title: 'Other edit', aspectRatio: 'landscape', createdAt: Date.now(), updatedAt: Date.now() });
    const fields = { fileName: 'clip.mp4', contentType: 'video/mp4', kind: 'video' as const, size: 4, createdAt: Date.now() };
    const foreignAsset = await ctx.db.insert('assets', { ...fields, ownerId: 'intruder', projectId: f.projectId, r2Key: 'media/intruder/clip' });
    const otherAsset = await ctx.db.insert('assets', { ...fields, ownerId: 'owner', projectId: otherProject, r2Key: 'media/owner/other' });
    return { foreignAsset, otherAsset };
  });
  for (const deniedAsset of [foreignAsset, otherAsset]) {
    await expect(f.owner.action(refresh, { projectId: f.projectId, assetIds: [f.assetId, deniedAsset] })).rejects.toThrow('Media not found');
  }
});

test('an empty refresh still requires access to its project', async () => {
  const f = await fixture();
  expect(await f.owner.action(refresh, { projectId: f.projectId, assetIds: [] })).toEqual([]);
  await expect(f.t.action(refresh, { projectId: f.projectId, assetIds: [] })).rejects.toThrow('Authentication required');
  await expect(f.t.withIdentity({ subject: 'intruder' }).action(refresh, { projectId: f.projectId, assetIds: [] })).rejects.toThrow('Project not found');
});

test('playback refresh is bounded and returns each requested source once', async () => {
  const f = await fixture();
  expect(await f.owner.action(refresh, { projectId: f.projectId, assetIds: Array(200).fill(f.assetId) })).toHaveLength(1);
  await expect(f.owner.action(refresh, { projectId: f.projectId, assetIds: Array(201).fill(f.assetId) })).rejects.toThrow('Refresh up to 200 project media files');
});

test('playback refresh supports Convex storage and sources without stored media', async () => {
  const f = await fixture();
  const { storedAsset, missingAsset } = await f.t.run(async ctx => {
    const fields = { ownerId: 'owner', projectId: f.projectId, fileName: 'clip.mp4', contentType: 'video/mp4', kind: 'video' as const, size: 4, createdAt: Date.now() };
    const storageId = await ctx.storage.store(new Blob(['clip'], { type: 'video/mp4' }));
    return { storedAsset: await ctx.db.insert('assets', { ...fields, storageId }), missingAsset: await ctx.db.insert('assets', fields) };
  });
  const current = await f.owner.action(refresh, { projectId: f.projectId, assetIds: [storedAsset, missingAsset] });
  expect(current[0]._id).toBe(storedAsset); expect(current[0].url).toEqual(expect.any(String));
  expect(current[1]).toEqual({ _id: missingAsset, url: null });
});
