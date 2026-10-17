import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
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

const largeSize = 64 * 1024 * 1024;
function repeatedBody(size: number, value: number) {
 let remaining = size;
 return new ReadableStream<Uint8Array>({ pull(controller) {
  if (!remaining) { controller.close(); return; }
  const length = Math.min(1024 * 1024, remaining); remaining -= length;
  controller.enqueue(new Uint8Array(length).fill(value));
 } });
}
test('large audio source downloads overlap three exact ranges and retain their file offsets', async () => {
 vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example');
 const requested: number[][] = [], progress: number[] = [];
 const allStarted = Promise.withResolvers<void>();
 const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
  const range = new Headers(init?.headers).get('Range');
  expect(range).toMatch(/^bytes=\d+-\d+$/);
  const [start, end] = range!.slice(6).split('-').map(Number);
  requested.push([start, end]);
  if (requested.length === 3) allStarted.resolve();
  const value = requested.length;
  const body = repeatedBody(end - start + 1, value);
  const reader = body.getReader();
  return new Response(new ReadableStream({ async pull(controller) {
   await allStarted.promise;
   const chunk = await reader.read();
   if (chunk.done) controller.close(); else controller.enqueue(chunk.value);
  } }), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${largeSize}`, ETag: '"source"' } });
 });
 const dir = await mkdtemp(join(tmpdir(), 'revline-range-'));
 try {
  const file = join(dir, 'media');
  await downloadOwnedMedia('https://media.example/read?token=fixture', file, 'https://owned.convex.cloud', largeSize, AbortSignal.timeout(5000), { concurrency: 3, onProgress: bytes => progress.push(bytes) });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect((await stat(file)).size).toBe(largeSize);
  const handle = await open(file, 'r');
  try {
   for (const [index, [start, end]] of requested.entries()) {
    for (const offset of [start, end]) {
     const { buffer } = await handle.read(Buffer.alloc(1), 0, 1, offset);
     expect(buffer[0]).toBe(index + 1);
    }
   }
  } finally { await handle.close(); }
  expect(progress.at(-1)).toBe(largeSize);
  expect(progress.every((value, index) => !index || value >= progress[index - 1])).toBe(true);
  expect(fetch.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  expect(new Headers(fetch.mock.calls[1][1]?.headers).get('If-Match')).toBe('"source"');
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a server ignoring Range reuses its full response instead of downloading the source three times', async () => {
 vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example');
 const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(repeatedBody(largeSize, 9)));
 const dir = await mkdtemp(join(tmpdir(), 'revline-range-fallback-'));
 try {
  const file = join(dir, 'media');
  await downloadOwnedMedia('https://media.example/read?token=fixture', file, 'https://owned.convex.cloud', largeSize, AbortSignal.timeout(5000), { concurrency: 3 });
  expect(fetch).toHaveBeenCalledOnce();
  expect((await stat(file)).size).toBe(largeSize);
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test.each(['headers', 'body'] as const)('bad range %s abort siblings and wait for them before returning failure', async invalid => {
 vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example');
 const allStarted = Promise.withResolvers<void>(), siblingAborted = Promise.withResolvers<void>(), releaseSibling = Promise.withResolvers<void>();
 let requests = 0, bodyCancelled = false, settled = false;
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
  const range = new Headers(init?.headers).get('Range');
  expect(range).toMatch(/^bytes=\d+-\d+$/);
  const [start, end] = range!.slice(6).split('-').map(Number);
  const index = requests++;
  if (index === 2) {
   const pending = new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => {
    siblingAborted.resolve();
    void releaseSibling.promise.then(() => reject(init!.signal!.reason));
   }, { once: true }));
   allStarted.resolve();
   return pending;
  }
  if (index === 1) await allStarted.promise;
  const body = index === 0 ? new ReadableStream<Uint8Array>({ cancel() { bodyCancelled = true; } }) : repeatedBody(1, 0);
  return new Response(body, { status: 206, headers: { 'Content-Range': index === 0 || invalid === 'body' ? `bytes ${start}-${end}/${largeSize}` : 'bytes 0-0/1', ETag: '"source"' } });
 });
 const dir = await mkdtemp(join(tmpdir(), 'revline-bad-range-'));
 try {
  const outcome = downloadOwnedMedia('https://media.example/read?token=fixture', join(dir, 'media'), 'https://owned.convex.cloud', largeSize, AbortSignal.timeout(5000), { concurrency: 3 }).catch(error => { settled = true; return error; });
  await siblingAborted.promise;
  expect(settled).toBe(false);
  releaseSibling.resolve();
  expect(await outcome).toMatchObject({ message: expect.stringContaining(invalid === 'headers' ? 'range' : 'incomplete') });
  expect(bodyCancelled).toBe(true);
 } finally { releaseSibling.resolve(); await rm(dir, { recursive: true, force: true }); }
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
