// What a stored Content Rewards campaign looks like. Revline no longer reads Content Rewards: nothing here or
// anywhere else makes a request to it. The stored campaigns, and the public functions over them, remain.

export const CAMPAIGN_SOURCE = 'contentrewards' as const;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Campaign ids named in free text (a pasted campaign link). */
export function campaignIdsInText(text: string): string[] {
  return [...new Set([...text.matchAll(new RegExp(`contentrewards\\.com/c/campaigns/(${UUID})`, 'gi'))].map(match => match[1].toLowerCase()))];
}

export type CampaignPayout = { platform: string; rateCents?: number; minPayoutCents?: number; maxPayoutCents?: number };
export type CampaignTag = { id: string; name: string };
/** What one public campaign page states. Money is in cents; `rateCents` is per 1,000 views. */
export type ParsedCampaign = {
  sourceId: string; name: string; status: string;
  organization?: { name: string; handle?: string; verified?: boolean; logoUrl?: string };
  description?: string; imageUrl?: string; payoutType?: string;
  budgetCents?: number; budgetSpentCents?: number; budgetProgressBps?: number;
  creatorCount?: number; totalViews?: number; approvedSubmissionCount?: number;
  payouts: CampaignPayout[]; contentTypes: CampaignTag[]; contentCategories: CampaignTag[];
  preApproval?: boolean; requiresApplication?: boolean;
  /** How many rules, creator requirements and references the brief holds. The brief itself is not public. */
  briefCounts?: { contentRules?: number; creatorRequirements?: number; references?: number };
  sourceCreatedAt?: number; launchedAt?: number; sourceUpdatedAt?: number;
};
/** Cuts text to a length without leaving half of a surrogate pair (an emoji) at the end. */
export function clip(value: string, max: number) {
  const cut = value.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

