// The campaign reader's queue and bookkeeping. Requests are made only by convex/campaignsReaderActions.ts;
// everything here is database work. With CAMPAIGN_READER_ENABLED unset, `tick` logs that and returns.
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { parsedCampaignValidator, readOutcome } from './campaignsModel';
import { endCampaign, upsertCampaign } from './campaignsStore';
import { isSourceId } from '../lib/campaigns/source';
import {
  DRAIN_LEASE_MS, FAILURE_KEEP_MS, HALT_MS, HOURLY_HOT_LIMIT, HOURLY_HOT_SCORE, HOURLY_WATCHED_LIMIT, MAX_BACKOFF_MS, MAX_CONSECUTIVE_FAILURES,
  MAX_PAGE_ATTEMPTS, MAX_UNREADABLE_PAGES, MIN_BACKOFF_MS, READER_OFF, SITEMAP_EVERY_MS, SITEMAP_RETRY_MS, readerEnabled,
} from '../lib/campaigns/reader-config';

async function readerState(ctx: MutationCtx): Promise<Doc<'campaignReader'>> {
  const state = await ctx.db.query('campaignReader').withIndex('by_name', q => q.eq('name', 'reader')).unique();
  return state ?? (await ctx.db.get(await ctx.db.insert('campaignReader', { name: 'reader', consecutiveFailures: 0 })))!;
}
async function enqueue(ctx: MutationCtx, sourceId: string, dueAt: number) {
  const row = await ctx.db.query('campaignReadQueue').withIndex('by_source', q => q.eq('sourceId', sourceId)).unique();
  if (!row) await ctx.db.insert('campaignReadQueue', { sourceId, dueAt, attempts: 0 });
  else if (row.dueAt > dueAt) await ctx.db.patch(row._id, { dueAt });
}
/** The drain holding `token` may go on only while the reader is on, not halted, and the token is still the claim. */
function holds(state: Doc<'campaignReader'>, token: string, now: number) {
  return readerEnabled() && state.drainToken === token && !(state.haltedUntil && state.haltedUntil > now);
}
async function halt(ctx: MutationCtx, state: Doc<'campaignReader'>, now: number, why: string, reason: string) {
  console.error(`[campaigns] Reader stopped after ${why} (last: ${reason}). It stays stopped for ${HALT_MS / 3_600_000} hours.`);
  await ctx.db.patch(state._id, { consecutiveFailures: 0, unreadablePages: 0, haltedUntil: now + HALT_MS, haltReason: reason.slice(0, 300), drainToken: undefined, drainUntil: undefined, backoffUntil: undefined });
  return false;
}
/** Counts a failure; after too many in a row the run stops and stays stopped for HALT_MS. */
async function failed(ctx: MutationCtx, state: Doc<'campaignReader'>, now: number, reason: string, backoffMs?: number) {
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return halt(ctx, state, now, `${consecutiveFailures} failures in a row`, reason);
  await ctx.db.patch(state._id, { consecutiveFailures, ...(backoffMs === undefined ? {} : { backoffUntil: now + backoffMs }) });
  return true;
}
/**
 * Counts a page the site served but the parser could not understand, or whose reading could not be stored. A few of these among pages that read well
 * are odd pages, noted and passed over; the run stops only when they outnumber the good pages by
 * MAX_UNREADABLE_PAGES, which is what a block page or a changed page format looks like.
 */
async function unreadable(ctx: MutationCtx, state: Doc<'campaignReader'>, now: number, reason: string) {
  const unreadablePages = (state.unreadablePages ?? 0) + 1;
  if (unreadablePages >= MAX_UNREADABLE_PAGES) return halt(ctx, state, now, `${unreadablePages} more unreadable pages than readable ones`, reason);
  // The run of request failures is left as it is: a block that mixes refusals with unreadable pages must still stop the run.
  await ctx.db.patch(state._id, { unreadablePages });
  return true;
}
/** A campaign read and stored: the run of failures is over, and one unreadable page is forgiven. */
const readWell = (state: Doc<'campaignReader'>, now: number) => ({ consecutiveFailures: 0, unreadablePages: Math.max(0, (state.unreadablePages ?? 0) - 1), backoffUntil: undefined, lastReadAt: now });
const backoffFor = (failures: number, retryAfterMs?: number) => Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, retryAfterMs ?? MIN_BACKOFF_MS * 2 ** failures));

/** Hourly cron. Off: says so and stops. On: queues the hourly set, lets the daily sitemap read fall due, starts a drain. */
export const tick = internalMutation({ args: {}, returns: v.union(v.literal('off'), v.literal('halted'), v.literal('running')), handler: async ctx => {
  if (!readerEnabled()) { console.log(READER_OFF); return 'off' as const; }
  const now = Date.now();
  const state = await readerState(ctx);
  if (state.haltedUntil && state.haltedUntil > now) {
    console.warn(`[campaigns] Reader is stopped until ${new Date(state.haltedUntil).toISOString()} after repeated failures (${state.haltReason ?? 'unknown'}).`);
    return 'halted' as const;
  }
  for (const old of await ctx.db.query('campaignReadFailures').withIndex('by_at', q => q.lt('at', now - FAILURE_KEEP_MS)).take(200)) await ctx.db.delete(old._id);
  // Hourly: hot campaigns, and campaigns in someone's My campaigns (saved, or with a project attached).
  const hot = await ctx.db.query('campaigns').withIndex('by_ended_hot', q => q.eq('ended', false).gte('hotScore', HOURLY_HOT_SCORE)).order('desc').take(HOURLY_HOT_LIMIT);
  const watched = new Set<Doc<'campaigns'>['_id']>();
  for (const row of await ctx.db.query('savedCampaigns').take(2000)) watched.add(row.campaignId);
  for (const row of await ctx.db.query('projectCampaigns').take(2000)) if (row.campaignId) watched.add(row.campaignId);
  const hourly = new Map(hot.map(campaign => [campaign._id, campaign.sourceId]));
  for (const campaignId of [...watched].slice(0, HOURLY_WATCHED_LIMIT)) {
    if (hourly.has(campaignId)) continue;
    const campaign = await ctx.db.get(campaignId);
    if (campaign && !campaign.ended) hourly.set(campaignId, campaign.sourceId);
  }
  for (const sourceId of hourly.values()) await enqueue(ctx, sourceId, now);
  if (!state.drainToken || !state.drainUntil || state.drainUntil < now) {
    const drainToken = crypto.randomUUID();
    await ctx.db.patch(state._id, { drainToken, drainUntil: now + DRAIN_LEASE_MS, haltedUntil: undefined, haltReason: undefined });
    await ctx.scheduler.runAfter(0, internal.campaignsReaderActions.drain, { token: drainToken });
  }
  return 'running' as const;
} });

/**
 * Hands the drain its next piece of work: the sitemap when it is due, otherwise up to `limit` pages.
 * null ends the drain. `retryInMs` asks it to come back later (a backoff, or a page waiting for another try).
 */
export const claim = internalMutation({ args: { token: v.string(), limit: v.number() },
  returns: v.union(v.null(), v.object({ lastRequestAt: v.number(), sitemap: v.boolean(), sourceIds: v.array(v.string()), retryInMs: v.optional(v.number()) })),
  handler: async (ctx, { token, limit }): Promise<null | { lastRequestAt: number; sitemap: boolean; sourceIds: string[]; retryInMs?: number }> => {
    const now = Date.now();
    const state = await readerState(ctx);
    if (!holds(state, token, now)) return null;
    const lastRequestAt = state.lastRequestAt ?? 0;
    const later = async (retryInMs: number) => {
      await ctx.db.patch(state._id, { drainUntil: now + retryInMs + DRAIN_LEASE_MS });
      return { lastRequestAt, sitemap: false, sourceIds: [], retryInMs };
    };
    if (state.backoffUntil && state.backoffUntil > now) return later(state.backoffUntil - now);
    await ctx.db.patch(state._id, { drainUntil: now + DRAIN_LEASE_MS });
    if (now >= (state.sitemapDueAt ?? 0)) return { lastRequestAt, sitemap: true, sourceIds: [] };
    const due = await ctx.db.query('campaignReadQueue').withIndex('by_due', q => q.lte('dueAt', now)).take(Math.max(1, Math.min(limit, 20)));
    if (due.length) return { lastRequestAt, sitemap: false, sourceIds: due.map(row => row.sourceId) };
    const next = await ctx.db.query('campaignReadQueue').withIndex('by_due').first();
    if (next && next.dueAt - now < 50 * 60_000) return later(next.dueAt - now);
    // Nothing left this hour: give the claim back; the next tick starts a new drain.
    await ctx.db.patch(state._id, { drainToken: undefined, drainUntil: undefined });
    return null;
  } });

/** Stores what one page request returned. `proceed: false` tells the drain to stop asking for now. */
export const record = internalMutation({ args: { token: v.string(), sourceId: v.string(), requestedAt: v.number(), outcome: readOutcome }, returns: v.object({ proceed: v.boolean() }),
  handler: async (ctx, { token, sourceId, requestedAt, outcome }) => {
    const now = Date.now();
    const state = await readerState(ctx);
    if (state.drainToken !== token) return { proceed: false };
    await ctx.db.patch(state._id, { lastRequestAt: Math.max(requestedAt, state.lastRequestAt ?? 0) });
    const queued = await ctx.db.query('campaignReadQueue').withIndex('by_source', q => q.eq('sourceId', sourceId)).unique();
    const done = async () => { if (queued) await ctx.db.delete(queued._id); };
    const note = (kind: Doc<'campaignReadFailures'>['kind'], reason: string, status?: number) => ctx.db.insert('campaignReadFailures', { sourceId, kind, reason: reason.slice(0, 300), at: now, ...(status === undefined ? {} : { status }) });
    if (outcome.kind === 'campaign') {
      // The record is validated whole before this runs and written in this one transaction: never half a record.
      await upsertCampaign(ctx, outcome.campaign, now);
      await done();
      await ctx.db.patch(state._id, readWell(state, now));
      return { proceed: true };
    }
    if (outcome.kind === 'no_data') {
      const campaign = await ctx.db.query('campaigns').withIndex('by_source', q => q.eq('sourceId', sourceId)).unique();
      if (campaign) await endCampaign(ctx, campaign, 'no_data', now);
      await note('no_data', outcome.reason);
      await done();
      await ctx.db.patch(state._id, { consecutiveFailures: 0, backoffUntil: undefined, lastReadAt: now });
      return { proceed: true };
    }
    if (outcome.kind === 'retry') {
      const attempts = (queued?.attempts ?? 0) + 1;
      const wait = backoffFor(state.consecutiveFailures, outcome.retryAfterMs);
      if (attempts >= MAX_PAGE_ATTEMPTS) { await note('retry', `gave up after ${attempts} tries: ${outcome.reason}`, outcome.status); await done(); }
      else if (queued) await ctx.db.patch(queued._id, { attempts, dueAt: now + wait });
      await failed(ctx, state, now, outcome.reason, wait);
      return { proceed: false };
    }
    // An unreadable page or an unexpected HTTP status: the stored campaign, if any, is left exactly as it was.
    // The page leaves the queue and is next read with the daily sitemap, like any campaign that is not hot.
    await note(outcome.kind, outcome.reason, outcome.kind === 'http' ? outcome.status : undefined);
    await done();
    return { proceed: await (outcome.kind === 'parse' ? unreadable : failed)(ctx, state, now, `${sourceId}: ${outcome.reason}`) };
  } });

/** Takes a page whose reading could not be stored off the queue, so it cannot stall the pages behind it. Counted like an unreadable page. */
export const skip = internalMutation({ args: { token: v.string(), sourceId: v.string(), requestedAt: v.number(), reason: v.string() }, returns: v.object({ proceed: v.boolean() }),
  handler: async (ctx, { token, sourceId, requestedAt, reason }) => {
    const now = Date.now();
    const state = await readerState(ctx);
    if (state.drainToken !== token) return { proceed: false };
    await ctx.db.patch(state._id, { lastRequestAt: Math.max(requestedAt, state.lastRequestAt ?? 0) });
    for (const row of await ctx.db.query('campaignReadQueue').withIndex('by_source', q => q.eq('sourceId', sourceId)).take(10)) await ctx.db.delete(row._id);
    await ctx.db.insert('campaignReadFailures', { sourceId, kind: 'parse', reason: `not stored: ${reason}`.slice(0, 300), at: now });
    return { proceed: await unreadable(ctx, state, now, `${sourceId}: not stored`) };
  } });

/** The sitemap could not be read or looked wrong. Nothing is marked ended; it is tried again in a few hours. */
export const sitemapFailed = internalMutation({ args: { token: v.string(), requestedAt: v.number(), reason: v.string(), status: v.optional(v.number()), retryAfterMs: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, { token, requestedAt, reason, status, retryAfterMs }) => {
    const now = Date.now();
    const state = await readerState(ctx);
    if (state.drainToken !== token) return null;
    await ctx.db.patch(state._id, { lastRequestAt: Math.max(requestedAt, state.lastRequestAt ?? 0), sitemapDueAt: now + SITEMAP_RETRY_MS });
    await ctx.db.insert('campaignReadFailures', { sourceId: 'sitemap', kind: 'sitemap', reason: reason.slice(0, 300), at: now, ...(status === undefined ? {} : { status }) });
    await failed(ctx, state, now, `sitemap: ${reason}`, retryAfterMs === undefined ? undefined : backoffFor(state.consecutiveFailures, retryAfterMs));
    return null;
  } });

/** Queues one slice of the sitemap's campaigns for today's read and stamps the stored ones as still listed. */
export const sitemapApply = internalMutation({ args: { token: v.string(), sweepAt: v.number(), sourceIds: v.array(v.string()) }, returns: v.boolean(),
  handler: async (ctx, { token, sweepAt, sourceIds }) => {
    const state = await readerState(ctx);
    if (!holds(state, token, Date.now())) return false;
    for (const sourceId of sourceIds) {
      if (!isSourceId(sourceId)) continue;
      const campaign = await ctx.db.query('campaigns').withIndex('by_source', q => q.eq('sourceId', sourceId)).unique();
      if (campaign) await ctx.db.patch(campaign._id, { sitemapSeenAt: sweepAt });
      await enqueue(ctx, sourceId, sweepAt);
    }
    await ctx.db.patch(state._id, { drainUntil: Date.now() + DRAIN_LEASE_MS });
    return true;
  } });

/** Closes a sitemap read: campaigns it no longer lists are marked ended, unless the list shrank suspiciously. */
export const sitemapFinish = internalMutation({ args: { token: v.string(), requestedAt: v.number(), sweepAt: v.number(), count: v.number() }, returns: v.null(),
  handler: async (ctx, { token, requestedAt, sweepAt, count }) => {
    const state = await readerState(ctx);
    if (state.drainToken !== token) return null;
    const shrank = state.lastSitemapCount !== undefined && count < state.lastSitemapCount / 2;
    await ctx.db.patch(state._id, { lastRequestAt: Math.max(requestedAt, state.lastRequestAt ?? 0), lastSitemapAt: sweepAt, sitemapDueAt: sweepAt + SITEMAP_EVERY_MS, consecutiveFailures: 0, ...(shrank ? {} : { lastSitemapCount: count }) });
    if (shrank) {
      await ctx.db.insert('campaignReadFailures', { sourceId: 'sitemap', kind: 'sitemap', reason: `sitemap lists ${count} campaigns, under half of the ${state.lastSitemapCount} before: none marked ended`, at: sweepAt });
      console.warn(`[campaigns] Sitemap lists ${count} campaigns, under half of the ${state.lastSitemapCount} before. No campaign was marked ended.`);
    } else await ctx.scheduler.runAfter(0, internal.campaignsReader.endMissing, { sweepAt });
    return null;
  } });

/** Marks campaigns the sitemap stopped listing as ended, a page at a time. They stay stored. */
export const endMissing = internalMutation({ args: { sweepAt: v.number() }, returns: v.null(), handler: async (ctx, { sweepAt }) => {
  const missing = await ctx.db.query('campaigns').withIndex('by_ended_sitemap', q => q.eq('ended', false).lt('sitemapSeenAt', sweepAt)).take(100);
  for (const campaign of missing) await endCampaign(ctx, campaign, 'missing_from_sitemap', sweepAt);
  if (missing.length === 100) await ctx.scheduler.runAfter(0, internal.campaignsReader.endMissing, { sweepAt });
  return null;
} });

/** Stores one already-parsed record: for loading campaigns from saved pages without touching the live site. */
export const store = internalMutation({ args: { campaign: parsedCampaignValidator }, returns: v.id('campaigns'), handler: async (ctx, { campaign }) => {
  if (!isSourceId(campaign.sourceId)) throw new Error('Not a campaign id');
  return upsertCampaign(ctx, campaign, Date.now());
} });

/**
 * For an operator, after the cause of a stop is fixed: lifts the stop and puts back on the queue the pages that
 * could not be understood or stored in the last `hours` (24 by default; the newest 4,000 notes are looked at)
 * and have no stored campaign. `requeued` counts those pages, including any already waiting on the queue.
 * Makes no request itself; the next hourly tick starts the drain.
 */
export const resume = internalMutation({ args: { hours: v.optional(v.number()) }, returns: v.object({ requeued: v.number() }), handler: async (ctx, { hours }) => {
  const now = Date.now();
  const state = await readerState(ctx);
  await ctx.db.patch(state._id, { haltedUntil: undefined, haltReason: undefined, consecutiveFailures: 0, unreadablePages: 0, backoffUntil: undefined });
  const since = now - Math.min(Math.max(hours ?? 24, 0), FAILURE_KEEP_MS / 3_600_000) * 3_600_000;
  const sourceIds = new Set<string>();
  for (const failure of await ctx.db.query('campaignReadFailures').withIndex('by_at', q => q.gte('at', since)).order('desc').take(4000)) {
    if (failure.kind === 'parse' && isSourceId(failure.sourceId)) sourceIds.add(failure.sourceId);
  }
  let requeued = 0;
  for (const sourceId of sourceIds) {
    if (await ctx.db.query('campaigns').withIndex('by_source', q => q.eq('sourceId', sourceId)).unique()) continue;
    await enqueue(ctx, sourceId, now);
    requeued++;
  }
  return { requeued };
} });

/** What the reader is doing, for an operator. */
export const status = internalQuery({ args: {}, returns: v.any(), handler: async ctx => {
  const state = await ctx.db.query('campaignReader').withIndex('by_name', q => q.eq('name', 'reader')).unique();
  const queued = await ctx.db.query('campaignReadQueue').take(1000);
  const failures = await ctx.db.query('campaignReadFailures').withIndex('by_at').order('desc').take(10);
  return { enabled: readerEnabled(), state, queued: queued.length, recentFailures: failures.map(({ sourceId, kind, reason, status: code, at }) => ({ sourceId, kind, reason, status: code, at })) };
} });
