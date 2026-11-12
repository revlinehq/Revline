/** Revline's three web plans. Stripe prices are found by `lookupKey` (or the matching STRIPE_<TIER>_PRICE_ID
 *  override), and checkout refuses a price whose amount differs from `monthlyPrice`. */
export const PLAN_TIERS = ['starter', 'pro', 'studio'] as const;
export type PlanTier = typeof PLAN_TIERS[number];
export const isPlanTier = (value: unknown): value is PlanTier => PLAN_TIERS.includes(value as PlanTier);

type Plan = { name: string; tagline: string; monthlyPrice: number; currency: 'USD'; lookupKey: string; trialDays: number; featured?: boolean; lead?: string; features: readonly string[] };

/** How many social accounts each plan may connect per platform (lib/posting/account-caps.ts enforces it). */
export const POSTING_ACCOUNTS: Record<PlanTier, number> = { starter: 1, pro: 3, studio: 5 };

export const PLANS: Record<PlanTier, Plan> = {
  starter: {
    name: 'Starter', tagline: 'For your first clips and reels.', monthlyPrice: 15, currency: 'USD', lookupKey: 'revline_starter_monthly', trialDays: 0,
    features: [
      'Edit by prompting: cuts, captions and effects',
      'Animated subtitles and text effects',
      'Export in 9:16, 1:1 and 16:9',
      '1080p export, no watermark',
      `Post to ${POSTING_ACCOUNTS.starter} account per platform`,
    ],
  },
  pro: {
    name: 'Pro', tagline: 'For creators editing every week.', monthlyPrice: 39, currency: 'USD', lookupKey: 'revline_pro_monthly', trialDays: 3, featured: true,
    lead: 'Everything in Starter, plus',
    features: [
      'Edit from Claude, Codex or Cursor with MCP',
      'Unlimited MCP calls',
      `Post to ${POSTING_ACCOUNTS.pro} accounts per platform`,
      'Unlimited projects, 50 GB storage',
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
      '500 GB storage',
    ],
  },
};

/** Ranks plans for upgrade and downgrade wording. */
export const PLAN_RANK: Record<PlanTier, number> = { starter: 0, pro: 1, studio: 2 };

