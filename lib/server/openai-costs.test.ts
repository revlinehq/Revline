import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenAiCostsStore, parseConnectionInput } from './openai-costs';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.map(path => rm(path, { recursive: true, force: true }))); directories.length = 0; });
const credentials = { adminKey: 'sk-admin-testcredential000000', projectId: 'proj_revline123' };
const now = Date.parse('2026-10-18T17:00:00Z');
async function fixture(fetcher: typeof fetch, time = () => now) {
  const directory = await mkdtemp(join(tmpdir(), 'revline-costs-test-')); directories.push(directory);
  return { directory, store: createOpenAiCostsStore({ directory, fetcher, now: time }) };
}
function page(url: URL | RequestInfo, amount = .12) {
  const start = Number(new URL(String(url)).searchParams.get('start_time'));
  return Response.json({ data: [{ start_time: start, end_time: start + 86400, results: [{ project_id: credentials.projectId, amount: { value: amount, currency: 'usd' } }] }], has_more: false });
}
test('validates Admin key and exact project ID without echoing credential', () => {
  expect(parseConnectionInput(credentials)).toEqual(credentials);
  expect(() => parseConnectionInput({ ...credentials, adminKey: 'sk-proj-secret' })).toThrow('Admin API key');
  expect(() => parseConnectionInput({ ...credentials, projectId: 'other' })).toThrow('project ID');
});
test('validates one day before atomic private save, scopes official reads and never returns key', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => { expect(new URL(String(url)).searchParams.get('project_ids')).toBe(credentials.projectId); expect(new URL(String(url)).searchParams.get('group_by')).toBe('project_id'); expect(init?.headers).toEqual({ Authorization: `Bearer ${credentials.adminKey}` }); return page(url); });
  const { store, directory } = await fixture(fetcher);
  expect(await store.connect('owner', credentials)).toEqual({ connected: true, projectId: credentials.projectId });
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('limit')).toBe('1');
  expect((await stat(join(directory, 'connection.json'))).mode & 0o777).toBe(0o600);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  const report = await store.report('owner', 7);
  expect(report).toMatchObject({ connected: true, totalUsd: .12, days: 7 });
  expect(JSON.stringify(report)).not.toContain(credentials.adminKey);
  expect(await store.report('different-user', 7)).toEqual({ connected: false });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8')).ownerId).toBe('owner');
});
test('rejects upstream auth failure without saving or echoing its body', async () => {
  const { store, directory } = await fixture(vi.fn(async () => new Response(JSON.stringify({ error: credentials.adminKey }), { status: 403 })));
  await expect(store.connect('owner', credentials)).rejects.toThrow('Usage read permission');
  await expect(readFile(join(directory, 'connection.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('caches only this owner, connection and period for sixty seconds', async () => {
  let timestamp = now;
  const fetcher = vi.fn<typeof fetch>(async url => page(url));
  const { store } = await fixture(fetcher, () => timestamp);
  await store.connect('owner', credentials); await store.report('owner', 7); await store.report('owner', 7);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await store.report('owner', 30); expect(fetcher).toHaveBeenCalledTimes(3);
  timestamp += 60_001; await store.report('owner', 7); expect(fetcher).toHaveBeenCalledTimes(4);
});
test('follows bounded pagination and sums daily official amounts, including credits', async () => {
  const fetcher = vi.fn<typeof fetch>(async url => {
    const query = new URL(String(url)).searchParams;
    if (query.get('limit') === '1') return page(url);
    const start = +query.get('start_time')!;
    return Response.json({ data: [{ start_time: start + (query.has('page') ? 86400 : 0), end_time: start + 86400, results: [{ project_id: credentials.projectId, amount: { value: query.has('page') ? -.02 : .12, currency: 'usd' } }] }], has_more: !query.has('page'), next_page: query.has('page') ? null : 'second' });
  });
  const { store } = await fixture(fetcher); await store.connect('owner', credentials);
  const report = await store.report('owner', 7); expect(report).toMatchObject({ totalUsd: expect.closeTo(.10), daily: expect.any(Array) });
  if (report.connected) expect(report.daily).toHaveLength(7);
});
test('rejects wrong-project totals rather than pretending they belong to Revline', async () => {
  const { store } = await fixture(vi.fn(async () => Response.json({ data: [{ start_time: Math.floor(now / 86400000) * 86400, results: [{ project_id: 'proj_other', amount: { value: 10, currency: 'usd' } }] }] })));
  await expect(store.connect('owner', credentials)).rejects.toThrow('outside the selected project');
});
test('incomplete pagination fails instead of displaying a partial official total', async () => {
  const { store } = await fixture(vi.fn(async () => Response.json({ data: [], has_more: true, next_page: 'same' })));
  await expect(store.connect('owner', credentials)).rejects.toThrow('incomplete costs report');
});
