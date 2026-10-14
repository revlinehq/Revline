import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ extractTranscriptionAudio: vi.fn() }));
vi.mock('./io', () => ({ extractTranscriptionAudio: mocks.extractTranscriptionAudio }));
import { transcribeWithWhisper } from './whisper';

let directory: string, source: string;
const signal = () => AbortSignal.timeout(5000);
const request = vi.fn<typeof fetch>();
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'revline-whisper-test-'));
  source = join(directory, 'speech.mp3');
  await writeFile(source, 'fixture audio');
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
function response(value: unknown, status = 200) {
  vi.stubGlobal('fetch', request.mockResolvedValue(Response.json(value, { status })));
}

test('uploads a compressed file using native Whisper word timestamp fields', async () => {
  response({ text: 'Hello there.', words: [{ word: 'Hello', start: .1, end: .5 }, { word: 'there.', start: .5, end: 1 }] });
  const transcript = await transcribeWithWhisper(source, 2, 'fixture-key', signal());
  expect(transcript).toEqual({ words: [{ text: 'Hello', start: .1, end: .5 }, { text: 'there.', start: .5, end: 1 }], segments: [{ text: 'Hello there.', start: .1, end: 1 }] });
  const [url, options] = request.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
  expect(options).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer fixture-key' } });
  const body = options!.body as FormData;
  expect(body.get('model')).toBe('whisper-1');
  expect(body.get('response_format')).toBe('verbose_json');
  expect(body.getAll('timestamp_granularities[]')).toEqual(['word']);
  expect(body.get('file')).toMatchObject({ name: 'speech.mp3', type: 'audio/mpeg', size: 13 });
});

test('accepts silent audio and preserves instantaneous word alignments', async () => {
  response({ text: '', words: [] });
  expect(await transcribeWithWhisper(source, 2, 'fixture-key', signal())).toEqual({ words: [], segments: [] });
  response({ text: 'A word.', words: [{ word: 'A', start: .1, end: .1 }, { word: 'word.', start: .1, end: .8 }] });
  expect((await transcribeWithWhisper(source, 2, 'fixture-key', signal())).words[0]).toEqual({ text: 'A', start: .1, end: .1 });
});

test.each([
  { text: 'Untimed speech.' },
  { text: 'Untimed speech.', words: [] },
  { text: 'Invalid', words: [{ word: 'Invalid', start: -.1, end: .2 }] },
  { text: 'Invalid', words: [{ word: 'Invalid', start: .3, end: .2 }] },
  { text: 'Invalid', words: [{ word: 'Invalid', start: .3, end: 4 }] },
  { words: [{ word: 'Missing text', start: .1, end: .2 }] },
])('reports malformed or unmeasured provider output as a Whisper error', async value => {
  response(value);
  await expect(transcribeWithWhisper(source, 2, 'fixture-key', signal())).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/Whisper/) });
});

test('rejects an over-limit transcript without silently truncating speech', async () => {
  response({ text: 'many words', words: Array.from({ length: 5001 }, (_, i) => ({ word: 'word', start: i / 10, end: (i + 1) / 10 })) });
  await expect(transcribeWithWhisper(source, 1000, 'fixture-key', signal())).rejects.toMatchObject({ status: 400, message: expect.stringContaining('5,000-word') });
});

test.each([
  [429, 'insufficient_quota', 'billing quota'],
  [429, 'rate_limit_exceeded', 'rate limited'],
  [401, 'invalid_api_key', 'credentials'],
  [403, 'access_denied', 'access to Whisper'],
  [413, '', 'audio window'],
  [500, '', 'HTTP 500'],
] as const)('describes provider HTTP %s failures without exposing raw error data', async (status, code, message) => {
  response({ error: { code, message: 'sensitive provider details' } }, status);
  await expect(transcribeWithWhisper(source, 2, 'fixture-key', signal())).rejects.toThrow(message);
});

test('splits oversized audio and maps actual chunk-relative measurements to source time', async () => {
  const large = join(directory, 'large.mp3');
  await writeFile(large, 'fixture'); await truncate(large, 24_000_001);
  mocks.extractTranscriptionAudio.mockImplementation(async (_input, output) => { await writeFile(output, 'chunk'); });
  vi.stubGlobal('fetch', request
    .mockResolvedValueOnce(Response.json({ text: 'First.', words: [{ word: 'First.', start: .1, end: .5 }] }))
    .mockResolvedValueOnce(Response.json({ text: 'Second.', words: [{ word: 'Second.', start: .2, end: .6 }] })));
  const transcript = await transcribeWithWhisper(large, 3700, 'fixture-key', signal());
  expect(mocks.extractTranscriptionAudio.mock.calls.map(call => call[3])).toEqual([{ start: 0, end: 3600 }, { start: 3600, end: 3700 }]);
  expect(transcript.words).toEqual([{ text: 'First.', start: .1, end: .5 }, { text: 'Second.', start: 3600.2, end: 3600.6 }]);
});

test('does not submit invalid source durations to the provider', async () => {
  response({ text: '' });
  await expect(transcribeWithWhisper(source, NaN, 'fixture-key', signal())).rejects.toMatchObject({ status: 400 });
  expect(request).not.toHaveBeenCalled();
});
