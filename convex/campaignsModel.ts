// Campaign data: the tables and validators. Campaigns are shared and read-only to users; only the reader
// writes them, through convex/campaignsStore.ts.
import { defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { CAMPAIGN_SOURCE, type ParsedCampaign } from '../lib/campaigns/source';

/** A stored campaign's id. Posts and projects refer to a campaign by this. */
export type CampaignId = Id<'campaigns'>;
export const campaignIdValidator = v.id('campaigns');

const tag = v.object({ id: v.string(), name: v.string() });
const payout = v.object({ platform: v.string(), rateCents: v.optional(v.number()), minPayoutCents: v.optional(v.number()), maxPayoutCents: v.optional(v.number()) });
/** What one public campaign page states (lib/campaigns/source.ts `ParsedCampaign`). */
const parsedFields = {
  sourceId: v.string(), name: v.string(), status: v.string(),
  organization: v.optional(v.object({ name: v.string(), handle: v.optional(v.string()), verified: v.optional(v.boolean()), logoUrl: v.optional(v.string()) })),
  description: v.optional(v.string()), imageUrl: v.optional(v.string()), payoutType: v.optional(v.string()),
  budgetCents: v.optional(v.number()), budgetSpentCents: v.optional(v.number()), budgetProgressBps: v.optional(v.number()),
  creatorCount: v.optional(v.number()), totalViews: v.optional(v.number()), approvedSubmissionCount: v.optional(v.number()),
  payouts: v.array(payout), contentTypes: v.array(tag), contentCategories: v.array(tag),
  preApproval: v.optional(v.boolean()), requiresApplication: v.optional(v.boolean()),
  briefCounts: v.optional(v.object({ contentRules: v.optional(v.number()), creatorRequirements: v.optional(v.number()), references: v.optional(v.number()) })),
  sourceCreatedAt: v.optional(v.number()), launchedAt: v.optional(v.number()), sourceUpdatedAt: v.optional(v.number()),
};
export const parsedCampaignValidator = v.object(parsedFields);
// Compile-time proof that the parser's record and the stored fields are the same shape.
const parsedShape: ParsedCampaign = null as unknown as Infer<typeof parsedCampaignValidator>;
const storedShape: Infer<typeof parsedCampaignValidator> = null as unknown as ParsedCampaign;
void parsedShape; void storedShape;

const endedReason = v.union(v.literal('source_status'), v.literal('missing_from_sitemap'), v.literal('no_data'));
/** What Revline derives and tracks beside the page's own facts. */
const derivedFields = {
  source: v.literal(CAMPAIGN_SOURCE), url: v.string(),
  /** No longer takes clips: its own status says so, it left the sitemap, or its page returned no data. Never deleted. */
  ended: v.boolean(), endedReason: v.optional(endedReason), endedAt: v.optional(v.number()),
  platforms: v.array(v.string()), maxRateCents: v.number(), budgetLeftCents: v.optional(v.number()), hasBudgetLeft: v.boolean(),
  hotScore: v.number(),
  searchText: v.string(), recordHash: v.string(),
  firstSeenAt: v.number(), lastSeenAt: v.number(), lastChangedAt: v.number(),
  /** When the sitemap last listed it. */
  sitemapSeenAt: v.optional(v.number()),
};
const campaignFields = { ...parsedFields, ...derivedFields };

/** What users are shown of a campaign: everything but the bookkeeping. */
const { searchText: _searchText, recordHash: _recordHash, sitemapSeenAt: _sitemapSeenAt, ...viewFields } = campaignFields;
export const campaignView = v.object({ _id: v.id('campaigns'), ...viewFields });
export type CampaignView = Infer<typeof campaignView>;
export function viewOf(campaign: Doc<'campaigns'>): CampaignView {
  const { _creationTime, searchText: _text, recordHash: _hash, sitemapSeenAt: _seen, ...view } = campaign;
  return view;
}

export const EMBEDDING_DIMENSIONS = 1536;
export const readOutcome = v.union(
  v.object({ kind: v.literal('campaign'), campaign: parsedCampaignValidator }),
  v.object({ kind: v.literal('no_data'), reason: v.string() }),
  v.object({ kind: v.literal('parse'), reason: v.string() }),
  v.object({ kind: v.literal('http'), status: v.number(), reason: v.string() }),
  /** 429, 5xx or a network error: worth another try later. */
  v.object({ kind: v.literal('retry'), status: v.optional(v.number()), reason: v.string(), retryAfterMs: v.optional(v.number()) }),
);
export type ReadOutcome = Infer<typeof readOutcome>;

export const campaignTables = {
  campaigns: defineTable(campaignFields)
    .index('by_source', ['sourceId'])
    .index('by_ended_hot', ['ended', 'hotScore'])
    .index('by_ended_sitemap', ['ended', 'sitemapSeenAt'])
    .searchIndex('search_text', { searchField: 'searchText', filterFields: ['ended'] }),
  // Kept apart from the campaign so listing campaigns never reads 1,536 numbers each.
  campaignEmbeddings: defineTable({ campaignId: v.id('campaigns'), textHash: v.string(), embedding: v.array(v.float64()) })
    .index('by_campaign', ['campaignId'])
    .vectorIndex('by_embedding', { vectorField: 'embedding', dimensions: EMBEDDING_DIMENSIONS }),
  // Name and organization of every campaign still running: the small list project matching reads.
  campaignNames: defineTable({ campaignId: v.id('campaigns'), sourceId: v.string(), name: v.string(), organization: v.optional(v.string()) }).index('by_campaign', ['campaignId']),
  // The content types, categories and platforms seen in stored campaigns, for search filters.
  campaignFacets: defineTable({ kind: v.union(v.literal('contentType'), v.literal('category'), v.literal('platform')), key: v.string(), name: v.string() }).index('by_kind_key', ['kind', 'key']),
  // Pages waiting to be read, one row per campaign.
  campaignReadQueue: defineTable({ sourceId: v.string(), dueAt: v.number(), attempts: v.number() }).index('by_due', ['dueAt']).index('by_source', ['sourceId']),
  // Pages that could not be read or understood, with the reason. Pruned after 30 days.
  campaignReadFailures: defineTable({ sourceId: v.string(), kind: v.union(v.literal('parse'), v.literal('http'), v.literal('retry'), v.literal('no_data'), v.literal('sitemap')), status: v.optional(v.number()), reason: v.string(), at: v.number() }).index('by_at', ['at']).index('by_source', ['sourceId', 'at']),
  // One row: the reader's own state.
  campaignReader: defineTable({
    name: v.literal('reader'),
    lastSitemapAt: v.optional(v.number()), lastSitemapCount: v.optional(v.number()), sitemapDueAt: v.optional(v.number()),
    /** The single drain allowed to make requests, and until when its claim holds. */
    drainToken: v.optional(v.string()), drainUntil: v.optional(v.number()),
    lastRequestAt: v.optional(v.number()),
    consecutiveFailures: v.number(), backoffUntil: v.optional(v.number()),
    /** Pages the parser could not understand, less the pages read well since (reader-config MAX_UNREADABLE_PAGES). */
    unreadablePages: v.optional(v.number()),
    haltedUntil: v.optional(v.number()), haltReason: v.optional(v.string()),
    lastReadAt: v.optional(v.number()),
  }).index('by_name', ['name']),
  // A user's saved campaigns. Saving is Revline's own bookmark; it says nothing about joining on Content Rewards.
  savedCampaigns: defineTable({ ownerId: v.string(), campaignId: v.id('campaigns'), savedAt: v.number() }).index('by_owner', ['ownerId', 'savedAt']).index('by_owner_campaign', ['ownerId', 'campaignId']),
  // A project's optional campaign. Kept off the project document, which is large and read by the iOS app.
  // `declined` records that the user removed a campaign, so matching does not attach one again on its own.
  projectCampaigns: defineTable({ projectId: v.id('projects'), ownerId: v.string(), campaignId: v.optional(v.id('campaigns')), how: v.union(v.literal('matched'), v.literal('picked')), declined: v.optional(v.boolean()), updatedAt: v.number() }).index('by_project', ['projectId']).index('by_owner', ['ownerId', 'updatedAt']),
};

export const campaignFilters = {
  platform: v.optional(v.string()), contentType: v.optional(v.string()), category: v.optional(v.string()),
  /** Cents per 1,000 views on the chosen platform, or on any platform when none is chosen. */
  minRateCents: v.optional(v.number()),
  hasBudgetLeft: v.optional(v.boolean()),
  /** true: only campaigns that need an application; false: only those that do not. */
  requiresApplication: v.optional(v.boolean()),
};
const filtersObject = v.object(campaignFilters);
export function passesFilters(campaign: Doc<'campaigns'>, filters: Infer<typeof filtersObject>) {
  if (campaign.ended) return false;
  if (filters.platform && !campaign.platforms.includes(filters.platform)) return false;
  if (filters.contentType && !campaign.contentTypes.some(type => type.id === filters.contentType)) return false;
  if (filters.category && !campaign.contentCategories.some(category => category.id === filters.category)) return false;
  if (filters.minRateCents !== undefined) {
    const rate = filters.platform ? campaign.payouts.find(entry => entry.platform === filters.platform)?.rateCents ?? 0 : campaign.maxRateCents;
    if (rate < filters.minRateCents) return false;
  }
  if (filters.hasBudgetLeft !== undefined && campaign.hasBudgetLeft !== filters.hasBudgetLeft) return false;
  if (filters.requiresApplication !== undefined && (campaign.requiresApplication ?? false) !== filters.requiresApplication) return false;
  return true;
}
