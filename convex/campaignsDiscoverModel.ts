// The Discover sections as stored: ordered lists of our campaign ids, and the top clips, with when they were read.
import { defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import { parsedCampaignValidator } from './campaignsModel';
import type { DiscoverReading } from '../lib/campaigns/discover';

const sourceItem = v.object({ sourceId: v.string(), category: v.optional(v.string()) });
const clipFields = { postUrl: v.string(), platform: v.string(), views: v.number(), title: v.optional(v.string()), thumbnailUrl: v.optional(v.string()) };
/** What one read of the Discover page returned (lib/campaigns/discover.ts `DiscoverReading`). */
export const discoverReading = v.union(
  v.object({
    kind: v.literal('sections'),
    sections: v.object({
      hero: v.optional(v.array(sourceItem)), trending: v.optional(v.array(sourceItem)), fresh: v.optional(v.array(sourceItem)), searched: v.optional(v.array(sourceItem)),
      clips: v.optional(v.array(v.object({ sourceId: v.string(), ...clipFields }))),
    }),
    campaigns: v.array(parsedCampaignValidator),
    problems: v.array(v.string()),
  }),
  /** The page could not be fetched or understood. The stored sections stay as they are. */
  v.object({ kind: v.literal('failed'), reason: v.string() }),
);
// Compile-time proof that what the parser returns can be stored.
const parsedShape: Infer<typeof discoverReading> = null as unknown as Extract<DiscoverReading, { kind: 'sections' }>;
void parsedShape;

const item = v.object({ campaignId: v.id('campaigns'), category: v.optional(v.string()) });
export const campaignDiscoverTables = {
  // One row: the Discover page's sections as last read. A section a read could not make out keeps its last list.
  campaignDiscover: defineTable({
    name: v.literal('discover'),
    hero: v.optional(v.array(item)), trending: v.optional(v.array(item)), fresh: v.optional(v.array(item)), searched: v.optional(v.array(item)),
    clips: v.optional(v.array(v.object({ campaignId: v.id('campaigns'), ...clipFields }))),
    /** Campaigns stored from the Discover page's own fields, with the fingerprint written, until their own page is read. */
    short: v.optional(v.array(v.object({ campaignId: v.id('campaigns'), recordHash: v.string() }))),
    /** When the page was last read and stored. */
    readAt: v.optional(v.number()),
    /** When the next read may be made. */
    dueAt: v.optional(v.number()),
    failedAt: v.optional(v.number()), failReason: v.optional(v.string()),
  }).index('by_name', ['name']),
};
