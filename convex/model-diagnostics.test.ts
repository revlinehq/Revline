import { afterEach, expect, test, vi } from 'vitest';
import { openAIAvailableModels, openAIModelAccess } from './modelDiagnostics';

const key = 'fixture-private-server-key';
const probe = (modelId = 'gpt-6.1-sol') => (openAIModelAccess as unknown as { _handler: (ctx: unknown, args: { modelId: string }) => Promise<unknown> })._handler({}, { modelId });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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
