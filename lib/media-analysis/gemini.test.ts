import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcribeAudio, understandVideo } from './gemini';

let directory: string;
let source: string;
const calls: { url: string; options: RequestInit & { duplex?: string } }[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'revline-gemini-test-'));
  source = join(directory, 'source.wav');
  await writeFile(source, Buffer.from('fixture source'));
  calls.length = 0;
});
afterEach(async () => { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

function mockProvider(result: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options: RequestInit & { duplex?: string } = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.includes('/upload/v1beta/files')) return new Response(null, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/fixture' } });
    if (url.endsWith('/upload/fixture')) {
      // Consume the real source stream to exercise the upload body and close its descriptor.
      const stream = options.body as unknown as AsyncIterable<Buffer>;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe('fixture source');
      return Response.json({ file: { name: 'files/fixture', uri: 'https://generativelanguage.googleapis.com/v1beta/files/fixture', state: 'ACTIVE' } });
    }
    if (url.endsWith('/interactions')) return Response.json(result, { status });
    if (options.method === 'DELETE') return Response.json({});
    throw new Error(`Unexpected request ${url}`);
  }));
}

test('uses dedicated verbatim word timing and deletes the uploaded source', async () => {
  mockProvider({ status: 'completed', outputs: [{ text: 'Hello world.' }], steps: [{ content: [{ annotations: [{ type: 'word_info', text: 'Hello', start_offset: '0.1s', end_offset: '0.3s' }, { type: 'word_info', text: 'world.', start_offset: '0.4s', end_offset: '0.6s' }] }] }] });
  const result = await transcribeAudio(source, 1, 'test-key', AbortSignal.timeout(5000));
  expect(result.segments).toEqual([{ start: 0.1, end: 0.6, text: 'Hello world.' }]);
  const request = calls.find(call => call.url.endsWith('/interactions'))!;
  expect(JSON.parse(request.options.body as string)).toMatchObject({ model: 'gemini-3.5-transcribe', store: false, generation_config: { transcription_config: { mode: { type: 'verbatim', timestamp_granularities: ['word'] } } } });
  expect(new Headers(request.options.headers).get('x-goog-api-key')).toBe('test-key');
  expect(calls.at(-1)).toMatchObject({ url: 'https://generativelanguage.googleapis.com/v1beta/files/fixture', options: { method: 'DELETE' } });
});

test('deletes temporary uploads even when provider quota is exhausted', async () => {
  mockProvider({ error: 'quota' }, 429);
  await expect(transcribeAudio(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 429 });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('requires timed words rather than inventing subtitles from plain text', async () => {
  mockProvider({ outputs: [{ text: 'Untimed speech.' }] });
  await expect(transcribeAudio(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 502 });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('requests structured video understanding with bounded source scene timestamps', async () => {
  mockProvider({ outputs: [{ text: JSON.stringify({ summary: 'A person waves.', scenes: [{ start: 0, end: 1, description: 'A hand wave.', score: 0.8 }] }) }] });
  expect(await understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000))).toMatchObject({ summary: 'A person waves.', scenes: [{ start: 0, end: 1 }] });
  const request = JSON.parse(calls.find(call => call.url.endsWith('/interactions'))!.options.body as string);
  expect(request).toMatchObject({ model: 'gemini-3.8-flash', store: false, input: [{ type: 'video', processing: { type: 'static', fps: 1 } }, { type: 'text' }], response_format: { type: 'text', mime_type: 'application/json' } });
});

test('reads scene JSON from current Gemini model_output steps and ignores input text', async () => {
  mockProvider({ status: 'completed', steps: [
    { type: 'user_input', content: [{ type: 'text', text: 'Analyze this source video.' }] },
    { type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ summary: 'A rocket launches.', scenes: [{ start: 0, end: 1, description: 'A rocket lifts off.', score: 0.9 }] }) }] },
  ] });
  await expect(understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000))).resolves.toMatchObject({ summary: 'A rocket launches.', scenes: [{ start: 0, end: 1 }] });
});

test('rejects out-of-source scenes and cleans up their uploaded media', async () => {
  mockProvider({ outputs: [{ text: JSON.stringify({ summary: 'Scene', scenes: [{ start: 1.1, end: 1.4, description: 'Invalid bounds.', score: 0.5 }] }) }] });
  await expect(understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 502 });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('never sends the API key or media to an untrusted upload URL', async () => {
  const fetch = vi.fn(async () => new Response(null, { headers: { 'x-goog-upload-url': 'https://attacker.example/upload' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(transcribeAudio(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 502 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
