import { afterEach, expect, test, vi } from 'vitest';
import { openAIAvailableModels, openAIModelAccess, openAIGenerationAccess } from './modelDiagnostics';

const key = 'fixture-private-server-key';
const probe = (modelId = 'gpt-6.1-sol') => (openAIModelAccess as unknown as { _handler: (ctx: unknown, args: { modelId: string }) => Promise<unknown> })._handler({}, { modelId });
const generationProbe = (modelId = 'gpt-6.1-sol') => (openAIGenerationAccess as unknown as { _handler: (ctx: unknown, args: { modelId: string }) => Promise<unknown> })._handler({}, { modelId });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('model-access diagnosis is internal, uses a read-only metadata GET, and never returns credentials', async () => {
  vi.stubEnv('OPENAI_API_KEY', key);
  vi.stubEnv('OPENAI_BASE_URL', '');
  const request = vi.fn(async (url: URL, options: RequestInit) => {
    expect(url.href).toBe('https://api.openai.com/v1/models/gpt-6.1-sol');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(options.headers).toEqual({ Authorization: `Bearer ${key}` });
    expect(options.redirect).toBe('error');
    return Response.json({ id: 'gpt-6.1-sol', permissions: ['private account metadata'] });
  });
  vi.stubGlobal('fetch', request);
  expect(openAIModelAccess.isInternal).toBe(true);
  expect(await probe()).toEqual({ modelId: 'gpt-6.1-sol', status: 200, errorCode: null });
  expect(request).toHaveBeenCalledOnce();
});

test('provider failures return only the status and safe error code, excluding messages and bodies', async () => {
  vi.stubEnv('OPENAI_API_KEY', key);
  vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1/');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'model_not_found', message: `${key} private provider details` } }, { status: 404 })));
  expect(await probe()).toEqual({ modelId: 'gpt-6.1-sol', status: 404, errorCode: 'model_not_found' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: key } }, { status: 403 })));
  expect(JSON.stringify(await probe())).not.toContain(key);
});

test('missing configuration and invalid endpoints never issue a request, while network failures stay private', async () => {
  const request = vi.fn(async () => { throw new Error(key); });
  vi.stubGlobal('fetch', request);
  vi.stubEnv('OPENAI_API_KEY', '');
  expect(await probe()).toEqual({ modelId: 'gpt-6.1-sol', status: 0, errorCode: 'openai_not_configured' });
  vi.stubEnv('OPENAI_API_KEY', key);
  vi.stubEnv('OPENAI_BASE_URL', 'http://unsafe.example');
  expect(await probe()).toEqual({ modelId: 'gpt-6.1-sol', status: 0, errorCode: 'invalid_base_url' });
  expect(request).not.toHaveBeenCalled();
  vi.stubEnv('OPENAI_BASE_URL', '');
  expect(await probe()).toEqual({ modelId: 'gpt-6.1-sol', status: 0, errorCode: 'model_probe_failed' });
});

test('available-model diagnosis returns IDs only without account metadata, messages or credentials', async () => {
  vi.stubEnv('OPENAI_API_KEY', key);
  vi.stubEnv('OPENAI_BASE_URL', '');
  const request = vi.fn(async (url: URL, options: RequestInit) => {
    expect(url.href).toBe('https://api.openai.com/v1/models');
    expect(options.method).toBe('GET');
    return Response.json({ data: [{ id: 'gpt-5.5', owned_by: 'private organization' }, { id: key }, { id: 'gpt-5.5' }, { id: 'not a model' }, { id: 'gpt-6.1-sol' }] });
  });
  vi.stubGlobal('fetch', request);
  expect(openAIAvailableModels.isInternal).toBe(true);
  const list = () => (openAIAvailableModels as unknown as { _handler: (ctx: unknown, args: {}) => Promise<unknown> })._handler({}, {});
  expect(await list()).toEqual({ modelIds: ['gpt-5.5', 'gpt-6.1-sol'], status: 200, errorCode: null });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'invalid_api_key', message: key } }, { status: 401 })));
  expect(await list()).toEqual({ modelIds: [], status: 401, errorCode: 'invalid_api_key' });
});

test.each(['gpt-6.1-sol', 'gpt-6-astra'])('internal generation probe bounds %s to one synthetic request and returns only metadata', async modelId => {
  vi.stubEnv('OPENAI_API_KEY', key); vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1/');
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const request = vi.fn(async (url: URL, options: RequestInit) => {
    expect(url.href).toBe('https://api.openai.com/v1/responses'); expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error'); expect(options.headers).toEqual({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
    expect(JSON.parse(String(options.body))).toEqual({ model: modelId, input: 'Reply OK.', max_output_tokens: 16, reasoning: { effort: 'medium', mode: 'standard' }, service_tier: 'default', store: false, include: ['reasoning.encrypted_content'], prompt_cache_options: { ttl: '30m' } });
    return Response.json({ id: 'private-response-id', model: modelId, output: [{ text: key }], usage: { input_tokens: 12, output_tokens: 16, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 14 } } });
  });
  vi.stubGlobal('fetch', request);
  expect(openAIGenerationAccess.isInternal).toBe(true);
  const result = await generationProbe(modelId);
  expect(result).toEqual({ modelId, model: modelId, status: 200, available: true, errorCode: null, usage: { inputTokens: 12, outputTokens: 16, reasoningTokens: 14, cachedInputTokens: 0, cacheWriteInputTokens: 0 } });
  expect(JSON.stringify(result)).not.toContain(key); expect(JSON.stringify(result)).not.toContain('private-response-id');
  expect(request).toHaveBeenCalledOnce(); expect(timeout).toHaveBeenCalledWith(20_000); timeout.mockRestore();
});

test('generation refusal and timeout are sanitized, leave missing usage unknown and never retry', async () => {
  vi.stubEnv('OPENAI_API_KEY', key); vi.stubEnv('OPENAI_BASE_URL', '');
  const request = vi.fn(async () => Response.json({ error: { code: 'model_not_found', message: `${key} private request details` } }, { status: 404 }));
  vi.stubGlobal('fetch', request);
  const unknown = { inputTokens: null, outputTokens: null, reasoningTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null };
  expect(await generationProbe()).toEqual({ modelId: 'gpt-6.1-sol', model: null, status: 404, available: false, errorCode: 'model_not_found', usage: unknown });
  expect(request).toHaveBeenCalledOnce();
  const timeout = vi.fn(async () => { throw new DOMException(key, 'TimeoutError'); }); vi.stubGlobal('fetch', timeout);
  expect(await generationProbe()).toEqual({ modelId: 'gpt-6.1-sol', model: null, status: 0, available: false, errorCode: 'model_probe_timeout', usage: unknown });
  expect(timeout).toHaveBeenCalledOnce();
});
