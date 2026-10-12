import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { understandVideo } from './twelvelabs';

let directory: string;
let source: string;
const calls: { url: string; options: RequestInit }[] = [];
const scenes = { summary: 'A rocket launches.', scenes: [{ start: 0, end: 1, description: 'A rocket lifts off.', score: 0.9 }] };
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'revline-twelvelabs-test-')); source = join(directory, 'source.mp4'); await writeFile(source, 'fixture source'); calls.length = 0; });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

function mockProvider(result: unknown = { data: JSON.stringify(scenes), finish_reason: 'stop' }, status = 200, initialStatus = 'ready') {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = String(input); calls.push({ url, options });
    if (url.endsWith('/assets')) return Response.json({ _id: 'fixture', status: initialStatus }, { status: 201 });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/assets/fixture')) return Response.json({ _id: 'fixture', status: 'ready' });
    if (url.endsWith('/analyze')) return Response.json(result, { status });
    throw new Error(`Unexpected request ${url}`);
  }));
}

test('uploads the video, requests Pegasus JSON, validates scenes, and removes the temporary asset', async () => {
  mockProvider();
  await expect(understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000))).resolves.toEqual(scenes);
  const upload = calls[0];
  expect(new Headers(upload.options.headers).get('x-api-key')).toBe('test-key');
  expect(upload.options.body).toBeInstanceOf(FormData);
  const form = upload.options.body as FormData;
  expect(form.get('method')).toBe('direct');
  expect(form.get('enable_hls')).toBe('false');
  expect(form.get('file')).toBeInstanceOf(Blob);
  const request = JSON.parse(calls.find(call => call.url.endsWith('/analyze'))!.options.body as string);
  expect(request).toMatchObject({ model_name: 'pegasus1.6', video: { type: 'asset_id', asset_id: 'fixture' }, stream: false, response_format: { type: 'json_schema' } });
  expect(calls.at(-1)).toMatchObject({ url: 'https://api.twelvelabs.io/v1.3/assets/fixture', options: { method: 'DELETE' } });
});

test('waits for the asset to become ready before analyzing', async () => {
  mockProvider(undefined, 200, 'processing');
  await understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000));
  expect(calls.map(call => `${call.options.method ?? 'GET'} ${call.url.split('/').at(-1)}`)).toEqual(['POST assets', 'GET fixture', 'POST analyze', 'DELETE fixture']);
});

test.each([401, 403, 429, 500])('handles provider HTTP %s without exposing provider bodies and still cleans up', async status => {
  mockProvider({ error: 'private provider diagnostic test-key' }, status);
  await expect(understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: status === 429 ? 429 : 502 });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test.each([
  { data: JSON.stringify(scenes), finish_reason: 'length' },
  { data: 'invalid JSON', finish_reason: 'stop' },
  { data: JSON.stringify({ ...scenes, scenes: [{ ...scenes.scenes[0], end: 9 }] }), finish_reason: 'stop' },
  { data: JSON.stringify({ ...scenes, scenes: [] }), finish_reason: 'stop' },
])('rejects invalid or incomplete analysis rather than saving invented scene data', async result => {
  mockProvider(result);
  await expect(understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 502 });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('cleans up a failed upload and never tries to analyze it', async () => {
  mockProvider(undefined, 200, 'failed');
  await expect(understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 502 });
  expect(calls).toHaveLength(2);
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('cancellation during preparation still deletes the temporary asset with a fresh signal', async () => {
  mockProvider(undefined, 200, 'processing');
  await expect(understandVideo(source, 1, 'test-key', AbortSignal.timeout(30))).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
  expect(calls.at(-1)?.options.signal?.aborted).toBe(false);
});

test('rejects videos shorter than the model minimum before uploading', async () => {
  mockProvider();
  await expect(understandVideo(source, 0.5, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 400 });
  expect(calls).toHaveLength(0);
});
