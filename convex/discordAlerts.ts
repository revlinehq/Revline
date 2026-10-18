import { v } from 'convex/values';
import { internalAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { alertFields, alertText, discordWebhookUrl } from './lib/discord_alert';

const MAX_ATTEMPTS = 4;
const LEASE_MS = 30_000;
const retryDelays = [5_000, 30_000, 120_000];

export const enqueue = internalMutation({
  args: alertFields, returns: v.union(v.id('discordAlerts'), v.null()),
  handler: async (ctx, args) => {
    if (!discordWebhookUrl()) return null;
    if (!args.eventId || args.eventId.length > 256 || !args.title || args.title.length > 200 || args.description.length > 1500) throw new Error('Invalid alert');
    const previous = await ctx.db.query('discordAlerts').withIndex('by_source_event', q => q.eq('source', args.source).eq('eventId', args.eventId)).unique();
    if (previous) return previous._id;
    const now = Date.now();
    const id = await ctx.db.insert('discordAlerts', { ...args, title: alertText(args.title, 200), description: alertText(args.description, 1500), status: 'queued', attempts: 0, createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.discordAlerts.deliver, { id });
    return id;
  },
});

export const claim = internalMutation({
  args: { id: v.id('discordAlerts') },
  returns: v.union(v.null(), v.object({ title: v.string(), description: v.string(), source: alertFields.source, attempt: v.number() })),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    const now = Date.now();
    if (!row || row.status === 'sent' || row.status === 'failed' || (row.leaseUntil ?? 0) > now) return null;
    if (row.attempts >= MAX_ATTEMPTS) { await ctx.db.patch(id, { status: 'failed', updatedAt: now, lastError: 'Delivery attempts exhausted' }); return null; }
    const attempt = row.attempts + 1;
    await ctx.db.patch(id, { status: 'delivering', attempts: attempt, leaseUntil: now + LEASE_MS, updatedAt: now });
    // Recover if an action is interrupted between claiming and recording its result.
    await ctx.scheduler.runAfter(LEASE_MS + 1000, internal.discordAlerts.deliver, { id });
    return { title: row.title, description: row.description, source: row.source, attempt };
  },
});

export const finish = internalMutation({
  args: { id: v.id('discordAlerts'), attempt: v.number(), sent: v.boolean(), retry: v.boolean(), delay: v.number(), error: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== 'delivering' || row.attempts !== args.attempt) return null;
    const retry = !args.sent && args.retry && args.attempt < MAX_ATTEMPTS;
    const delay = Number.isFinite(args.delay) ? Math.max(1000, Math.min(3_600_000, args.delay)) : 30_000;
    await ctx.db.patch(args.id, { status: args.sent ? 'sent' : retry ? 'queued' : 'failed', leaseUntil: retry ? Date.now() + delay : undefined, lastError: args.sent ? undefined : alertText(args.error, 120), updatedAt: Date.now() });
    if (retry) await ctx.scheduler.runAfter(delay, internal.discordAlerts.deliver, { id: args.id });
    return null;
  },
});

export const deliver = internalAction({
  args: { id: v.id('discordAlerts') }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const alert = await ctx.runMutation(internal.discordAlerts.claim, { id });
    if (!alert) return null;
    const url = discordWebhookUrl();
    let sent = false, retry = false, error = 'Discord destination is not configured';
    let delay = retryDelays[Math.min(alert.attempt - 1, retryDelays.length - 1)];
    if (url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, redirect: 'error',
          body: JSON.stringify({ username: 'Revline', allowed_mentions: { parse: [] }, embeds: [{ title: alert.title, description: alert.description, color: 0x7563ed, footer: { text: `Revline · ${alert.source}` } }] }),
        });
        sent = response.ok;
        retry = response.status === 429 || response.status >= 500;
        error = `Discord returned HTTP ${response.status}`;
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) delay = Math.max(delay, retryAfter * 1000);
        }
        await response.body?.cancel();
      } catch {
        // Never log webhook URLs, provider payloads, or response bodies.
        retry = true; error = 'Discord delivery interrupted';
      } finally { clearTimeout(timeout); }
    }
    await ctx.runMutation(internal.discordAlerts.finish, { id, attempt: alert.attempt, sent, retry, delay, error });
    return null;
  },
});

export const prune = internalMutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    // Retain receipts for 30 days to deduplicate provider retries without keeping them forever.
    for (const status of ['sent', 'failed'] as const) {
      const rows = await ctx.db.query('discordAlerts').withIndex('by_status_updated', q => q.eq('status', status).lt('updatedAt', Date.now() - 30 * 86_400_000)).take(100);
      for (const row of rows) await ctx.db.delete(row._id);
    }
    return null;
  },
});
