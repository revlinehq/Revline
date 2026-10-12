import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { downloadOwnedMedia } from './owned-media';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
test('media downloads reject foreign hosts and paths before making a request', async () => {
 vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example');
 const fetch = vi.spyOn(globalThis, 'fetch');
 for (const url of ['http://127.0.0.1/private', 'https://foreign.convex.cloud/api/storage/id', 'https://media.example/control', 'https://user:password@media.example/read']) {
  await expect(downloadOwnedMedia(url, '/tmp/not-written', 'https://owned.convex.cloud', 6, new AbortController().signal)).rejects.toThrow('configured storage');
 }
 expect(fetch).not.toHaveBeenCalled();
});
test('signed R2 downloads stream to disk and refuse incomplete file contents', async () => {
 vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example');
 const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('source'));
 const dir = await mkdtemp(join(tmpdir(), 'revline-download-'));
 try {
  const file = join(dir, 'media');
  await downloadOwnedMedia('https://media.example/read?token=fixture', file, 'https://owned.convex.cloud', 6, new AbortController().signal);
  expect(await readFile(file, 'utf8')).toBe('source');
  await expect(downloadOwnedMedia('https://media.example/read?token=fixture', file, 'https://owned.convex.cloud', 7, new AbortController().signal)).rejects.toThrow('incomplete');
  await expect(downloadOwnedMedia('https://media.example/read?token=fixture', file, 'https://owned.convex.cloud', 5, new AbortController().signal)).rejects.toThrow('uploaded size');
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
 } finally { await rm(dir, { recursive: true, force: true }); }
});
