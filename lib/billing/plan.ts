/** Revline's three web plans. Stripe prices are found by `lookupKey` (or the matching STRIPE_<TIER>_PRICE_ID
 *  override), and checkout refuses a price whose amount differs from `monthlyPrice`. */
export const PLAN_TIERS = ['starter', 'pro', 'studio'] as const;
export type PlanTier = typeof PLAN_TIERS[number];

type Plan = { name: string; tagline: string; monthlyPrice: number; currency: 'USD'; lookupKey: string; trialDays: number; featured?: boolean; lead?: string; features: readonly string[] };

/** How many social accounts each plan may connect per platform (lib/posting/account-caps.ts enforces it). */
export const POSTING_ACCOUNTS: Record<PlanTier, number> = { starter: 1, pro: 3, studio: 5 };

/** Decimal gigabytes, as the Library meter shows sizes. */
export const GB = 1_000_000_000;
/**
 * What each plan may use. The one place to change the numbers; the server enforces them
 * (convex/lib/plan_limits.ts) and the cards and meters read them.
 * - storageBytes: Library and project media an account may hold. A new upload or import that would pass it is
 *   refused with `storage_full`; files already stored are never removed.
 * - aiMonthlyUsd / aiDailyUsd: model cost an account may spend per Stripe billing period and per UTC day (null: no
 *   daily cap). Internal only: people see a percentage, never dollars. At the limit new assistant turns and MCP model
 *   tools are refused with `usage_limit`.
 */
export const PLAN_LIMITS: Record<PlanTier, { storageBytes: number; aiMonthlyUsd: number; aiDailyUsd: number | null }> = {
  starter: { storageBytes: 10 * GB, aiMonthlyUsd: 5, aiDailyUsd: 1 },
  pro: { storageBytes: 50 * GB, aiMonthlyUsd: 15, aiDailyUsd: 2.5 },
  studio: { storageBytes: 500 * GB, aiMonthlyUsd: 40, aiDailyUsd: null },
};
/** Share of the monthly AI usage at which the editor starts warning. */
export const AI_USAGE_WARNING = 0.8;
const storageLine = (tier: PlanTier) => `${PLAN_LIMITS[tier].storageBytes / GB} GB storage`;
/** "3× Starter's AI usage": plans compare their allowance without naming its cost. */
const aiUsageLine = (tier: PlanTier) => `${Math.round(PLAN_LIMITS[tier].aiMonthlyUsd / PLAN_LIMITS.starter.aiMonthlyUsd)}× the AI usage of Starter`;

export const PLANS: Record<PlanTier, Plan> = {
  starter: {
    name: 'Starter', tagline: 'For your first clips and reels.', monthlyPrice: 15, currency: 'USD', lookupKey: 'revline_starter_monthly', trialDays: 0,
    features: [
      'Edit by prompting: cuts, captions and effects',
      'Animated subtitles and text effects',
      'Export in 9:16, 1:1 and 16:9',
      '1080p export, no watermark',
      `Post to ${POSTING_ACCOUNTS.starter} account per platform`,
      'Monthly AI usage included',
      storageLine('starter'),
    ],
  },
  pro: {
    name: 'Pro', tagline: 'For creators editing every week.', monthlyPrice: 39, currency: 'USD', lookupKey: 'revline_pro_monthly', trialDays: 3, featured: true,
    lead: 'Everything in Starter, plus',
    features: [
      'Edit from Claude, Codex or Cursor with MCP',
      `Post to ${POSTING_ACCOUNTS.pro} accounts per platform`,
      aiUsageLine('pro'),
      storageLine('pro'),
    ],
  },
  studio: {
    name: 'Studio', tagline: 'For channels publishing every day.', monthlyPrice: 99, currency: 'USD', lookupKey: 'revline_studio_monthly', trialDays: 0,
    lead: 'Everything in Pro, plus',
    features: [
      'Pick the model for every edit',
      'Pick the reasoning effort for every edit',
      '4K export',
      'Faster, parallel exports',
      `Post to ${POSTING_ACCOUNTS.studio} accounts per platform`,
      aiUsageLine('studio'),
      storageLine('studio'),
    ],
  },
};

/** The plan a Stripe price's lookup key belongs to, if any. */
export const tierForLookupKey = (lookupKey: string | null | undefined): PlanTier | undefined => PLAN_TIERS.find(tier => PLANS[tier].lookupKey === lookupKey);

/** Ranks plans for upgrade and downgrade wording. */
export const PLAN_RANK: Record<PlanTier, number> = { starter: 0, pro: 1, studio: 2 };

