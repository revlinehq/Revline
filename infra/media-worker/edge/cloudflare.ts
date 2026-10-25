import { DurableObject } from 'cloudflare:workers';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

type ProcessorSecrets = { RENDER_WORKER_SECRET: string; GOOGLE_GENERATIVE_AI_API_KEY: string; OPENAI_API_KEY?: string };
type Bindings = ProcessorEnv & ProcessorSecrets;
const TIMEOUT_MS = 5 * 60_000;
const INSTANCE_TYPE = 'standard-3';
const RESOURCE_PROFILE = '2-vcpu-8g-v1';
// Ultra exports run on their own 4-vCPU slot; it claims only Ultra jobs and
// starts only when one is queued.
const ULTRA_INSTANCE_TYPE = 'standard-4';
const ULTRA_RESOURCE_PROFILE = '4-vcpu-12g-v1';
const ULTRA_PROCESSOR_NAME = 'production-ultra';
// Retain the existing instance so an active export survives this capacity rollout.
const PROCESSOR_NAMES = ['production', 'production-2', ULTRA_PROCESSOR_NAME];
const RETIRED_PROCESSOR_NAMES = ['production-3', 'production-4', 'production-5'];
const readyQuery = makeFunctionReference<'query', { workerSecret: string;processorVersion:number;lane?:'ultra' }, string>('mediaTasks:ready');

export class MediaProcessor extends DurableObject<Bindings> {
  private pending: Promise<void> | undefined;
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    if (ctx.container?.running) void ctx.blockConcurrencyWhile(() => ctx.container!.setInactivityTimeout(TIMEOUT_MS));
  }
  /** The slot's lane arrives with each controller call and is kept for its own alarms. */
  private async remember(ultra?: boolean) { if (ultra !== undefined) await this.ctx.storage.put('ultra', ultra); }
  async wake(ultra?: boolean): Promise<void> {
    await this.remember(ultra);
    await this.ctx.storage.delete('retired');
    await this.ctx.storage.setAlarm(Date.now());
  }
  /** Explicit operator recovery only; Convex requeues work after its lease expires. */
  async restart(resume = true): Promise<void> {
    await this.ctx.storage.put('retired', !resume);
    await this.ctx.storage.deleteAlarm();
    if (this.ctx.container?.running) await this.ctx.container.destroy();
    if (resume) await this.wake();
  }
  async retire(): Promise<void> {
    await this.ctx.storage.put('retired', true);
    await this.ctx.storage.deleteAlarm();
    if (this.ctx.container?.running) {
      const response = await this.ctx.container.getTcpPort(8080).fetch('http://container/drain', { method: 'POST', headers: { authorization: `Bearer ${this.env.RENDER_WORKER_SECRET}` }, signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      if (!response.ok) throw new Error('The retired media processor could not drain.');
    }
  }
  alarm(): Promise<void> {
    return this.tick();
  }
  async tick(ultra?: boolean): Promise<void> {
    await this.remember(ultra);
    this.pending ??= this.ensureWorker().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async status(): Promise<{ running: boolean; healthy: boolean; resourceProfile?: string; activeTasks?: number; draining?: boolean; processorVersion?: number; image?: string; configuredImage?: string }> {
    const configuredImage = this.ctx.container?.images.processor;
    if (!this.ctx.container?.running) return { running: false, healthy: false, configuredImage };
    try {
      const current = await this.ctx.container.inspect();
      const response = await this.ctx.container.getTcpPort(8080).fetch('http://container/health', { signal: AbortSignal.timeout(2000) });
      const health = await response.json() as { activeTasks?: number; draining?: boolean; processorVersion?: number };
      return { running: true, healthy: response.ok, image: current?.image, configuredImage, resourceProfile: current?.labels.profile ?? 'legacy-1-vcpu', ...(Number.isInteger(health.activeTasks) ? { activeTasks: health.activeTasks } : {}), ...(typeof health.draining === 'boolean' ? { draining: health.draining } : {}), ...(Number.isInteger(health.processorVersion) ? { processorVersion: health.processorVersion } : {}) };
    } catch { return { running: true, healthy: false, configuredImage }; }
  }
  private async ensureWorker(): Promise<void> {
    if (await this.ctx.storage.get('retired')) return;
    if (!this.env.RENDER_WORKER_SECRET || !this.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error('Production processing secrets are not configured.');
    const container = this.ctx.container!;
    const ultra = await this.ctx.storage.get('ultra') === true;
    const profile = ultra ? ULTRA_RESOURCE_PROFILE : RESOURCE_PROFILE;
    if (container.running) {
      const current = await container.inspect();
      if (current?.image && (current.image !== container.images.processor || current.labels.profile !== profile)) {
        const response = await container.getTcpPort(8080).fetch('http://container/drain', { method: 'POST', headers: { authorization: `Bearer ${this.env.RENDER_WORKER_SECRET}` }, signal: AbortSignal.timeout(5000) });
        await response.body?.cancel();
        if (!response.ok) throw new Error('The previous media processor could not drain.');
        await container.setInactivityTimeout(20 * 60_000);
        return;
      }
    } else {
      const client = new ConvexHttpClient(this.env.NEXT_PUBLIC_CONVEX_URL);
      const ready = await client.query(readyQuery, { workerSecret: this.env.RENDER_WORKER_SECRET,processorVersion:5,...(ultra?{lane:'ultra' as const}:{}) });
      if (!ready || await this.ctx.storage.get('retired')) return;
      container.start({ image: container.images.processor, instance: ultra ? ULTRA_INSTANCE_TYPE : INSTANCE_TYPE, labels: { profile }, enableInternet: true, env: {
        // Three capture workers and FFmpeg slots use the Ultra slot's four vCPUs.
        ...(ultra ? { MEDIA_LANE: 'ultra', REVLINE_RENDER_WORKERS: '3', REVLINE_RENDER_FFMPEG_SLOTS: '3' } : {}),
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
    if (!(request.method === 'POST' && (path === '/wake' || path === '/restart')) && !(request.method === 'GET' && path === '/status')) return new Response('Not found', { status: 404 });
    const encoder = new TextEncoder(), provided = encoder.encode(request.headers.get('authorization') ?? ''), expected = encoder.encode(`Bearer ${env.RENDER_WORKER_SECRET}`);
    if (!env.RENDER_WORKER_SECRET || provided.length !== expected.length || !crypto.subtle.timingSafeEqual(provided, expected)) return new Response('Unauthorized', { status: 401 });
    if (path === '/restart') {
      const body = await request.json().catch(() => null) as { name?: unknown } | null;
      if (typeof body?.name !== 'string' || ![...PROCESSOR_NAMES, ...RETIRED_PROCESSOR_NAMES].includes(body.name)) return Response.json({ error: 'Choose an existing processor slot.' }, { status: 400 });
      if (body.name === ULTRA_PROCESSOR_NAME) await env.PROCESSOR.getByName(body.name).wake(true);
      await env.PROCESSOR.getByName(body.name).restart(PROCESSOR_NAMES.includes(body.name));
      return Response.json({ accepted: true }, { status: 202 });
    }
    if (path === '/status') {
      const processors = await Promise.all(PROCESSOR_NAMES.map(async name => ({ name, ...await env.PROCESSOR.getByName(name).status() })));
      const retiring = await Promise.all(RETIRED_PROCESSOR_NAMES.map(async name => ({ name, ...await env.PROCESSOR.getByName(name).status() })));
      return Response.json({ capacity: PROCESSOR_NAMES.length, instanceType: INSTANCE_TYPE, ultraInstanceType: ULTRA_INSTANCE_TYPE, processorVersion: 5, processors, retiring }, { headers: { 'Cache-Control': 'no-store' } });
    }
    await Promise.all([...PROCESSOR_NAMES.map(name => env.PROCESSOR.getByName(name).wake(name === ULTRA_PROCESSOR_NAME)), ...RETIRED_PROCESSOR_NAMES.map(name => env.PROCESSOR.getByName(name).retire())]);
    return Response.json({ accepted: true }, { status: 202 });
  },
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    // One failed boot must not prevent the other slots from picking up queued jobs.
    const results = await Promise.allSettled([...PROCESSOR_NAMES.map(name => env.PROCESSOR.getByName(name).tick(name === ULTRA_PROCESSOR_NAME)), ...RETIRED_PROCESSOR_NAMES.map(name => env.PROCESSOR.getByName(name).retire())]);
    if (results.some(result => result.status === 'rejected')) throw new Error('One or more media processor slots could not become ready.');
  },
} satisfies ExportedHandler<Bindings>;
