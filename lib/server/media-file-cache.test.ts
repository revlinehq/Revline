import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ statfs: vi.fn() }));
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), statfs: mocks.statfs }));
import { mediaSourceCacheIdentity, reuseMediaFile } from './media-file-cache';

let directory: string, cache: string;
const source = { _id: 'source', ownerId: 'owner', size: 4, contentType: 'video/mp4', r2Key: 'media/owner/immutable.mp4', duration: 3 };
const identity = () => mediaSourceCacheIdentity('https://fixture.convex.cloud', 'project', source)!;
const entries = async () => (await readdir(cache)).filter(name => name.endsWith('.cache'));
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'revline-cache-test-')); cache = join(directory, 'cache');
  vi.stubEnv('MEDIA_ANALYSIS_CACHE_DIR', cache);
  mocks.statfs.mockResolvedValue({ bavail: 3 * 1024 ** 3, bsize: 1 });
});
afterEach(async () => { vi.unstubAllEnvs(); vi.resetAllMocks(); await rm(directory, { recursive: true, force: true }); });
const request = (target: string, variant = 'source-v1') => ({ identity: identity(), variant, target: join(directory, target), signal: AbortSignal.timeout(5000), expectedBytes: 4 });

test('reuses complete files through hard links while task cleanup and cache eviction stay independent', async () => {
  const first = request('first'), produce = vi.fn(() => writeFile(first.target, 'body'));
  expect(await reuseMediaFile(first, produce)).toBe(false);
  const cached = join(cache, (await entries())[0]);
  expect((await stat(first.target)).ino).toBe((await stat(cached)).ino);
  await rm(first.target);
  const second = request('retry');
  expect(await reuseMediaFile(second, produce)).toBe(true);
  expect(produce).toHaveBeenCalledOnce();
  await rm(cached);
  expect(await readFile(second.target, 'utf8')).toBe('body');
});

test('separates tenants, projects, backends, immutable sources and analysis profiles', async () => {
  const identities = [identity(), mediaSourceCacheIdentity('https://other.convex.cloud', 'project', source)!, mediaSourceCacheIdentity('https://fixture.convex.cloud', 'other-project', source)!, mediaSourceCacheIdentity('https://fixture.convex.cloud', 'project', { ...source, ownerId: 'other-owner' })!, mediaSourceCacheIdentity('https://fixture.convex.cloud', 'project', { ...source, r2Key: 'media/owner/other.mp4' })!];
  expect(new Set(identities).size).toBe(5);
  for (const [index, scope] of identities.entries()) {
    const input = { ...request(`source-${index}`), identity: scope };
    await reuseMediaFile(input, () => writeFile(input.target, 'body'));
  }
  for (const variant of ['analysis-inspection-v1', 'analysis-overview-v1']) {
    const input = request(variant, variant); await reuseMediaFile(input, () => writeFile(input.target, 'body'));
  }
  expect(await entries()).toHaveLength(7);
  expect(mediaSourceCacheIdentity('https://fixture.convex.cloud', 'project', { ...source, ownerId: undefined })).toBeUndefined();
});

test('expires idle entries after twenty minutes instead of using stale observations', async () => {
  const first = request('first'); await reuseMediaFile(first, () => writeFile(first.target, 'body'));
  const expired = new Date(Date.now() - 21 * 60_000); await utimes(join(cache, (await entries())[0]), expired, expired);
  const second = request('second'), produce = vi.fn(() => writeFile(second.target, 'body'));
  expect(await reuseMediaFile(second, produce)).toBe(false);
  expect(produce).toHaveBeenCalledOnce();
});

test('bounds retained entries to sixteen without deleting unrelated cache-directory files', async () => {
  await mkdir(cache); await writeFile(join(cache, 'unrelated.txt'), 'keep');
  for (let index = 0; index < 18; index++) {
    const input = { ...request(`file-${index}`), variant: `profile-${index}` };
    await reuseMediaFile(input, () => writeFile(input.target, 'body'));
  }
  expect(await entries()).toHaveLength(16);
  expect(await readFile(join(cache, 'unrelated.txt'), 'utf8')).toBe('keep');
});

test('bounds retained bytes to 512 MiB and leaves active task links readable when evicting', async () => {
  const sparse = async (target: string, bytes: number) => { const file = await open(target, 'w'); try { await file.truncate(bytes); } finally { await file.close(); } };
  const first = { ...request('first'), expectedBytes: 384 * 1024 ** 2 };
  await reuseMediaFile(first, () => sparse(first.target, first.expectedBytes));
  const old = new Date(Date.now() - 1000); await utimes(join(cache, (await entries())[0]), old, old);
  const second = { ...request('second'), variant: 'another-source', expectedBytes: 192 * 1024 ** 2 };
  await reuseMediaFile(second, () => sparse(second.target, second.expectedBytes));
  const retained = await Promise.all((await entries()).map(name => stat(join(cache, name))));
  expect(retained.reduce((sum, info) => sum + info.size, 0)).toBeLessThanOrEqual(512 * 1024 ** 2);
  expect(await stat(first.target)).toMatchObject({ size: first.expectedBytes });
});

test('does not retain new files when less than one GiB remains free', async () => {
  mocks.statfs.mockResolvedValue({ bavail: 512 * 1024 ** 2, bsize: 1 });
  const input = request('source'); await reuseMediaFile(input, () => writeFile(input.target, 'body'));
  expect(await entries()).toHaveLength(0);
  expect(await readFile(input.target, 'utf8')).toBe('body');
});

test('optional cache failures preserve successful task work, and partial producer failures are never retained', async () => {
  const input = request('failed');
  await expect(reuseMediaFile(input, async () => { await writeFile(input.target, 'part'); throw new Error('Download interrupted'); })).rejects.toThrow('Download interrupted');
  expect(await entries()).toHaveLength(0);
  const blocked = join(directory, 'not-a-directory'); await writeFile(blocked, 'blocked'); vi.stubEnv('MEDIA_ANALYSIS_CACHE_DIR', blocked);
  const next = request('successful');
  expect(await reuseMediaFile(next, () => writeFile(next.target, 'body'))).toBe(false);
  expect(await readFile(next.target, 'utf8')).toBe('body');
});

test('cancellation is honored before a cached path can bypass task work', async () => {
  const input = request('first'); await reuseMediaFile(input, () => writeFile(input.target, 'body'));
  const produce = vi.fn();
  await expect(reuseMediaFile({ ...request('cancelled'), signal: AbortSignal.abort() }, produce)).rejects.toThrow();
  expect(produce).not.toHaveBeenCalled();
});
