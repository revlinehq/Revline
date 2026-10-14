/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => { vi.unstubAllEnvs(); });
async function fixture() {
  vi.stubEnv('RENDER_WORKER_SECRET', 'fixture-secret');
  vi.stubEnv('BILLING_ENABLED', 'false');
  const t = convexTest(schema, modules);
  const { projectId, assetId } = await t.run(async ctx => {
    const projectId = await ctx.db.insert('projects', { title: 'Transcript fixture', ownerId: 'owner', aspectRatio: 'vertical', createdAt: 0, updatedAt: 0 });
    const assetId = await ctx.db.insert('assets', { projectId, ownerId: 'owner', fileName: 'speech.mp3', contentType: 'audio/mpeg', kind: 'audio', size: 1, duration: 3, createdAt: 0 });
    return { projectId, assetId };
  });
  const owner = t.withIdentity({ subject: 'owner', issuer: 'https://test.clerk.accounts.dev' });
  return { t, owner, projectId, assetId };
}

test('stores native instantaneous words while retaining positive caption segments', async () => {
  const { owner, projectId, assetId } = await fixture();
  const transcript = { words: [{ text: 'A', start: .1, end: .1 }, { text: 'word.', start: .1, end: .8 }], segments: [{ text: 'A word.', start: .1, end: .8 }] };
  await owner.mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: 'fixture-secret', transcript });
  expect((await owner.query(api.assets.get, { projectId, assetId })).analysis?.transcript).toEqual(transcript);
});

test.each([
  { words: [], segments: [{ text: 'Empty caption.', start: .1, end: .1 }] },
  { words: [{ text: 'Reversed', start: .3, end: .2 }], segments: [] },
  { words: [{ text: 'Outside', start: 4, end: 4 }], segments: [] },
  { words: [{ text: 'Negative', start: -.1, end: .1 }], segments: [] },
])('refuses invalid ranges without relaxing segment or source bounds', async transcript => {
  const { owner, projectId, assetId } = await fixture();
  await expect(owner.mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: 'fixture-secret', transcript })).rejects.toThrow('Invalid transcript timing');
});
