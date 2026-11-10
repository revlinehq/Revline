// What Revline derives from a campaign record when it is stored: budget left, the hot score, the text that is
// embedded for search, and a fingerprint that tells whether anything changed.
import { clip, type ParsedCampaign } from './source';

/** Statuses Content Rewards uses for a campaign that no longer takes clips. */
const ENDED_STATUSES = new Set(['ended', 'completed', 'archived', 'closed', 'finished', 'cancelled', 'canceled', 'deleted']);
export const sourceEnded = (status: string) => ENDED_STATUSES.has(status);

/** Cents of budget not yet spent, when the page states a budget. */
export function budgetLeftCents(campaign: Pick<ParsedCampaign, 'budgetCents' | 'budgetSpentCents'>) {
  return campaign.budgetCents === undefined ? undefined : Math.max(0, campaign.budgetCents - (campaign.budgetSpentCents ?? 0));
}
/** False only when the page shows the budget is used up; a campaign that states no budget counts as having some. */
export function hasBudgetLeft(campaign: Pick<ParsedCampaign, 'budgetCents' | 'budgetSpentCents' | 'budgetProgressBps'>) {
  const left = budgetLeftCents(campaign);
  if (left !== undefined) return left > 0;
  return campaign.budgetProgressBps === undefined || campaign.budgetProgressBps < 10_000;
}
/** The best rate any platform pays, in cents per 1,000 views; 0 when the campaign states no rate. */
export const maxRateCents = (campaign: Pick<ParsedCampaign, 'payouts'>) => Math.max(0, ...campaign.payouts.map(payout => payout.rateCents ?? 0));

const DAY = 86_400_000;
/**
 * Hot score, 0–100, no AI:
 *   100 × budget × rate × room × fresh, where
 *   budget = log10(1 + dollars left) / 5, capped at 1 (0.5 when no budget is stated),
 *   rate   = 0.25 + 0.75 × min(1, best rate / $3 per 1,000 views),
 *   room   = 0.4 + 0.6 / (1 + creators joined / 50),
 *   fresh  = 0.3 + 0.7 × 0.5^(days since launch / 14).
 * 0 when the campaign is ended, not active, or has no budget left.
 */
export function hotScore(campaign: ParsedCampaign, ended: boolean, now: number, firstSeenAt = now) {
  if (ended || campaign.status !== 'active' || !hasBudgetLeft(campaign)) return 0;
  const left = budgetLeftCents(campaign);
  const budget = left === undefined ? 0.5 : Math.min(1, Math.log10(1 + left / 100) / 5);
  const rate = 0.25 + 0.75 * Math.min(1, maxRateCents(campaign) / 300);
  const room = 0.4 + 0.6 / (1 + (campaign.creatorCount ?? 0) / 50);
  const days = Math.max(0, now - (campaign.launchedAt ?? campaign.sourceCreatedAt ?? firstSeenAt)) / DAY;
  const fresh = 0.3 + 0.7 * 0.5 ** (days / 14);
  return Math.round(100 * budget * rate * room * fresh * 10) / 10;
}

/** The text search understands a campaign by: name, organization, description, types and categories. */
export function searchText(campaign: ParsedCampaign) {
  return clip([
    campaign.name,
    campaign.organization?.name,
    campaign.description,
    campaign.contentTypes.map(type => type.name).join(', '),
    campaign.contentCategories.map(category => category.name).join(', '),
  ].filter(Boolean).join('\n'), 7000);
}

/** A short, stable fingerprint of text (cyrb53). Not for security. */
export function fingerprint(text: string) {
  let high = 0xdeadbeef, low = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    high = Math.imul(high ^ code, 2654435761);
    low = Math.imul(low ^ code, 1597334677);
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
  return (4294967296 * (2097151 & low) + (high >>> 0)).toString(36);
}

/** Fingerprint of everything a record states, with keys in a fixed order. */
export function recordFingerprint(campaign: ParsedCampaign) {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([key, entry]) => [key, ordered(entry)]))
    : value;
  return fingerprint(JSON.stringify(ordered(campaign)));
}
