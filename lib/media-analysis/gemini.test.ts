import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectVideo, transcribeAudio, understandVideo,inspectCompositionFrames } from './gemini';

let directory: string;
let source: string;
const calls: { url: string; options: RequestInit & { duplex?: string } }[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'revline-gemini-test-'));
  source = join(directory, 'source.wav');
  await writeFile(source, Buffer.from('fixture source'));
  calls.length = 0;
  vi.stubEnv('GEMINI_VIDEO_MODEL', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

function mockProvider(result: unknown, status = 200, processing = false, subsequent: unknown[] = []) {
  let interactions = 0;
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
      return Response.json({ file: { name: 'files/fixture', uri: 'https://generativelanguage.googleapis.com/v1beta/files/fixture', state: processing ? 'PROCESSING' : 'ACTIVE' } });
    }
    if (url.endsWith('/interactions')) {
      // The real Interactions API rejects unsupported Zod schema constraints with HTTP 400.
      const request = JSON.parse(options.body as string);
      const schema = JSON.stringify(request.response_format?.schema ?? {});
      if (/"(?:\$schema|minLength|maxLength|exclusiveMinimum)":/.test(schema)) return Response.json({ error: { message: 'Request contains an invalid argument.' } }, { status: 400 });
      return Response.json([result, ...subsequent][Math.min(interactions++, subsequent.length)], { status });
    }
    if (options.method === 'DELETE') return Response.json({});
    if (url.endsWith('/v1beta/files/fixture')) return Response.json({ name: 'files/fixture', uri: 'https://generativelanguage.googleapis.com/v1beta/files/fixture', state: 'ACTIVE' });
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

test('reports actual upload, provider preparation and interaction phases', async () => {
  const phases:string[]=[];
  mockProvider({ outputs:[{text:JSON.stringify({summary:'A person waves.',scenes:[{start:0,end:1,description:'A wave.',score:.8}]})}] },200,true);
  await understandVideo(source,1,'test-key',AbortSignal.timeout(5000),'video/mp4',phase=>phases.push(phase));
  expect(phases).toEqual(['sending-gemini','preparing-gemini','analyzing']);
  expect(calls.filter(call=>call.url.endsWith('/interactions'))).toHaveLength(1);
});

test('deletes temporary uploads even when provider quota is exhausted', async () => {
  mockProvider({ error: 'quota' }, 429);
  await expect(transcribeAudio(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 429 });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('a terminal provider400 fails once with a neutral public error and redacted developer diagnostics', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const secret = 'test-key';
  mockProvider({ error: { code: 400, status: 'INVALID_ARGUMENT', message: `Unsupported request. key=${secret}; media=https://storage.example/private?token=private-token Bearer private-bearer ${'detail '.repeat(100)}` } }, 400);
  let error: unknown;
  try { await inspectVideo(source, 1, { start: 0, end: 1, question: 'Describe the visible action.' }, secret, AbortSignal.timeout(5000)); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ status: 400, retryable: false });
  expect((error as Error).message).not.toMatch(/Gemini|Google|test-key|https?:|private-token|private-bearer/i);
  expect(calls.filter(call => call.url.endsWith('/interactions'))).toHaveLength(1);
  expect(calls.at(-1)?.options.method).toBe('DELETE');
  expect(log).toHaveBeenCalledWith('[media-analysis] Provider request failed', expect.objectContaining({ provider: 'gemini', httpStatus: 400, providerCode: 400, providerStatus: 'INVALID_ARGUMENT' }));
  const diagnostic = log.mock.calls[0][1] as { message: string };
  expect(diagnostic.message.length).toBeLessThanOrEqual(320);
  expect(diagnostic.message).not.toMatch(/test-key|https?:|private-token|private-bearer/);
  expect(diagnostic.message).toContain('Unsupported request');
});

test.each([401, 403, 404, 413])('providerHTTP%s is terminal while upstream5xx remains retryable', async status => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockProvider({ error: { code: status, status: 'INVALID_ARGUMENT', message: 'Request rejected.' } }, status);
  await expect(transcribeAudio(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status, retryable: false });
});

test('retains upstream transient classification without reissuing generation inside the helper', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockProvider({ error: { code: 503, status: 'UNAVAILABLE', message: 'Temporary outage.' } }, 503);
  await expect(inspectVideo(source, 1, { start: 0, end: 1, question: 'Describe the action.' }, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 503, retryable: true });
  expect(calls.filter(call => call.url.endsWith('/interactions'))).toHaveLength(1);
});

test('requires timed words rather than inventing subtitles from plain text', async () => {
  mockProvider({ outputs: [{ text: 'Untimed speech.' }] });
  await expect(transcribeAudio(source, 1, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 502 });
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test.each([[147.833, 'static'], [300, 'static'], [300.001, 'agentic']] as const)('initial overview chooses the documented broad-summary mode for %ss: %s', async (duration, processing) => {
  mockProvider({ outputs: [{ text: JSON.stringify({ summary: 'A person waves.', scenes: [{ start: 0, end: 1, description: 'A hand wave.', score: 0.8 }] }) }] });
  expect(await understandVideo(source, duration, 'test-key', AbortSignal.timeout(5000))).toMatchObject({ summary: 'A person waves.', scenes: [{ start: 0, end: 1 }] });
  const request = JSON.parse(calls.find(call => call.url.endsWith('/interactions'))!.options.body as string);
  expect(request).toMatchObject({ model: 'gemini-3.7-flash', store: false, input: [{ type: 'video', processing }, { type: 'text' }], response_format: { type: 'text', mime_type: 'application/json' } });
  expect(request.input[0]).not.toHaveProperty('fps');
  expect(request.input[1].text).toContain('initial broad overview');
  expect(request.input[1].text).not.toContain('inspect rapid action again');
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('overview metrics correlate phases and numeric usage without exposing media, key or provider content', async () => {
  mockProvider({ usage: { total_input_tokens: 500, total_output_tokens: 80, total_thought_tokens: 20, total_tool_use_tokens: 150, total_tokens: 750, secret: 'private provider usage content' }, steps: [{ type: 'processing_call', content: [{ text: 'private thought' }] }, { type: 'processing_result', content: [{ uri: 'https://private.example/source' }] }, { type: 'model_output', content: [{ text: JSON.stringify({ summary: 'Private scene summary', scenes: [{ start: 0, end: 1, description: 'Private description', score: .8 }] }) }] }] });
  await understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000), 'video/mp4', undefined, { projectId: 'fixture-project', taskId: 'fixture-task' });
  expect(console.log).toHaveBeenCalledWith('[media-analysis] Overview metrics', expect.objectContaining({ projectId: 'fixture-project', taskId: 'fixture-task', processing: 'static', completed: true, uploadElapsedMs: expect.any(Number), inferenceElapsedMs: expect.any(Number), cleanupElapsedMs: expect.any(Number), totalElapsedMs: expect.any(Number), inputTokens: 500, outputTokens: 80, thoughtTokens: 20, toolUseTokens: 150, totalTokens: 750, processingCalls: 1, processingResults: 1 }));
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(/test-key|private|https?:/i);
});

test('missing usage stays unknown instead of reporting zero cost or tokens', async () => {
  mockProvider({ outputs: [{ text: JSON.stringify({ summary: 'A person waves.', scenes: [{ start: 0, end: 1, description: 'A hand wave.', score: .8 }] }) }], usage: { total_input_tokens: 'unknown', total_output_tokens: -1 } });
  await understandVideo(source, 1, 'test-key', AbortSignal.timeout(5000));
  expect(console.log).toHaveBeenCalledWith('[media-analysis] Overview metrics', expect.objectContaining({ inputTokens: null, outputTokens: null, totalTokens: null, processingCalls: null, processingResults: null }));
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

test('the actual video question and source window are sent to native agentic input without static offsets', async () => {
  const question = { start: 0.2, end: 0.8, question: 'Where does the person wave?' };
  mockProvider({ outputs: [{ text: JSON.stringify({ summary: 'A visible hand wave.', uncertainty: 'The exact start is approximate.', matches: [{ start: 0.3, end: 0.6, description: 'The person waves their hand.' }] }) }] });
  const result = await inspectVideo(source, 1, question, 'test-key', AbortSignal.timeout(5000));
  expect(result).toEqual({ ...question, summary: 'A visible hand wave.', uncertainty: 'The exact start is approximate.', matches: [{ start: 0.3, end: 0.6, description: 'The person waves their hand.' }] });
  const request = JSON.parse(calls.find(call => call.url.endsWith('/interactions'))!.options.body as string);
  expect(request).toMatchObject({ model: 'gemini-3.7-flash', store: false, input: [{ type: 'video', processing: 'agentic' }, { type: 'text' }] });
  expect(request.input[1].text).toContain(question.question); expect(request.input[1].text).toContain('0.2–0.8');
  expect(request.input[0]).not.toHaveProperty('start_offset'); expect(request.input[0]).not.toHaveProperty('fps');
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

test('native video questions return zero matches honestly and clean up malformed or invented evidence', async () => {
  const input = { start: 0, end: 1, question: 'Is an elephant visible?' };
  mockProvider({ outputs: [{ text: JSON.stringify({ summary: 'No elephant is visible.', uncertainty: '', matches: [] }) }] });
  await expect(inspectVideo(source, 1, input, 'test-key', AbortSignal.timeout(5000))).resolves.toMatchObject({ matches: [], summary: 'No elephant is visible.' });
  for (const payload of [
    { summary: 'Invalid bounds.', uncertainty: '', matches: [{ start: 0.9, end: 1.1, description: 'Beyond this source.' }] },
    { summary: 'Invented frames.', uncertainty: '', matches: [], frameCount: 300 },
  ]) {
    calls.length = 0; mockProvider({ outputs: [{ text: JSON.stringify(payload) }] });
    await expect(inspectVideo(source, 1, input, 'test-key', AbortSignal.timeout(5000))).rejects.toMatchObject({ status: 502, retryable: false });
    expect(calls.filter(call=>call.url.endsWith('/interactions'))).toHaveLength(2);
    expect(calls.filter(call=>call.url.includes('/upload/v1beta/files'))).toHaveLength(1);
    expect(calls.at(-1)?.options.method).toBe('DELETE');
  }
});

test('repairs invalid timing once on the existing Gemini upload and reports safe diagnostic bounds',async()=>{
  const input={start:0,end:175.690956,question:'Private question'};
  const payload={summary:'One event.',uncertainty:'',matches:[{start:170,end:175.7,description:'Private description'}]};
  const valid={...payload,matches:[{...payload.matches[0],end:input.end}]};
  mockProvider({outputs:[{text:JSON.stringify(payload)}]},200,false,[{outputs:[{text:JSON.stringify(valid)}]}]);
  const activity=vi.fn();
  const result=await inspectVideo(source,input.end,input,'test-key',AbortSignal.timeout(5000),'video/mp4',activity);
  expect(result.matches).toEqual(valid.matches);
  expect(activity).toHaveBeenCalledWith('retrying-analysis',{reason:'outside-window',matchIndex:0,start:170,end:175.7,windowStart:0,windowEnd:input.end,duration:input.end});
  const interactions=calls.filter(call=>call.url.endsWith('/interactions')).map(call=>JSON.parse(call.options.body as string));
  expect(interactions).toHaveLength(2);
  expect(interactions[0].input[0].uri).toBe(interactions[1].input[0].uri);
  expect(interactions[1].input[1].text).toContain('175.690956');
  expect(interactions[1].input[1].text).not.toContain('Private description');
  expect(calls.filter(call=>call.url.includes('/upload/v1beta/files'))).toHaveLength(1);
  expect(calls.at(-1)?.options.method).toBe('DELETE');
});

import type { EffectPlan } from '../ai/edit-plan';
const plan:EffectPlan={id:'impact',kind:'timed',effect:'punch',start:1,duration:.4,purpose:'Emphasize contact',strength:'Fixed 1.2×',expectation:'Push on the observed contact',anchor:{kind:'requested-time',time:1.1,description:'Requested timing'}};
test('narrow review sends edited/reference timeline pixels and validates exact expectation IDs',async()=>{
  const fetcher=vi.fn(async(_input:unknown,_init?:RequestInit)=>new Response(JSON.stringify({outputs:[{type:'text',text:JSON.stringify({observations:[{planId:'impact',verdict:'unverifiable',evidence:'No contact is shown in these stills.'}],uncertainty:'Sparse samples cannot confirm impact.'})}]})));
  vi.stubGlobal('fetch',fetcher);
  const result=await inspectCompositionFrames([{time:1.1,edited:'edited-pixels',reference:'reference-pixels'}],[plan],'test-key',new AbortController().signal);
  expect(result.observations[0].verdict).toBe('unverifiable');
  const body=JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.store).toBe(false);expect(body.input[0].text).toContain('not source seconds');expect(body.input[0].text).toContain('untrusted');
  expect(body.input.filter((part:{type:string})=>part.type==='image').map((part:{data:string})=>part.data)).toEqual(['edited-pixels','reference-pixels']);
});
