import { verifyWebhook } from '@clerk/backend/webhooks';
import type { HttpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { alertText, discordWebhookUrl } from './lib/discord_alert';

const MAX_BODY_BYTES = 256 * 1024;
class PayloadError extends Error {}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new PayloadError('Missing body');
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new PayloadError('Body too large'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function id(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? String(value) : alertText(value, 200); }
function hex(buffer: ArrayBuffer) { return Array.from(new Uint8Array(buffer), n => n.toString(16).padStart(2, '0')).join(''); }
async function digest(value: string) { return await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); }
async function equalSecret(left: string, right: string) {
  const a = new Uint8Array(await digest(left)), b = new Uint8Array(await digest(right));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
const unavailable = () => new Response('Notifications are not configured', { status: 503 });
const received = () => new Response('Received', { status: 200 });
function providerLink(value: unknown, domain: string) {
  try {
    const url = new URL(typeof value === 'string' ? value : '');
    if (url.protocol !== 'https:' || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) || url.username || url.password || url.port) return '';
    url.search = ''; url.hash = '';
    return url.toString();
  } catch { return ''; }
}

export function registerAlertWebhooks(http: HttpRouter) {
  http.route({ path: '/clerk/webhook', method: 'POST', handler: httpAction(async (ctx, request) => {
    const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (!signingSecret || !discordWebhookUrl()) return unavailable();
    let event;
    try {
      const body = await readBody(request);
      event = await verifyWebhook(new Request(request.url, { method: 'POST', headers: request.headers, body }), { signingSecret });
    } catch (error) { return new Response('Invalid webhook', { status: error instanceof PayloadError ? 413 : 400 }); }
    if (!['user.created', 'user.deleted'].includes(event.type)) return received();
    const eventId = request.headers.get('svix-id')?.trim();
    if (!eventId || eventId.length > 256) return new Response('Invalid event ID', { status: 400 });
    try {
      await ctx.runMutation(internal.discordAlerts.enqueue, { source: 'clerk', eventId, title: event.type === 'user.created' ? 'New Revline signup' : 'Revline account deleted', description: `Event: ${event.type}\nUser: ${id(event.data.id)}` });
      return received();
    } catch { return new Response('Notification could not be queued', { status: 503 }); }
  }) });

  // Sentry integration-platform webhooks sign the exact JSON body with the integration Client Secret.
  http.route({ path: '/sentry/webhook', method: 'POST', handler: httpAction(async (ctx, request) => {
    const secret = process.env.SENTRY_WEBHOOK_SECRET;
    if (!secret || !discordWebhookUrl()) return unavailable();
    const signature = request.headers.get('sentry-hook-signature') ?? '';
    if (!/^[a-f0-9]{64}$/i.test(signature)) return new Response('Invalid signature', { status: 401 });
    let body: string, payload: Record<string, unknown>;
    try {
      body = await readBody(request);
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      const signatureBytes = Uint8Array.from(signature.match(/.{2}/g)!, pair => parseInt(pair, 16));
      if (!await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(body))) return new Response('Invalid signature', { status: 401 });
      payload = object(JSON.parse(body));
    } catch (error) { return new Response('Invalid webhook', { status: error instanceof PayloadError ? 413 : 400 }); }
    const resource = request.headers.get('sentry-hook-resource');
    if (!['issue', 'error', 'event_alert', 'metric_alert'].includes(resource ?? '')) return received();
    const data = object(payload.data), issue = object(data.issue), event = object(data.event), alert = object(data.metric_alert);
    const eventId = hex(await digest(body));
    const link = providerLink(issue.web_url ?? issue.permalink ?? event.web_url, 'sentry.io');
    const description = [`Event: ${alertText(resource, 50)}`, `Action: ${alertText(payload.action, 80)}`, `Reference: ${id(issue.id ?? event.event_id ?? event.id ?? alert.id)}`, link].filter(Boolean).join('\n');
    try {
      await ctx.runMutation(internal.discordAlerts.enqueue, { source: 'sentry', eventId, title: 'Sentry alert', description });
      return received();
    } catch { return new Response('Notification could not be queued', { status: 503 }); }
  }) });

  // PostHog's HTTP Webhook destination supports a custom Authorization header and JSON body.
  http.route({ path: '/posthog/webhook', method: 'POST', handler: httpAction(async (ctx, request) => {
    const secret = process.env.POSTHOG_WEBHOOK_SECRET;
    if (!secret || !discordWebhookUrl()) return unavailable();
    const authorization = request.headers.get('authorization') ?? '';
    if (authorization.length > 1024 || !await equalSecret(authorization, `Bearer ${secret}`)) return new Response('Invalid authorization', { status: 401 });
    let payload: Record<string, unknown>;
    try { payload = object(JSON.parse(await readBody(request))); }
    catch (error) { return new Response('Invalid webhook', { status: error instanceof PayloadError ? 413 : 400 }); }
    const eventId = id(payload.id), event = alertText(payload.event, 120);
    if (!eventId || !event) return new Response('Expected event id and event name', { status: 400 });
    const link = providerLink(payload.url, 'posthog.com');
    try {
      await ctx.runMutation(internal.discordAlerts.enqueue, { source: 'posthog', eventId, title: 'PostHog event', description: [`Event: ${event}`, `Reference: ${eventId}`, link].filter(Boolean).join('\n') });
      return received();
    } catch { return new Response('Notification could not be queued', { status: 503 }); }
  }) });
}
