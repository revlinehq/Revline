"use node";
// The only code that makes requests to Content Rewards. It asks for exactly two kinds of URL, the sitemap and
// the public campaign pages the sitemap lists (lib/campaigns/source.ts `readableUrl`), never /api/ and never
// with a session; one request at a time, at most one per second, under an honest User-Agent.
// It runs only when CAMPAIGN_READER_ENABLED is set.
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import type { ReadOutcome } from './campaignsModel';
import { SITEMAP_URL, campaignIdsFromSitemap, campaignUrl, parseCampaignPage, readableUrl } from '../lib/campaigns/source';
import { MAX_PAGE_BYTES, MIN_REQUEST_INTERVAL_MS, READER_OFF, READER_USER_AGENT, READ_BATCH, REQUEST_TIMEOUT_MS, readerEnabled } from '../lib/campaigns/reader-config';

type Fetched = { ok: true; body: string } | { ok: false; status?: number; retry: boolean; gone?: boolean; reason: string; retryAfterMs?: number };

async function fetchPublic(url: string): Promise<Fetched> {
  if (!readableUrl(url)) throw new Error(`The campaign reader may not request ${url}`);
  try {
    // No cookies, no credentials. A redirect is not followed (it could lead to a sign-in page) and not retried.
    const response = await fetch(url, { headers: { 'User-Agent': READER_USER_AGENT, Accept: 'text/html,application/xml;q=0.9' }, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get('retry-after'));
      return { ok: false, status: response.status, retry: true, reason: `HTTP ${response.status}`, ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: seconds * 1000 } : {}) };
    }
    if (response.status >= 300 && response.status < 400) return { ok: false, status: response.status, retry: false, reason: `HTTP ${response.status}: redirected, not followed` };
    if (response.status === 404 || response.status === 410) return { ok: false, status: response.status, retry: false, gone: true, reason: `HTTP ${response.status}` };
    if (!response.ok) return { ok: false, status: response.status, retry: false, reason: `HTTP ${response.status}` };
    const body = await response.text();
    if (body.length > MAX_PAGE_BYTES) return { ok: false, status: response.status, retry: false, reason: `page is ${body.length} characters, over the ${MAX_PAGE_BYTES} limit` };
    return { ok: true, body };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'request failed';
    return { ok: false, retry: true, reason: reason.slice(0, 200) };
  }
}

async function readPage(sourceId: string): Promise<ReadOutcome> {
  const fetched = await fetchPublic(campaignUrl(sourceId));
  if (fetched.ok) return parseCampaignPage(fetched.body, sourceId);
  if (fetched.gone) return { kind: 'no_data', reason: fetched.reason };
  if (fetched.retry) return { kind: 'retry', reason: fetched.reason, ...(fetched.status === undefined ? {} : { status: fetched.status }), ...(fetched.retryAfterMs === undefined ? {} : { retryAfterMs: fetched.retryAfterMs }) };
  return { kind: 'http', status: fetched.status ?? 0, reason: fetched.reason };
}

/** Works through the queue a small batch at a time, then schedules itself for the next batch. */
export const drain = internalAction({ args: { token: v.string() }, returns: v.null(), handler: async (ctx, { token }): Promise<null> => {
  if (!readerEnabled()) { console.log(READER_OFF); return null; }
  const work = await ctx.runMutation(internal.campaignsReader.claim, { token, limit: READ_BATCH });
  if (!work) return null;
  if (work.retryInMs !== undefined) { await ctx.scheduler.runAfter(work.retryInMs, internal.campaignsReaderActions.drain, { token }); return null; }
  let last = work.lastRequestAt;
  const pace = async () => {
    const wait = last + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    return last = Date.now();
  };
  if (work.sitemap) {
    const requestedAt = await pace();
    const fetched = await fetchPublic(SITEMAP_URL);
    const sourceIds = fetched.ok ? campaignIdsFromSitemap(fetched.body) : [];
    if (!fetched.ok || !sourceIds.length) {
      await ctx.runMutation(internal.campaignsReader.sitemapFailed, { token, requestedAt, reason: fetched.ok ? 'sitemap lists no campaign pages' : fetched.reason, ...(!fetched.ok && fetched.status !== undefined ? { status: fetched.status } : {}), ...(!fetched.ok && fetched.retryAfterMs !== undefined ? { retryAfterMs: fetched.retryAfterMs } : {}) });
    } else {
      let held = true;
      for (let at = 0; at < sourceIds.length && held; at += 150) held = await ctx.runMutation(internal.campaignsReader.sitemapApply, { token, sweepAt: requestedAt, sourceIds: sourceIds.slice(at, at + 150) });
      if (held) await ctx.runMutation(internal.campaignsReader.sitemapFinish, { token, requestedAt, sweepAt: requestedAt, count: sourceIds.length });
    }
  } else {
    for (const sourceId of work.sourceIds) {
      const requestedAt = await pace();
      const outcome = await readPage(sourceId);
      let proceed: boolean;
      try { ({ proceed } = await ctx.runMutation(internal.campaignsReader.record, { token, sourceId, requestedAt, outcome })); }
      // A reading that cannot be stored must not block the pages behind it: drop it from the queue and note why.
      catch (error) { ({ proceed } = await ctx.runMutation(internal.campaignsReader.skip, { token, sourceId, requestedAt, reason: error instanceof Error ? error.message : 'could not store the reading' })); }
      if (!proceed) break;
    }
  }
  // The next claim decides whether there is more to do, a backoff to wait out, or nothing.
  await ctx.scheduler.runAfter(0, internal.campaignsReaderActions.drain, { token });
  return null;
} });
