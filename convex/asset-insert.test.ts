/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { addMediaClip } from '../lib/editor/operations';
import { EMPTY_TIMELINE } from '../lib/editor/types';
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('BILLING_ENABLED', 'false'));
afterEach(() => vi.unstubAllEnvs());

test('Assets + appending a YouTube source extends the edit and saves linked audio', async () => {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject:'owner' });
  const projectId = await owner.mutation(api.projects.create, { title:'Imported video', aspectRatio:'vertical' });
  const asset = await t.run(async ctx => {
    const fields = { ownerId:'owner', projectId, size:1, duration:180, createdAt:1 };
    const audioAssetId = await ctx.db.insert('assets', { ...fields, kind:'audio', fileName:'youtube.m4a', contentType:'audio/mp4' });
    const _id = await ctx.db.insert('assets', { ...fields, kind:'video', fileName:'youtube.mp4', contentType:'video/mp4', audioAssetId, audioExtracted:true });
    return { _id, kind:'video' as const, duration:180, audioAssetId };
  });
  const initial = addMediaClip(EMPTY_TIMELINE, asset, 'first');
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline:initial, expectedRevision:0 });
  const plus = addMediaClip(initial, asset, 'second');
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline:plus, expectedRevision:1 });
  expect(plus.clips.find(c=>c.id==='second')).toMatchObject({start:180,duration:180});
  expect(plus.clips.find(c=>c.id==='second-audio')).toMatchObject({start:180,duration:180});
  expect(addMediaClip(plus,asset,'third').clips.find(c=>c.id==='third')?.start).toBe(360);
  await expect(owner.mutation(api.renders.start,{projectId,resolution:1080,fps:30,quality:'standard'})).rejects.toThrow('Exports currently support');
  const dropped = addMediaClip(initial,asset,'drop',30);
  await owner.mutation(api.projects.saveTimeline,{projectId,timeline:dropped,expectedRevision:2});
});
