// How campaign facts read on the dashboard: money, relative time, "NEW".
import type { CampaignView } from '@/convex/campaignsModel';

/** "$2.00" for rates and payouts; "$31,049" (whole dollars) for budgets and earnings. */
export function money(cents: number, { whole = false }: { whole?: boolean } = {}) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}
export const count = (value: number) => value.toLocaleString('en-US');

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** "just now", "5 min ago", "3 hours ago", "3 days ago", "2 months ago". */
export function timeAgo(at: number, now: number) {
  const elapsed = Math.max(0, now - at);
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 || name === 'min' ? '' : 's'} ago`;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return unit(Math.floor(elapsed / MINUTE), 'min');
  if (elapsed < DAY) return unit(Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 30 * DAY) return unit(Math.floor(elapsed / DAY), 'day');
  if (elapsed < 365 * DAY) return unit(Math.floor(elapsed / (30 * DAY)), 'month');
  return unit(Math.floor(elapsed / (365 * DAY)), 'year');
}

/** New: the campaign itself launched within the last 5 days. When Revline first read it does not count, and a campaign that states no launch date is never new. */
export function isNewCampaign(campaign: Pick<CampaignView, 'launchedAt' | 'sourceCreatedAt'>, now: number) {
  const launched = campaign.launchedAt ?? campaign.sourceCreatedAt;
  return launched !== undefined && now - launched < 5 * DAY;
}

/** Share of the stated budget already spent, 0–100, or null when the campaign states no budget. */
export function budgetSpentPercent(campaign: Pick<CampaignView, 'budgetCents' | 'budgetLeftCents'>) {
  if (!campaign.budgetCents || campaign.budgetLeftCents === undefined) return null;
  return Math.min(100, Math.max(0, (1 - campaign.budgetLeftCents / campaign.budgetCents) * 100));
}
