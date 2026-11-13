// How many social accounts one Revline user may connect, in total across every platform, by plan
// (POSTING_ACCOUNTS in lib/billing/plan.ts). Safe to import in the browser.
// Post Bridge bills Revline for every connected account (15 on its $39 plan, 99 on its $99 plan, then $1 each),
// so the limit is enforced on the server (convex/postingBridge.ts) when an account is connected. An owner above it
// after a downgrade keeps every account they have, connected and postable; only new connections are refused.
import { POSTING_ACCOUNTS, type PlanTier } from '../billing/plan';

/** How many accounts may be connected in total; null: no limit. */
export type AccountLimit = number | null;

/** The limit for a plan's limits tier (a free trial: its trial tier). No plan: nothing can be connected. */
export const accountLimitFor = (tier: PlanTier | null): AccountLimit => tier ? POSTING_ACCOUNTS[tier] : 0;
/** No new account can be connected. */
export const atLimit = (connected: number, limit: AccountLimit) => limit !== null && connected >= limit;

/** "1 of 2 connected", or "3 connected · Unlimited" without a limit. */
export const connectedCount = (connected: number, limit: AccountLimit) => limit === null ? `${connected} connected · Unlimited` : `${connected} of ${limit} connected`;

/** What the user reads when connecting another account is refused, at or above the limit. */
export function limitMessage(limit: AccountLimit) {
  return limit === 0
    ? 'Connecting and posting to accounts is part of a Revline plan. Start your plan to use them.'
    : `Your plan allows ${limit} connected ${limit === 1 ? 'account' : 'accounts'}. Disconnect one or upgrade.`;
}
