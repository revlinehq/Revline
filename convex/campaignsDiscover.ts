// The Discover sections: what Content Rewards features on its own Discover page, read once an hour by the
// campaign reader's drain (convex/campaignsReaderActions.ts) and shown at the top of the Campaigns page.
// A failed read is noted here and nowhere else: it never counts against the campaign reads or delays them.
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, query, type MutationCtx } from './_generated/server';
import { requireOwner } from './lib/auth';
import { campaignView, viewOf } from './campaignsModel';
import { discoverReading } from './campaignsDiscoverModel';
import { enqueue, readerState } from './campaignsReader';
import { upsertCampaign } from './campaignsStore';
import { DISCOVER_EVERY_MS } from '../lib/campaigns/discover';
import { readerEnabled } from '../lib/campaigns/reader-config';
import { recordFingerprint } from '../lib/campaigns/score';
import { isSourceId } from '../lib/campaigns/source';

async function discoverState(ctx: MutationCtx): Promise<Doc<'campaignDiscover'>> {
  const state = await ctx.db.query('campaignDiscover').withIndex('by_name', q => q.eq('name', 'discover')).unique();
  return state ?? (await ctx.db.get(await ctx.db.insert('campaignDiscover', { name: 'discover' })))!;
}

/**
 * Asked by a drain the reader has just cleared to make requests (on, not halted, not backing off).
 * True when the hourly Discover read is due; the next one is then not due for another hour, whatever this one returns.
 */
export const claim = internalMutation({ args: { token: v.string() }, returns: v.boolean(), handler: async (ctx, { token }) => {
  const now = Date.now();
  if (!readerEnabled() || (await readerState(ctx)).drainToken !== token) return false;
  const state = await discoverState(ctx);
  if (state.dueAt && state.dueAt > now) return false;
  await ctx.db.patch(state._id, { dueAt: now + DISCOVER_EVERY_MS });
  return true;
} });

/**
 * Stores one read of the Discover page. Also loads sections from a saved page without touching the live site
 * (leave `requestedAt` out). A failed read changes nothing but the note of the failure.
 */
export const record = internalMutation({ args: { requestedAt: v.optional(v.number()), reading: discoverReading }, returns: v.null(), handler: async (ctx, { requestedAt, reading }) => {
  const now = Date.now();
  if (requestedAt !== undefined) {
    // The request counts toward the reader's one-per-second pace.
    const reader = await readerState(ctx);
    await ctx.db.patch(reader._id, { lastRequestAt: Math.max(requestedAt, reader.lastRequestAt ?? 0) });
  }
  const state = await discoverState(ctx);
  if (reading.kind === 'failed') {
    console.warn(`[campaigns] Discover page not read: ${reading.reason}. The stored sections stay.`);
    await ctx.db.patch(state._id, { failedAt: now, failReason: reading.reason.slice(0, 300) });
    return null;
  }
  // A campaign we have not stored yet is stored now from the Discover page's own fields, so it shows at once
  // with a detail page, and its own page is queued once: the full record replaces the short one within the
  // same run. Until that happens (some pages cannot be read) each Discover read refreshes the short record.
  // A campaign stored from its own page is left exactly as that page stated it.
  const short = new Map((state.short ?? []).map(entry => [entry.campaignId, entry.recordHash]));
  const ids = new Map<string, Id<'campaigns'>>(), stillShort: { campaignId: Id<'campaigns'>; recordHash: string }[] = [];
  for (const campaign of reading.campaigns) {
    if (!isSourceId(campaign.sourceId)) continue;
    const stored = await ctx.db.query('campaigns').withIndex('by_source', q => q.eq('sourceId', campaign.sourceId)).unique();
    const ours = !stored || short.get(stored._id) === stored.recordHash;
    const campaignId = ours ? await upsertCampaign(ctx, campaign, now) : stored._id;
    if (ours) stillShort.push({ campaignId, recordHash: recordFingerprint(campaign) });
    if (!stored && readerEnabled()) await enqueue(ctx, campaign.sourceId, now);
    ids.set(campaign.sourceId, campaignId);
  }
  // A short record this read did not name (its section was not made out) is remembered for the next read.
  const seen = new Set(ids.values());
  const kept = [...stillShort, ...(state.short ?? []).filter(entry => !seen.has(entry.campaignId))].slice(0, 200);
  const mapped = <T extends { sourceId: string }>(list: T[] | undefined) => list?.flatMap(({ sourceId, ...rest }) => { const campaignId = ids.get(sourceId); return campaignId ? [{ campaignId, ...rest }] : []; });
  const { hero, trending, fresh, searched, clips } = reading.sections;
  const next = { hero: mapped(hero), trending: mapped(trending), fresh: mapped(fresh), searched: mapped(searched), clips: mapped(clips) };
  // Only the sections this read made out are replaced.
  await ctx.db.patch(state._id, { ...Object.fromEntries(Object.entries(next).filter(([, list]) => list)), short: kept, readAt: now });
  if (reading.problems.length) console.warn(`[campaigns] Discover page read in part: ${reading.problems.join('; ')}.`);
  return null;
} });

const clipView = v.object({
  postUrl: v.string(), platform: v.string(), views: v.number(), title: v.optional(v.string()), thumbnailUrl: v.optional(v.string()),
  campaign: v.optional(v.object({ _id: v.id('campaigns'), name: v.string() })),
});
/**
 * The Discover sections for the Campaigns page, each in the order Content Rewards lists it. Shared data: any
 * signed-in user may read it. `readAt` is null, and every list empty, until the page has been read once.
 */
export const sections = query({ args: {},
  returns: v.object({
    readAt: v.union(v.number(), v.null()),
    hero: v.array(v.object({ campaign: campaignView, category: v.optional(v.string()) })),
    trending: v.array(campaignView), fresh: v.array(campaignView), searched: v.array(campaignView),
    clips: v.array(clipView),
  }),
  handler: async ctx => {
    await requireOwner(ctx);
    const state = await ctx.db.query('campaignDiscover').withIndex('by_name', q => q.eq('name', 'discover')).unique();
    const cache = new Map<Id<'campaigns'>, Promise<Doc<'campaigns'> | null>>();
    const campaign = (id: Id<'campaigns'>) => cache.get(id) ?? cache.set(id, ctx.db.get(id)).get(id)!;
    // A campaign that has ended since the page was read is no longer featured.
    const views = async (list: { campaignId: Id<'campaigns'> }[] | undefined) => (await Promise.all((list ?? []).map(entry => campaign(entry.campaignId)))).flatMap(row => row && !row.ended ? [viewOf(row)] : []);
    return {
      readAt: state?.readAt ?? null,
      hero: (await Promise.all((state?.hero ?? []).map(async ({ campaignId, category }) => { const row = await campaign(campaignId); return row && !row.ended ? [{ campaign: viewOf(row), ...(category ? { category } : {}) }] : []; }))).flat(),
      trending: await views(state?.trending), fresh: await views(state?.fresh), searched: await views(state?.searched),
      clips: await Promise.all((state?.clips ?? []).map(async ({ campaignId, ...clip }) => { const row = await campaign(campaignId); return { ...clip, ...(row ? { campaign: { _id: row._id, name: row.name } } : {}) }; })),
    };
  } });
