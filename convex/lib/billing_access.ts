import { PLAN_RANK, PLAN_TIERS, tierForLookupKey, type PlanTier } from '../../lib/billing/plan';
import { editorEffortChoiceAllowed, offeredEditorModel, productionEditorOffer, type EditorOffer } from '../../lib/ai/claude-model';
import { incidentDeployment } from './incidents';
import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { activeAppleEntitlement, hasPaidAppleModelAccess } from './apple_entitlements';

export const billingEnabled = () => process.env.BILLING_ENABLED === 'true';
/** Prices are found by lookup key, so no price ID setting is required. */
export const billingConfigured = () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.APP_ORIGIN;
const PRICE_ENV: Record<PlanTier, string> = { starter: 'STRIPE_STARTER_PRICE_ID', pro: 'STRIPE_PRO_PRICE_ID', studio: 'STRIPE_STUDIO_PRICE_ID' };
/** A price ID a deployment names for a plan: optional, used only when no price carries the plan's lookup key,
 *  and to recognise subscriptions from before lookup keys (production's STRIPE_PRO_PRICE_ID). */
export const pinnedPriceId = (tier: PlanTier) => process.env[PRICE_ENV[tier]]?.trim() || undefined;
/** The retired Ultra price, if a deployment still names it: such a subscription is treated as Studio. */
const legacyUltraPrice = () => process.env.STRIPE_ULTRA_PRICE_ID?.trim() || undefined;
type SubscriptionLike = { priceId: string; metadata?: Record<string, unknown> };
/** Where fromStripeSubscription records the price's lookup key ('' when the price has none). Only our webhook,
 *  checkout and changePlan write it, always from the live Stripe price, overriding any metadata of that name. */
const LOOKUP_KEY_FIELD = 'priceLookupKey';
/** Which plan a subscription's price is, and only its price: the price's lookup key first, then a deployment's
 *  STRIPE_<TIER>_PRICE_ID, then the retired Ultra price (Studio). Metadata `plan` is never read: checkout and the
 *  Stripe dashboard can both write it. An unknown price is no paid plan (null). */
export function subscriptionTier(sub: SubscriptionLike): PlanTier | null {
  const lookupKey = sub.metadata?.[LOOKUP_KEY_FIELD];
  const byKey = typeof lookupKey === 'string' ? tierForLookupKey(lookupKey) : undefined;
  if (byKey) return byKey;
  const pinned = PLAN_TIERS.find(tier => pinnedPriceId(tier) === sub.priceId);
  if (pinned) return pinned;
  if (legacyUltraPrice() && sub.priceId === legacyUltraPrice()) return 'studio';
  return null;
}
export const isEditorSubscription = (sub: SubscriptionLike) => sub.metadata?.app === 'revline-editor' || subscriptionTier(sub) !== null;
/** A Stripe subscription as Revline reads it: its price ID, and the price's lookup key in metadata, which names
 *  the plan (see subscriptionTier). The webhook stores this form; checkout and changePlan read live Stripe through it too. */
export function fromStripeSubscription(sub: { metadata: Record<string, string>; items: { data: Array<{ price: { id: string; lookup_key: string | null } }> } }) {
  const price = sub.items.data[0]?.price, plan = tierForLookupKey(price?.lookup_key);
  return { priceId: price?.id ?? '', metadata: { ...sub.metadata, [LOOKUP_KEY_FIELD]: price?.lookup_key ?? '', ...(plan ? { app: 'revline-editor' } : {}) } };
}
export const hasPaidEditorSubscriptionTerm = (sub: { status: string; currentPeriodEnd: number }) => sub.status === 'active' && sub.currentPeriodEnd > Date.now() / 1000;
export const hasEditorAccess = (sub: { status: string; currentPeriodEnd: number }) => (sub.status === 'active' || sub.status === 'trialing') && sub.currentPeriodEnd > Date.now() / 1000;
/** A subscription that grants a plan now: current, and on a price Revline knows. */
const grantsPlan = (sub: SubscriptionLike & { status: string; currentPeriodEnd: number }) => hasEditorAccess(sub) && subscriptionTier(sub) !== null;
const highest = (tiers: PlanTier[]) => tiers.reduce<PlanTier | null>((best, tier) => !best || PLAN_RANK[tier] > PLAN_RANK[best] ? tier : best, null);

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

/** The plan this owner is on now, or null without one. App Store and operator grants are Pro, or Studio
 *  when they carry the Ultra entitlement; Stripe subscriptions give their plan. The highest of them counts. */
export async function activePlanTier(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<PlanTier | null> {
  const apple = await activeAppleEntitlement(ctx, ownerId), complimentary = await activeComplimentaryEntitlement(ctx, ownerId);
  if (apple?.plan === 'ultra' || complimentary?.plan === 'ultra') return 'studio';
  const stripe = billingEnabled() && billingConfigured() ? (await editorSubscriptions(ctx, ownerId)).filter(grantsPlan).map(sub => subscriptionTier(sub)!) : [];
  return highest([...stripe, ...(apple || complimentary ? ['pro' as const] : [])]);
}

/** Studio grants the Ultra entitlement (4K, the faster export lane, model and effort choice). It comes from an
 *  active Studio subscription, or an App Store or operator grant that carries 'ultra'. */
export async function hasUltraPlan(ctx: QueryCtx | MutationCtx, ownerId: string) {
  return await activePlanTier(ctx, ownerId) === 'studio';
}

export async function requireEditorAccess(ctx: QueryCtx | MutationCtx, ownerId: string) {
  if (!billingEnabled()) return;
  if (await hasComplimentaryEditorAccess(ctx, ownerId)) return;
  if (await activeAppleEntitlement(ctx, ownerId)) return;
  if (!billingConfigured()) throw new ConvexError({ code: 'BILLING_UNAVAILABLE', message: 'Billing is temporarily unavailable. Please try again.' });
  if (!(await editorSubscriptions(ctx, ownerId)).some(grantsPlan)) {
    throw new ConvexError({ code: 'SUBSCRIPTION_REQUIRED', message: 'Start your free trial or renew your subscription to edit and export.' });
  }
}

/** MCP (editing from Claude, Codex or Cursor) is part of Pro and Studio, not Starter. */
export async function requireMcpAccess(ctx: QueryCtx | MutationCtx, ownerId: string) {
  await requireEditorAccess(ctx, ownerId);
  if (billingEnabled() && await activePlanTier(ctx, ownerId) === 'starter') {
    throw new ConvexError({ code: 'PLAN_REQUIRED', message: 'Editing from Claude, Codex or Cursor is part of Pro. Change your plan in Settings to connect.' });
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
  return (await editorSubscriptions(ctx, ownerId)).some(sub => hasPaidEditorSubscriptionTerm(sub) && subscriptionTier(sub) !== null);
}

/** Production, or a development deployment set to behave like it (EDITOR_PRODUCTION_OFFER=true), limits paid
 * accounts to PRODUCTION_EDITOR_OFFER. Every other deployment leaves the choice to its own switches. */
export const usesProductionOffer = () => incidentDeployment() === 'prod' || process.env.EDITOR_PRODUCTION_OFFER === 'true';

/** What production runs for a paid account that picked nothing; null where the production offer does not apply. */
export const productionDefaultModel = () => usesProductionOffer() ? offeredEditorModel(productionEditorOffer('pro')) : null;

/** The models and efforts this paid account may pick, by plan; null where no offer applies (the deployment's own
 * switches decide). Starter is held to PRODUCTION_EDITOR_OFFER.starter on every billed deployment; Pro and Studio
 * get theirs in production. A request, saved choice or queued pin outside it runs on its default. Free accounts keep their own model. */
export async function productionOffer(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<EditorOffer | null> {
  // A deployment without billing meters no one, so there every account gets the Ultra list (as with canChooseReasoningEffort).
  if (!billingEnabled()) return usesProductionOffer() ? productionEditorOffer('ultra') : null;
  const tier = await activePlanTier(ctx, ownerId);
  if (tier === 'starter') return productionEditorOffer('starter');
  return usesProductionOffer() ? productionEditorOffer(tier === 'studio' ? 'ultra' : 'pro') : null;
}

/** Picking the reasoning effort is an Ultra feature. Callers check hasPaidModelAccess first: an Ultra trial is not a paid term. */
export async function canChooseReasoningEffort(ctx: QueryCtx | MutationCtx, ownerId: string) {
  const billing = billingEnabled();
  return editorEffortChoiceAllowed({ billing, ultra: billing && await hasUltraPlan(ctx, ownerId) });
}
