// How many social accounts one Revline user may connect per platform, by plan. The one place to change it.
// Post Bridge bills Revline for every connected account (15 on its $39 plan, 99 on its $99 plan, then $1 each),
// so the cap is enforced on the server (convex/postingBridge.ts) and applies to accounts connected through it.
export const ACCOUNT_CAPS = {
  /** No active Revline plan: nothing can be exported or posted, so no account slot is spent. */
  none: 0,
  /** Pro, including its free trial and complimentary access. */
  paid: 3,
  ultra: 3,
} as const;
export type AccountPlan = keyof typeof ACCOUNT_CAPS;

/** What the user reads when a platform is at its cap. */
export function capMessage(platformName: string, cap: number) {
  return cap > 0
    ? `You have connected ${cap} of ${cap} ${platformName} accounts, the most your plan includes. Disconnect one to connect another.`
    : 'Connecting accounts is part of a Revline plan. Start your plan, then connect your accounts.';
}
