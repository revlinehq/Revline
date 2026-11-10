// The one place a campaign record is written.
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { CAMPAIGN_SOURCE, campaignUrl, type ParsedCampaign } from '../lib/campaigns/source';
import { budgetLeftCents, fingerprint, hasBudgetLeft, hotScore, maxRateCents, recordFingerprint, searchText, sourceEnded } from '../lib/campaigns/score';

async function syncName(ctx: MutationCtx, campaign: Doc<'campaigns'>) {
  const row = await ctx.db.query('campaignNames').withIndex('by_campaign', q => q.eq('campaignId', campaign._id)).unique();
  if (campaign.ended) { if (row) await ctx.db.delete(row._id); return; }
  const next = { campaignId: campaign._id, sourceId: campaign.sourceId, name: campaign.name, ...(campaign.organization ? { organization: campaign.organization.name } : {}) };
  if (!row) await ctx.db.insert('campaignNames', next);
  else if (row.name !== next.name || row.organization !== next.organization) await ctx.db.replace(row._id, next);
}
async function syncFacets(ctx: MutationCtx, campaign: ParsedCampaign) {
  const facets = [
    ...campaign.contentTypes.map(type => ({ kind: 'contentType' as const, key: type.id, name: type.name })),
    ...campaign.contentCategories.map(category => ({ kind: 'category' as const, key: category.id, name: category.name })),
    ...campaign.payouts.map(entry => ({ kind: 'platform' as const, key: entry.platform, name: entry.platform })),
  ];
  for (const facet of facets) {
    const row = await ctx.db.query('campaignFacets').withIndex('by_kind_key', q => q.eq('kind', facet.kind).eq('key', facet.key)).unique();
    if (!row) await ctx.db.insert('campaignFacets', facet);
    else if (row.name !== facet.name) await ctx.db.patch(row._id, { name: facet.name });
  }
}

/**
 * Stores what a page states, whole. Inserts a new campaign or replaces the stored facts of a known one,
 * recomputes the hot score, and asks for a new embedding only when the searchable text changed.
 */
export async function upsertCampaign(ctx: MutationCtx, parsed: ParsedCampaign, now: number) {
  const existing = await ctx.db.query('campaigns').withIndex('by_source', q => q.eq('sourceId', parsed.sourceId)).unique();
  const ended = sourceEnded(parsed.status);
  const recordHash = recordFingerprint(parsed);
  const text = searchText(parsed);
  const left = budgetLeftCents(parsed);
  const firstSeenAt = existing?.firstSeenAt ?? now;
  const next = {
    ...parsed, source: CAMPAIGN_SOURCE as typeof CAMPAIGN_SOURCE, url: campaignUrl(parsed.sourceId),
    ended, ...(ended ? { endedReason: 'source_status' as const, endedAt: existing?.ended && existing.endedAt ? existing.endedAt : now } : {}),
    platforms: parsed.payouts.map(entry => entry.platform), maxRateCents: maxRateCents(parsed), ...(left === undefined ? {} : { budgetLeftCents: left }), hasBudgetLeft: hasBudgetLeft(parsed),
    hotScore: hotScore(parsed, ended, now, firstSeenAt),
    searchText: text, recordHash,
    firstSeenAt, lastSeenAt: now, lastChangedAt: existing && existing.recordHash === recordHash && existing.ended === ended ? existing.lastChangedAt : now,
    // A campaign first stored now counts as listed now, so the sweep that queued it cannot mark it missing.
    sitemapSeenAt: existing?.sitemapSeenAt ?? now,
  };
  const campaignId = existing ? existing._id : await ctx.db.insert('campaigns', next);
  // replace, not patch: a field the page no longer states must not linger from an older reading.
  if (existing) await ctx.db.replace(existing._id, next);
  await syncName(ctx, (await ctx.db.get(campaignId))!);
  await syncFacets(ctx, parsed);
  const embedding = await ctx.db.query('campaignEmbeddings').withIndex('by_campaign', q => q.eq('campaignId', campaignId)).unique();
  if (embedding?.textHash !== fingerprint(text)) await ctx.scheduler.runAfter(0, internal.campaignsSearch.embed, { campaignId });
  return campaignId;
}

/** Marks a campaign that left the sitemap or whose page returned no data as ended. It stays stored. */
export async function endCampaign(ctx: MutationCtx, campaign: Doc<'campaigns'>, reason: 'missing_from_sitemap' | 'no_data', now: number) {
  if (campaign.ended) return;
  await ctx.db.patch(campaign._id, { ended: true, endedReason: reason, endedAt: now, hotScore: 0, lastChangedAt: now });
  await syncName(ctx, { ...campaign, ended: true });
}
