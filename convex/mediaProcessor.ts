import { v } from 'convex/values';
import { internal } from './_generated/api';
import { processorBackend } from './lib/processor_backend';
import { internalAction, internalQuery, mutation } from './_generated/server';
import { requireMediaWorker } from './lib/media_task_auth';
import { reportedCapabilities } from './lib/processor_capabilities';

/** Optional immediate wake for the hosted processor; its cron recovers missed wakes. */
export const wake = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  const backend = processorBackend();
  if (backend === 'local') return null;
  if (backend === 'railway') { await ctx.runAction(internal.railwayWorkers.dispatch, {}); return null; }
  const url = process.env?.MEDIA_PROCESSOR_WAKE_URL;
  const secret = process.env?.RENDER_WORKER_SECRET;
  if (!url || !secret) return null;
  try {
    if (new URL(url).protocol !== 'https:') throw new Error('Invalid processor wake URL.');
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    await response.body?.cancel();
    if (!response.ok) console.warn(`Media processor wake failed (${response.status}); scheduled recovery remains available.`);
  } catch { console.warn('Media processor wake unavailable; scheduled recovery remains available.'); }
  return null;
} });

/** Sign-in report: a processor says what it can do when it starts its queue loop. Its own function, never new
 *  arguments on claim/ready: the processor image is released before Convex, so a new worker can meet a backend
 *  that would reject unknown arguments (and a worker meeting a backend without this function ignores the error). */
export const reportCapabilities = mutation({ args: { workerSecret: v.string(), processorVersion: v.number(), capabilitiesVersion: v.number(), capabilities: v.array(v.string()), backend: v.union(v.literal('railway'), v.literal('cloudflare'), v.literal('local')) }, returns: v.null(), handler: async (ctx, args) => {
  if (requireMediaWorker(args.workerSecret) !== 'processor') return null;
  const report = { backend: args.backend, processorVersion: args.processorVersion, capabilitiesVersion: args.capabilitiesVersion, capabilities: [...new Set(args.capabilities)].slice(0, 200), reportedAt: Date.now() };
  const row = await ctx.db.query('processorReports').withIndex('by_backend', q => q.eq('backend', args.backend)).unique();
  if (row) await ctx.db.replace(row._id, report); else await ctx.db.insert('processorReports', report);
  return null;
} });
/** What the processor of the active backend last reported; null when none has ever reported. For processorCan in actions. */
export const capabilities = internalQuery({ args: {}, returns: v.union(v.array(v.string()), v.null()), handler: ctx => reportedCapabilities(ctx) });
