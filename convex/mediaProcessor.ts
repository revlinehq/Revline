import { v } from 'convex/values';
import { internal } from './_generated/api';
import { processorBackend } from './lib/processor_backend';
import { internalAction } from './_generated/server';

/** Optional immediate wake for the hosted processor; its cron recovers missed wakes. */
export const wake = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  const backend = processorBackend();
  if (backend === 'local') return null;
  if (backend === 'fly') { await ctx.runAction(internal.flyProcessor.dispatch, {}); return null; }
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
