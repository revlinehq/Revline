import { v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const appleEntitlementEvent = {
  source: v.union(v.literal('apple'), v.literal('superwall')),
  eventId: v.string(), ownerId: v.string(), transactionId: v.string(), originalTransactionId: v.string(),
  productId: v.string(), plan: v.union(v.literal('pro'), v.literal('ultra')),
  environment: v.union(v.literal('Sandbox'), v.literal('Production')),
  purchasedAt: v.number(), expiresAt: v.number(), accessUntil: v.number(), eventAt: v.number(),
  supersededAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()), refundReversed: v.optional(v.boolean()),
  autoRenew: v.optional(v.boolean()), billingIssue: v.optional(v.boolean()), superwallSequence: v.optional(v.number()),
  forwardBody: v.optional(v.string()),
};

export async function activeAppleEntitlement(ctx: QueryCtx | MutationCtx, ownerId: string) {
  const rows = await ctx.db.query('appleEntitlements').withIndex('by_owner_access', q => q.eq('ownerId', ownerId).gt('accessUntil', Date.now())).take(20);
  const active = rows.filter(row => row.revokedAt === undefined && appleEnvironmentAllowed(ownerId, row.environment));
  return active.find(row => row.plan === 'ultra') ?? active[0] ?? null;
}

export function appleEnvironmentAllowed(ownerId: string, environment: string) {
  if (environment === process.env.APPLE_ENVIRONMENT) return true;
  return process.env.APPLE_ENVIRONMENT === 'Production' && environment === 'Sandbox' &&
    (process.env.APPLE_SANDBOX_REVIEW_USER_IDS ?? '').split(',').map(value => value.trim()).includes(ownerId);
}

export function appleBillingConfiguration(): { environment: 'Sandbox' | 'Production'; bundleId: string; pro: string; ultra: string } {
  const environment = process.env.APPLE_ENVIRONMENT;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const pro = process.env.APPLE_PRO_PRODUCT_ID;
  const ultra = process.env.APPLE_ULTRA_PRODUCT_ID;
  if ((environment !== 'Sandbox' && environment !== 'Production') || !bundleId || !pro || !ultra || pro === ultra) {
    throw new Error('App Store billing is not configured');
  }
  if (environment === 'Production' && (!process.env.APPLE_APP_ID || !Number.isSafeInteger(Number(process.env.APPLE_APP_ID)) || Number(process.env.APPLE_APP_ID) <= 0)) throw new Error('Production App Store app ID is not configured');
  return { environment, bundleId, pro, ultra };
}

export function appleProductPlan(productId: string): 'pro' | 'ultra' {
  const config = appleBillingConfiguration();
  if (productId === config.pro) return 'pro';
  if (productId === config.ultra) return 'ultra';
  throw new Error('Unrecognized App Store product');
}
