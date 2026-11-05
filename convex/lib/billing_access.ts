import { ULTRA_OFFERED } from '../../lib/billing/plan';
import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { activeAppleEntitlement, hasPaidAppleModelAccess } from './apple_entitlements';

export const billingEnabled = () => process.env.BILLING_ENABLED === 'true';
export const billingConfigured = () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.STRIPE_PRO_PRICE_ID && !!process.env.APP_ORIGIN;
export const ultraBillingConfigured = () => ULTRA_OFFERED && billingConfigured() && !!process.env.STRIPE_ULTRA_PRICE_ID;
const isUltraSubscription = (sub: { priceId: string }) => !!process.env.STRIPE_ULTRA_PRICE_ID && sub.priceId === process.env.STRIPE_ULTRA_PRICE_ID;
export const isEditorSubscription = (sub: { priceId: string; metadata?: Record<string, unknown> }) => sub.priceId === process.env.STRIPE_PRO_PRICE_ID || isUltraSubscription(sub) || sub.metadata?.app === 'revline-editor';
export const hasPaidEditorSubscriptionTerm = (sub: { status: string; currentPeriodEnd: number }) => sub.status === 'active' && sub.currentPeriodEnd > Date.now() / 1000;
export const hasEditorAccess = (sub: { status: string; currentPeriodEnd: number }) => (sub.status === 'active' || sub.status === 'trialing') && sub.currentPeriodEnd > Date.now() / 1000;

export async function editorSubscriptions(ctx: QueryCtx | MutationCtx | ActionCtx, userId: string) {
  return (await ctx.runQuery(components.stripe.public.listSubscriptionsByUserId, { userId })).filter(isEditorSubscription);
}

/** An operator grant that is neither revoked nor expired. */
async function activeComplimentaryEntitlement(ctx: QueryCtx | MutationCtx, ownerId: string) {
  const entitlement = await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  return entitlement && entitlement.revokedAt === undefined && (entitlement.expiresAt === undefined || entitlement.expiresAt > Date.now()) ? entitlement : null;
}

export async function hasComplimentaryEditorAccess(ctx: QueryCtx | MutationCtx, ownerId: string) {
  return !!await activeComplimentaryEntitlement(ctx, ownerId);
}

/** Ultra comes from an active Ultra subscription, or an operator grant on an active complimentary entitlement. */
export async function hasUltraPlan(ctx: QueryCtx | MutationCtx, ownerId: string) {
  if ((await activeAppleEntitlement(ctx, ownerId))?.plan === 'ultra') return true;
  if ((await activeComplimentaryEntitlement(ctx, ownerId))?.plan === 'ultra') return true;
  if (!billingEnabled() || !ultraBillingConfigured()) return false;
  return (await editorSubscriptions(ctx, ownerId)).some(sub => isUltraSubscription(sub) && hasEditorAccess(sub));
}

export async function requireEditorAccess(ctx: QueryCtx | MutationCtx, ownerId: string) {
  if (!billingEnabled()) return;
  if (await hasComplimentaryEditorAccess(ctx, ownerId)) return;
  if (await activeAppleEntitlement(ctx, ownerId)) return;
  if (!billingConfigured()) throw new ConvexError({ code: 'BILLING_UNAVAILABLE', message: 'Billing is temporarily unavailable. Please try again.' });
  if (!(await editorSubscriptions(ctx, ownerId)).some(hasEditorAccess)) {
    throw new ConvexError({ code: 'SUBSCRIPTION_REQUIRED', message: 'Start your free trial or renew your subscription to edit and export.' });
  }
}

/** Model upgrades require a current paid term or an operator-granted Ultra plan; trials and other
 * complimentary access only grant editing. Deployments without billing (development, agent
 * worktrees, self-hosted) meter no one, so every account keeps the configured models there. */
export async function hasPaidModelAccess(ctx: QueryCtx | MutationCtx, ownerId: string) {
  if (!billingEnabled()) return true;
  if (await hasPaidAppleModelAccess(ctx, ownerId)) return true;
  if ((await activeComplimentaryEntitlement(ctx, ownerId))?.plan === 'ultra') return true;
  if (!billingConfigured()) return false;
  return (await editorSubscriptions(ctx, ownerId)).some(hasPaidEditorSubscriptionTerm);
}
