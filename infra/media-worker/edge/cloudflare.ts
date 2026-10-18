import { DurableObject } from 'cloudflare:workers';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

type ProcessorSecrets = { RENDER_WORKER_SECRET: string; GOOGLE_GENERATIVE_AI_API_KEY: string; OPENAI_API_KEY?: string };
type Bindings = ProcessorEnv & ProcessorSecrets;
const TIMEOUT_MS = 5 * 60_000;
const INSTANCE_TYPE = 'standard-4';
const RESOURCE_PROFILE = '4-vcpu-12g-v1';
// Retain the existing instance so an active export survives this capacity rollout.
const PROCESSOR_NAMES = ['production', 'production-2', 'production-3', 'production-4', 'production-5'];
const readyQuery = makeFunctionReference<'query', { workerSecret: string;processorVersion:number }, string>('mediaTasks:ready');

export class MediaProcessor extends DurableObject<Bindings> {
  private pending: Promise<void> | undefined;
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    if (ctx.container?.running) void ctx.blockConcurrencyWhile(() => ctx.container!.setInactivityTimeout(TIMEOUT_MS));
  }
  async wake(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now());
  }
  alarm(): Promise<void> {
    return this.tick();
  }
  tick(): Promise<void> {
    this.pending ??= this.ensureWorker().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async status(): Promise<{ running: boolean; healthy: boolean; resourceProfile?: string; activeTasks?: number; draining?: boolean }> {
    if (!this.ctx.container?.running) return { running: false, healthy: false };
    try {
      const current = await this.ctx.container.inspect();
      const response = await this.ctx.container.getTcpPort(8080).fetch('http://container/health', { signal: AbortSignal.timeout(2000) });
      const health = await response.json() as { activeTasks?: number; draining?: boolean };
      return { running: true, healthy: response.ok, resourceProfile: current?.labels.profile ?? 'legacy-1-vcpu', ...(Number.isInteger(health.activeTasks) ? { activeTasks: health.activeTasks } : {}), ...(typeof health.draining === 'boolean' ? { draining: health.draining } : {}) };
    } catch { return { running: true, healthy: false }; }
  }
  private async ensureWorker(): Promise<void> {
    if (!this.env.RENDER_WORKER_SECRET || !this.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error('Production processing secrets are not configured.');
    const container = this.ctx.container!;
    if (container.running) {
      const current = await container.inspect();
      if (current?.image && (current.image !== container.images.processor || current.labels.profile !== RESOURCE_PROFILE)) {
        const response = await container.getTcpPort(8080).fetch('http://container/drain', { method: 'POST', headers: { authorization: `Bearer ${this.env.RENDER_WORKER_SECRET}` }, signal: AbortSignal.timeout(5000) });
        await response.body?.cancel();
        if (!response.ok) throw new Error('The previous media processor could not drain.');
        await container.setInactivityTimeout(20 * 60_000);
        return;
      }
    } else {
      const client = new ConvexHttpClient(this.env.NEXT_PUBLIC_CONVEX_URL);
      const ready = await client.query(readyQuery, { workerSecret: this.env.RENDER_WORKER_SECRET,processorVersion:3 });
      if (!ready) return;
      container.start({ image: container.images.processor, instance: INSTANCE_TYPE, labels: { profile: RESOURCE_PROFILE }, enableInternet: true, env: {
        NEXT_PUBLIC_CONVEX_URL: this.env.NEXT_PUBLIC_CONVEX_URL,
        MEDIA_WORKER_URL: this.env.MEDIA_WORKER_URL,
        RENDER_WORKER_SECRET: this.env.RENDER_WORKER_SECRET,
        GOOGLE_GENERATIVE_AI_API_KEY: this.env.GOOGLE_GENERATIVE_AI_API_KEY,
        ...(this.env.OPENAI_API_KEY ? { OPENAI_API_KEY: this.env.OPENAI_API_KEY } : {}),
        GEMINI_VIDEO_MODEL: this.env.GEMINI_VIDEO_MODEL,
      } });
    }
    await container.setInactivityTimeout(TIMEOUT_MS);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await container.getTcpPort(8080).fetch('http://container/health', { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch { /* A newly started process may not be listening yet. */ }
      await scheduler.wait(200);
    }
    throw new Error('The media processor did not become healthy.');
  }
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!(request.method === 'POST' && path === '/wake') && !(request.method === 'GET' && path === '/status')) return new Response('Not found', { status: 404 });
    const encoder = new TextEncoder(), provided = encoder.encode(request.headers.get('authorization') ?? ''), expected = encoder.encode(`Bearer ${env.RENDER_WORKER_SECRET}`);
    if (!env.RENDER_WORKER_SECRET || provided.length !== expected.length || !crypto.subtle.timingSafeEqual(provided, expected)) return new Response('Unauthorized', { status: 401 });
    if (path === '/status') {
      const processors = await Promise.all(PROCESSOR_NAMES.map(async name => ({ name, ...await env.PROCESSOR.getByName(name).status() })));
      return Response.json({ capacity: PROCESSOR_NAMES.length, instanceType: INSTANCE_TYPE, processors }, { headers: { 'Cache-Control': 'no-store' } });
    }
    await Promise.all(PROCESSOR_NAMES.map(name => env.PROCESSOR.getByName(name).wake()));
    return Response.json({ accepted: true }, { status: 202 });
  },
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    // One failed boot must not prevent the other slots from picking up queued jobs.
    const results = await Promise.allSettled(PROCESSOR_NAMES.map(name => env.PROCESSOR.getByName(name).tick()));
    if (results.some(result => result.status === 'rejected')) throw new Error('One or more media processor slots could not become ready.');
  },
} satisfies ExportedHandler<Bindings>;
