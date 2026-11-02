import type { HttpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

async function boundedBody(request: Request) {
  if (Number(request.headers.get('content-length')) > 256_000) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > 256_000) { await reader.cancel(); return null; }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export function registerAppleBillingRoutes(http: HttpRouter) {
  http.route({ path: '/app-store/notifications', method: 'POST', handler: httpAction(async (ctx, request) => {
    const body = await boundedBody(request);
    if (body === null) return new Response('Payload too large', { status: 413 });
    try { JSON.parse(body); } catch { return new Response('Invalid JSON', { status: 400 }); }
    const status = await ctx.runAction(internal.appleBillingActions.notification, { body });
    return new Response(status === 200 ? 'OK' : 'Notification not accepted', { status });
  }) });
  http.route({ path: '/superwall/webhook', method: 'POST', handler: httpAction(async (ctx, request) => {
    const id = request.headers.get('svix-id'), timestamp = request.headers.get('svix-timestamp'), signature = request.headers.get('svix-signature');
    if (!id || !timestamp || !signature) return new Response('Signature required', { status: 401 });
    const body = await boundedBody(request);
    if (body === null) return new Response('Payload too large', { status: 413 });
    const status = await ctx.runAction(internal.superwallBilling.webhook, { body, id, timestamp, signature });
    return new Response(status === 200 ? 'OK' : 'Webhook not accepted', { status });
  }) });
}
