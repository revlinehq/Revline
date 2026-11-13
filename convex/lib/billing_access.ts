import { PLAN_RANK, PLAN_TIERS, TRIAL_LIMITS_TIER, tierForLookupKey, type PlanTier } from '../../lib/billing/plan';
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

/** The plan this owner is on now, or null without one, and when its billing period ends (for a Stripe
 *  subscription: its current period; an App Store grant: its access end; operator grants have none). App Store and
 *  operator grants are Pro, or Studio when they carry the Ultra entitlement; Stripe subscriptions give their plan.
 *  The highest of them counts. */
export async function activePlan(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<{ tier: PlanTier; periodEnd?: number } | null> {
  return (await planGrants(ctx, ownerId)).plan;
}
/** activePlan, plus whether a Stripe free trial is the only thing granting it: no App Store or operator grant, and no
 *  paid Stripe term beside the trial. Reads the subscriptions once. */
async function planGrants(ctx: QueryCtx | MutationCtx, ownerId: string) {
  const apple = await activeAppleEntitlement(ctx, ownerId), complimentary = await activeComplimentaryEntitlement(ctx, ownerId);
  const grants: { tier: PlanTier; periodEnd?: number }[] = [];
  if (apple) grants.push({ tier: apple.plan === 'ultra' ? 'studio' : 'pro', periodEnd: apple.accessUntil });
  if (complimentary) grants.push({ tier: complimentary.plan === 'ultra' ? 'studio' : 'pro' });
  const subs = billingEnabled() && billingConfigured() ? (await editorSubscriptions(ctx, ownerId)).filter(grantsPlan) : [];
  for (const sub of subs) grants.push({ tier: subscriptionTier(sub)!, periodEnd: sub.currentPeriodEnd * 1000 });
  const tier = highest(grants.map(grant => grant.tier));
  const plan = tier ? grants.find(grant => grant.tier === tier && grant.periodEnd !== undefined) ?? { tier } : null;
  const trialOnly = !apple && !complimentary && subs.some(sub => sub.status === 'trialing') && !subs.some(hasPaidEditorSubscriptionTerm);
  return { plan, trialOnly };
}
export async function activePlanTier(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<PlanTier | null> {
  return (await activePlan(ctx, ownerId))?.tier ?? null;
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

/** A Stripe free trial with no paid term beside it: it gets Starter's models (see productionOffer), not its plan's. */
async function onTrialOnly(ctx: QueryCtx | MutationCtx, ownerId: string) {
  if (!billingEnabled() || !billingConfigured()) return false;
  const subs = (await editorSubscriptions(ctx, ownerId)).filter(sub => subscriptionTier(sub) !== null);
  return subs.some(sub => sub.status === 'trialing' && hasEditorAccess(sub)) && !subs.some(hasPaidEditorSubscriptionTerm);
}

/** The plan whose limits (storage, AI allowance) this owner gets: activePlan, except that a Stripe free trial with no
 *  paid term beside it gets TRIAL_LIMITS_TIER's, whatever plan it trials, until its first payment succeeds (Stripe
 *  then moves it to active). `trialOf` names the plan being trialed; periodEnd stays the trial's end. */
export async function limitsPlan(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<{ tier: PlanTier; periodEnd?: number; trialOf?: PlanTier } | null> {
  const { plan, trialOnly } = await planGrants(ctx, ownerId);
  return plan && trialOnly ? { ...plan, tier: TRIAL_LIMITS_TIER, trialOf: plan.tier } : plan;
}

/** Model upgrades require a current paid term, a Stripe free trial (held to Starter's models) or an operator-granted
 * Ultra plan; other complimentary access only grants editing. Deployments without billing (development, agent
 * worktrees, self-hosted) meter no one, so every account keeps the configured models there. */
export async function hasPaidModelAccess(ctx: QueryCtx | MutationCtx, ownerId: string) {
  if (!billingEnabled()) return true;
  if (await hasPaidAppleModelAccess(ctx, ownerId)) return true;
  if ((await activeComplimentaryEntitlement(ctx, ownerId))?.plan === 'ultra') return true;
  if (!billingConfigured()) return false;
  return (await editorSubscriptions(ctx, ownerId)).some(sub => (hasPaidEditorSubscriptionTerm(sub) || sub.status === 'trialing' && hasEditorAccess(sub)) && subscriptionTier(sub) !== null);
}

/** Production, or a development deployment set to behave like it (EDITOR_PRODUCTION_OFFER=true), limits paid
 * accounts to PRODUCTION_EDITOR_OFFER. Every other deployment leaves the choice to its own switches. */
export const usesProductionOffer = () => incidentDeployment() === 'prod' || process.env.EDITOR_PRODUCTION_OFFER === 'true';

/** What production runs for a paid account that picked nothing; null where the production offer does not apply. */
export const productionDefaultModel = () => usesProductionOffer() ? offeredEditorModel(productionEditorOffer('pro')) : null;

/** The models and efforts this paid account may pick, by plan; null where no offer applies (the deployment's own
 * switches decide). Starter and a free trial are held to PRODUCTION_EDITOR_OFFER.starter on every billed deployment; Pro and Studio
 * get theirs in production. A request, saved choice or queued pin outside it runs on its default. Free accounts keep their own model. */
export async function productionOffer(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<EditorOffer | null> {
  // A deployment without billing meters no one, so there every account gets the Ultra list (as with canChooseReasoningEffort).
  if (!billingEnabled()) return usesProductionOffer() ? productionEditorOffer('ultra') : null;
  const tier = await activePlanTier(ctx, ownerId);
  // A free trial runs Starter's models until its first paid term, whatever plan it trials.
  if (tier === 'starter' || await onTrialOnly(ctx, ownerId)) return productionEditorOffer('starter');
  return usesProductionOffer() ? productionEditorOffer(tier === 'studio' ? 'ultra' : 'pro') : null;
}

/** Picking the reasoning effort is an Ultra feature. Callers check hasPaidModelAccess and productionOffer first: a trial
 * passes hasPaidModelAccess but productionOffer holds it to Starter's single effort. */
export async function canChooseReasoningEffort(ctx: QueryCtx | MutationCtx, ownerId: string) {
  const billing = billingEnabled();
  return editorEffortChoiceAllowed({ billing, ultra: billing && await hasUltraPlan(ctx, ownerId) });
}
