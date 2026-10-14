import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { afterEach, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
function fixture() {
  const storage = { setAlarm: vi.fn().mockResolvedValue(undefined) };
  const healthyAt = Date.now() + 45_000;
  const container = { running: false, images: { processor: 'fixture-image' }, start: vi.fn(() => { container.running = true; }), setInactivityTimeout: vi.fn().mockResolvedValue(undefined), getTcpPort: () => ({ fetch: () => new Promise<Response>((resolve, reject) => setTimeout(() => Date.now() >= healthyAt ? resolve(new Response('{}')) : reject(new Error('Still starting')), 1000)) }) };
  const ctx = { storage, container };
  const env = { RENDER_WORKER_SECRET: 'fixture-secret', GOOGLE_GENERATIVE_AI_API_KEY: 'fixture-key', OPENAI_API_KEY: 'fixture-openai-key', NEXT_PUBLIC_CONVEX_URL: 'https://fixture.convex.cloud', MEDIA_WORKER_URL: 'https://media.example', GEMINI_VIDEO_MODEL: 'fixture-model', PROCESSOR: {} };
  const module = { exports: {} as { MediaProcessor: new (ctx: object, env: object) => { alarm(): Promise<void> }; default: { fetch(request: Request, env: object, ctx: object): Promise<Response> } } };
  const code = transformSync(readFileSync(new URL('./cloudflare.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  runInNewContext(code, { module, exports: module.exports, require: (id: string) => id === 'cloudflare:workers' ? { DurableObject: class { constructor(public ctx: object, public env: object) {} } } : id === 'convex/browser' ? { ConvexHttpClient: class { query() { return Promise.resolve('fixture-task'); } } } : require(id), Date, URL, TextEncoder, Response, AbortSignal, crypto: { subtle: { timingSafeEqual } }, console, scheduler: { wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)) } });
  const processor = new module.exports.MediaProcessor(ctx, env);
  env.PROCESSOR = { getByName: () => processor };
  return { storage, container, ctx, env, processor, worker: module.exports.default };
}
afterEach(() => vi.useRealTimers());

test('wake durably acknowledges startup before a cold container exceeds the HTTP lifetime', async () => {
  vi.useFakeTimers();
  const f = fixture(), http = { waitUntil: vi.fn() };
  const response = await f.worker.fetch(new Request('https://processor.example/wake', { method: 'POST', headers: { authorization: 'Bearer fixture-secret' } }), f.env, http);
  expect(response.status).toBe(202);
  expect(f.storage.setAlarm).toHaveBeenCalledWith(Date.now());
  expect(http.waitUntil).not.toHaveBeenCalled();
  expect(f.container.start).not.toHaveBeenCalled();
  const startup = f.processor.alarm();
  await vi.advanceTimersByTimeAsync(46_000);
  await startup;
  expect(f.container.start).toHaveBeenCalledOnce();
  expect(f.container.start).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ OPENAI_API_KEY: 'fixture-openai-key', GOOGLE_GENERATIVE_AI_API_KEY: 'fixture-key', GEMINI_VIDEO_MODEL: 'fixture-model' }) }));
});

test('an unauthorized wake cannot schedule container work', async () => {
  const f = fixture();
  const response = await f.worker.fetch(new Request('https://processor.example/wake', { method: 'POST', headers: { authorization: 'Bearer wrong' } }), f.env, { waitUntil: vi.fn() });
  expect(response.status).toBe(401);
  expect(f.storage.setAlarm).not.toHaveBeenCalled();
  expect(f.container.start).not.toHaveBeenCalled();
});
