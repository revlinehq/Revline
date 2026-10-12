/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `test|${subject}` });
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example.com'); vi.stubEnv('MEDIA_SIGNING_SECRET', 'test-signing-secret'); vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('cloud upload reuse', () => {
  test('lists only owned footage and preserves it across project deletion', async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(identity('owner'));
    const stranger = t.withIdentity(identity('stranger'));
    const original = await owner.mutation(api.projects.create, { title: 'Original', aspectRatio: 'vertical' });
    const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId: original, r2Key: 'media/owner/original', fileName: 'clip.mp4', contentType: 'video/mp4', size: 128, kind: 'video', duration: 8, createdAt: 1 }));
    const paginationOpts = { cursor: null, numItems: 12 };
    expect((await owner.query(api.assets.library, { paginationOpts })).page).toEqual([expect.objectContaining({ _id: assetId, url: expect.stringContaining('https://media.example.com/read?token=') })]);
    expect((await stranger.query(api.assets.library, { paginationOpts })).page).toEqual([]);
    await expect(t.query(api.assets.library, { paginationOpts })).rejects.toThrow('Authentication required');
    await expect(stranger.mutation(api.projects.create, { title: 'Stolen', aspectRatio: 'vertical', assetIds: [assetId] })).rejects.toThrow('another account');
    expect(await stranger.query(api.assets.selected, { assetIds: [assetId] })).toEqual([]);
    const reused = await owner.mutation(api.projects.create, { title: 'Reused', aspectRatio: 'vertical', assetIds: [assetId, assetId] });
    const media = await owner.query(api.assets.list, { projectId: reused });
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ r2Key: 'media/owner/original', duration: 8 });
    const project = await owner.query(api.projects.get, { projectId: reused });
    expect(project.timeline?.clips).toEqual([expect.objectContaining({ assetId: media[0]._id, duration: 8, start: 0 })]);
    await owner.mutation(api.projects.remove, { projectId: original });
    expect((await owner.query(api.assets.list, { projectId: reused }))[0].url).toContain('https://media.example.com/read?token=');
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toEqual([]);
    await owner.mutation(api.projects.remove, { projectId: reused });
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test('deleting a legacy attachment keeps the shared original file usable', async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(identity('owner'));
    const original = await owner.mutation(api.projects.create, { title: 'Original', aspectRatio: 'vertical' });
    const { assetId, storageId } = await t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(['image'], { type: 'image/png' }));
      const assetId = await ctx.db.insert('assets', { ownerId: 'owner', projectId: original, storageId, fileName: 'image.png', contentType: 'image/png', size: 5, kind: 'image', createdAt: 1 });
      return { assetId, storageId };
    });
    const reused = await owner.mutation(api.projects.create, { title: 'Reused', aspectRatio: 'vertical', assetIds: [assetId] });
    await owner.mutation(api.assets.remove, { assetId });
    expect(await t.run(async ctx => (await ctx.storage.get(storageId)) !== null)).toBe(true);
    await owner.mutation(api.projects.remove, { projectId: reused });
    expect(await t.run(async ctx => (await ctx.storage.get(storageId)) !== null)).toBe(false);
  });

  test('missing footage aborts project creation and long sources fit the initial timeline', async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(identity('owner'));
    const original = await owner.mutation(api.projects.create, { title: 'Original', aspectRatio: 'vertical' });
    const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId: original, r2Key: 'long', fileName: 'long.mp4', contentType: 'video/mp4', size: 100, kind: 'video', duration: 600, createdAt: 1 }));
    const reused = await owner.mutation(api.projects.create, { title: 'Long cut', aspectRatio: 'vertical', assetIds: [assetId] });
    expect((await owner.query(api.projects.get, { projectId: reused })).timeline?.clips[0].duration).toBe(300);
    const [video, image] = await t.run(async ctx => [
      await ctx.db.insert('assets', { ownerId: 'owner', projectId: original, r2Key: 'shorter', fileName: 'short.mp4', contentType: 'video/mp4', size: 100, kind: 'video', duration: 297, createdAt: 1 }),
      await ctx.db.insert('assets', { ownerId: 'owner', projectId: original, r2Key: 'image', fileName: 'image.png', contentType: 'image/png', size: 100, kind: 'image', createdAt: 1 }),
    ]);
    const mixed = await owner.mutation(api.projects.create, { title: 'Mixed sources', aspectRatio: 'vertical', assetIds: [video, image] });
    expect((await owner.query(api.projects.get, { projectId: mixed })).timeline?.clips[1]).toMatchObject({ start: 297, duration: 3 });
    await t.run(ctx => ctx.db.delete(assetId));
    await expect(owner.mutation(api.projects.create, { title: 'Missing', aspectRatio: 'vertical', assetIds: [assetId] })).rejects.toThrow('unavailable');
    expect((await owner.query(api.projects.list, {})).map(project => project.title)).not.toContain('Missing');
  });
});
