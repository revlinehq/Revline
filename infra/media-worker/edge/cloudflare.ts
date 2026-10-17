import { DurableObject } from 'cloudflare:workers';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

type ProcessorSecrets = { RENDER_WORKER_SECRET: string; GOOGLE_GENERATIVE_AI_API_KEY: string; OPENAI_API_KEY?: string };
type Bindings = ProcessorEnv & ProcessorSecrets;
const TIMEOUT_MS = 5 * 60_000;
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
  private async ensureWorker(): Promise<void> {
    if (!this.env.RENDER_WORKER_SECRET || !this.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error('Production processing secrets are not configured.');
    const container = this.ctx.container!;
    if (container.running) {
      const current = await container.inspect();
      if (current?.image && current.image !== container.images.processor) {
        await container.getTcpPort(8080).fetch('http://container/drain', { method: 'POST', headers: { authorization: `Bearer ${this.env.RENDER_WORKER_SECRET}` } });
        await container.setInactivityTimeout(20 * 60_000);
        return;
      }
    } else {
      const client = new ConvexHttpClient(this.env.NEXT_PUBLIC_CONVEX_URL);
      const ready = await client.query(readyQuery, { workerSecret: this.env.RENDER_WORKER_SECRET,processorVersion:3 });
      if (!ready) return;
      container.start({ image: container.images.processor, instance: 'standard-2', enableInternet: true, env: {
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
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/wake') return new Response('Not found', { status: 404 });
    const encoder = new TextEncoder(), provided = encoder.encode(request.headers.get('authorization') ?? ''), expected = encoder.encode(`Bearer ${env.RENDER_WORKER_SECRET}`);
    if (!env.RENDER_WORKER_SECRET || provided.length !== expected.length || !crypto.subtle.timingSafeEqual(provided, expected)) return new Response('Unauthorized', { status: 401 });
    await env.PROCESSOR.getByName('production').wake();
    return Response.json({ accepted: true }, { status: 202 });
  },
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    await env.PROCESSOR.getByName('production').tick();
  },
} satisfies ExportedHandler<Bindings>;
