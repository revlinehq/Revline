import { StripeSubscriptions } from "@convex-dev/stripe";
import Stripe from 'stripe';
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, internalMutation, query, type ActionCtx } from "./_generated/server";
import { PLANS, PLAN_RANK, type PlanTier } from "../lib/billing/plan";
import { NEW_PROJECT_PATH } from '../lib/workspace-routes';
import { activePlanTier, billingConfigured, billingEnabled, editorSubscriptions, fromStripeSubscription, hasComplimentaryEditorAccess, hasEditorAccess, isEditorSubscription, pinnedPriceId, subscriptionTier } from './lib/billing_access';
import { activeAppleEntitlement } from './lib/apple_entitlements';

function ready() { return billingEnabled() && billingConfigured(); }
function requireBilling() {
  if (!ready()) throw new ConvexError("Billing is not active");
  const origin = new URL(process.env.APP_ORIGIN!);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new ConvexError("Billing origin is invalid");
  return origin.origin;
}
export const status = query({ args: {}, returns: v.object({ enabled: v.boolean(), configured: v.boolean(), subscribed: v.boolean(), complimentary: v.optional(v.boolean()), complimentaryExpiresAt: v.optional(v.number()), trialEligible: v.boolean(), needsPayment: v.boolean(), paymentIssue: v.optional(v.boolean()), subscriptionSource: v.optional(v.union(v.literal('apple'), v.literal('stripe'))), appleExpiresAt: v.optional(v.number()), plan: v.union(v.literal("free"), v.literal("pro"), v.literal("ultra")), tier: v.optional(v.union(v.literal("starter"), v.literal("pro"), v.literal("studio"))), ultraAvailable: v.boolean(),
  /** The web subscription's dates, in ms: when its free trial ends, and when a scheduled cancellation ends it. Added after
   *  installed iOS builds; they ignore it. */
  subscriptionDates: v.optional(v.object({ trialEnd: v.optional(v.number()), cancelAt: v.optional(v.number()) })) }), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); let subscribed = false; let trialEligible = true; let paymentIssue = false; let subscriptionDates: { trialEnd?: number; cancelAt?: number } | undefined;
  const complimentary = !!identity && await hasComplimentaryEditorAccess(ctx, identity.subject);
  const tier = identity ? await activePlanTier(ctx, identity.subject) : null;
  const apple = identity ? await activeAppleEntitlement(ctx, identity.subject) : null;
  if (identity && ready()) { const subs = await editorSubscriptions(ctx, identity.subject); const current = subs.find(sub => hasEditorAccess(sub) && subscriptionTier(sub) !== null); subscribed = !!current;
    // While trialing, Stripe's current period is the trial, so it ends with it. A cancellation ends at cancelAt, or at the period end.
    if (current) { const cancelAt = current.cancelAt ?? (current.cancelAtPeriodEnd ? current.currentPeriodEnd : undefined); subscriptionDates = { ...(current.status === 'trialing' ? { trialEnd: current.currentPeriodEnd * 1000 } : {}), ...(cancelAt !== undefined ? { cancelAt: cancelAt * 1000 } : {}) }; }
    trialEligible = subs.length === 0; paymentIssue = subs.some(sub => ['past_due', 'unpaid', 'paused', 'incomplete'].includes(sub.status)); }
  const stripeSubscribed = subscribed;
  const subscriptionSource: 'apple' | 'stripe' | undefined = apple ? 'apple' : stripeSubscribed ? 'stripe' : undefined;
  subscribed ||= !!apple;
  // `plan` keeps the shape installed iOS builds read: Studio reads as 'ultra' and Starter as 'pro'. `tier` names the plan.
  const plan: 'ultra' | 'pro' | 'free' = tier === 'studio' ? 'ultra' : subscribed || complimentary ? 'pro' : 'free';
  const entitlement = complimentary ? await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', identity!.subject)).unique() : null;
  return { enabled: billingEnabled(), configured: ready() || !!apple, subscribed, ...(subscriptionSource ? { subscriptionSource } : {}), ...(apple ? { appleExpiresAt: apple.accessUntil } : {}), ...(complimentary ? { complimentary: true, ...(entitlement?.expiresAt !== undefined ? { complimentaryExpiresAt: entitlement.expiresAt } : {}) } : {}), trialEligible: complimentary || apple ? false : trialEligible, needsPayment: !!identity && billingEnabled() && !subscribed && !complimentary, paymentIssue: !subscribed && !complimentary && paymentIssue, plan, ...(tier && (subscribed || complimentary) ? { tier } : {}), ultraAvailable: ready(), ...(subscriptionDates && Object.keys(subscriptionDates).length ? { subscriptionDates } : {}) };
}});
export const reserveCheckout = internalMutation({
  args: { ownerId: v.string(), priceId: v.string(), origin: v.string(), trialEligible: v.boolean(), expiredRequestId: v.optional(v.string()) },
  returns: v.object({ requestId: v.string(), sessionId: v.optional(v.string()), url: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const previous = await ctx.db.query('billingCheckouts').withIndex('by_owner', q => q.eq('ownerId', args.ownerId)).unique();
    if (previous && previous.priceId === args.priceId && previous.origin === args.origin && previous.trialEligible === args.trialEligible && previous.requestId !== args.expiredRequestId && (previous.expiresAt ?? previous.createdAt + 23 * 3600_000) > Date.now()) {
      return { requestId: previous.requestId, sessionId: previous.sessionId, url: previous.url };
    }
    const fields = { ownerId: args.ownerId, priceId: args.priceId, origin: args.origin, trialEligible: args.trialEligible, requestId: crypto.randomUUID(), createdAt: Date.now() };
    if (previous) await ctx.db.replace(previous._id, fields); else await ctx.db.insert('billingCheckouts', fields);
    return { requestId: fields.requestId };
  },
});
export const saveCheckout = internalMutation({
  args: { ownerId: v.string(), requestId: v.string(), sessionId: v.string(), url: v.string(), expiresAt: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const checkout = await ctx.db.query('billingCheckouts').withIndex('by_owner', q => q.eq('ownerId', args.ownerId)).unique();
    if (checkout?.requestId === args.requestId) await ctx.db.patch(checkout._id, { sessionId: args.sessionId, url: args.url, expiresAt: args.expiresAt });
    return null;
  },
});
// Claim before the Stripe read, so a slower concurrent response cannot overwrite
// a later reconciliation. Stripe event.created has only second precision.
export const beginSubscriptionSync = internalMutation({
  args: { stripeSubscriptionId: v.string(), eventId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const previous = await ctx.db.query('billingSubscriptionSync').withIndex('by_subscription', q => q.eq('stripeSubscriptionId', args.stripeSubscriptionId)).unique();
    if (previous?.lastEventId === args.eventId) return null;
    const token = crypto.randomUUID();
    if (previous) await ctx.db.patch(previous._id, { token });
    else await ctx.db.insert('billingSubscriptionSync', { stripeSubscriptionId: args.stripeSubscriptionId, token });
    return token;
  },
});
export const applySubscriptionSync = internalMutation({
  args: { stripeSubscriptionId: v.string(), eventId: v.string(), token: v.string(), stripeCustomerId: v.string(), status: v.string(), currentPeriodEnd: v.number(), cancelAtPeriodEnd: v.boolean(), cancelAt: v.optional(v.number()), quantity: v.number(), priceId: v.string(), metadata: v.record(v.string(), v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { token, eventId, ...subscription }) => {
    const claim = await ctx.db.query('billingSubscriptionSync').withIndex('by_subscription', q => q.eq('stripeSubscriptionId', subscription.stripeSubscriptionId)).unique();
    if (!claim || claim.token !== token) return false;
    // Component writes and this receipt commit in the same transaction. Updated
    // also upserts, covering cancellation delivered before the creation event.
    await ctx.runMutation(components.stripe.private.handleSubscriptionUpdated, subscription);
    await ctx.db.patch(claim._id, { lastEventId: eventId });
    return true;
  },
});
/** The plan's Stripe price: the active price with the plan's lookup key, else STRIPE_<TIER>_PRICE_ID. Only a price
 *  for the plan's monthly USD amount is used. */
async function planPrice(client: Stripe, tier: PlanTier) {
  const plan = PLANS[tier], pinned = pinnedPriceId(tier);
  const fits = (price?: Stripe.Price) => !!price && price.active && price.currency === 'usd' && price.unit_amount === plan.monthlyPrice * 100 && price.recurring?.interval === 'month' && price.recurring.interval_count === 1;
  const [byKey, byId] = await Promise.all([client.prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 1 }).then(list => list.data[0]), pinned ? client.prices.retrieve(pinned).catch(() => undefined) : undefined]);
  const price = [byKey, byId].find(fits);
  if (!price) throw new ConvexError(byKey || byId ? 'Billing price does not match the plan.' : `${plan.name} is not available yet.`);
  return price.id;
}
const planArg = v.union(v.literal("starter"), v.literal("pro"), v.literal("studio"), v.literal("ultra"));
/** 'ultra' is the retired name for Studio, still accepted from older clients. */
const tierOf = (plan: 'starter' | 'pro' | 'studio' | 'ultra'): PlanTier => plan === 'ultra' ? 'studio' : plan;
export const createCheckout = action({ args: { plan: planArg }, returns: v.object({ sessionId: v.string(), url: v.union(v.string(), v.null()) }), handler: async (ctx, args): Promise<{sessionId: string; url: string | null}> => {
  const tier = tierOf(args.plan);
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Authentication required");
  if (await ctx.runQuery(internal.editorAccess.hasComplimentary, { ownerId: identity.subject })) throw new ConvexError('Your complimentary membership already includes editor access. No payment is required.');
  if (await ctx.runQuery(internal.appleBilling.hasActive, { ownerId: identity.subject })) throw new ConvexError('Your subscription is managed in the App Store.');
  const origin = requireBilling(); const stripe = new StripeSubscriptions(components.stripe, {});
  const subscriptions = await editorSubscriptions(ctx, identity.subject);
  if (subscriptions.some(hasEditorAccess)) throw new ConvexError("You already have a subscription. Change your plan from billing.");
  if (subscriptions.some(sub => ['past_due', 'unpaid', 'paused', 'incomplete'].includes(sub.status))) throw new ConvexError('Update your existing subscription in billing before creating a new one.');
  // Only identity.subject selects a customer. Email fallback can alias unrelated identities.
  const customer = await stripe.getOrCreateCustomer(ctx, { userId: identity.subject });
  const client = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const priceId = await planPrice(client, tier);
  // Also check Stripe directly so delayed webhooks cannot create duplicate subscriptions or trials.
  const remote = await client.subscriptions.list({ customer: customer.customerId, status: 'all', limit: 100 });
  if (remote.has_more) throw new ConvexError('Please manage your existing subscriptions in billing.');
  const editor = remote.data.filter(sub => isEditorSubscription(fromStripeSubscription(sub)));
  if (editor.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) throw new ConvexError('You already have a subscription. Manage it in billing.');
  // Only plans with trialDays (Pro) start with a trial.
  const reservationArgs = { ownerId: identity.subject, priceId, origin, trialEligible: PLANS[tier].trialDays > 0 && subscriptions.length === 0 && editor.length === 0 };
  let reservation = await ctx.runMutation(internal.billing.reserveCheckout, reservationArgs);
  if (reservation.sessionId) {
    const previous = await client.checkout.sessions.retrieve(reservation.sessionId);
    if (previous.status === 'open' && previous.url) return { sessionId: previous.id, url: previous.url };
    if (previous.status === 'complete') throw new ConvexError('Your checkout is complete. Waiting for Stripe to confirm your membership.');
    reservation = await ctx.runMutation(internal.billing.reserveCheckout, { ...reservationArgs, expiredRequestId: reservation.requestId });
  }
  // A checkout left open for another plan could still be paid, giving two subscriptions: close it first.
  const open = await client.checkout.sessions.list({ customer: customer.customerId, status: 'open', limit: 100 });
  await Promise.all(open.data.filter(previous => previous.metadata?.app === 'revline-editor').map(previous => client.checkout.sessions.expire(previous.id)));
  const session = await client.checkout.sessions.create({
    mode: 'subscription', customer: customer.customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}${NEW_PROJECT_PATH}?checkout=success`, cancel_url: `${origin}/billing?checkout=canceled`,
    integration_identifier: 'revline-editor-xpkzqvna', payment_method_collection: 'always',
    managed_payments: { enabled: false },
    metadata: { userId: identity.subject, app: 'revline-editor', plan: tier },
    subscription_data: {
      metadata: { userId: identity.subject, app: 'revline-editor', plan: tier },
      ...(reservationArgs.trialEligible ? { trial_period_days: PLANS[tier].trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } } : {}),
    },
  }, { idempotencyKey: `revline-checkout-v3-${reservation.requestId}` });
  if (!session.url) throw new ConvexError('Stripe did not return a checkout link.');
  await ctx.runMutation(internal.billing.saveCheckout, { ownerId: identity.subject, requestId: reservation.requestId, sessionId: session.id, url: session.url, expiresAt: session.expires_at * 1000 });
  return { sessionId: session.id, url: session.url };
}});
export const createPortal = action({ args: {}, returns: v.object({ url: v.string() }), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Authentication required");
  if (await ctx.runQuery(internal.editorAccess.hasComplimentary, { ownerId: identity.subject })) throw new ConvexError('Your complimentary membership does not require a billing portal.');
  const origin = requireBilling();
  const customer = await ctx.runQuery(components.stripe.public.getCustomerByUserId, { userId: identity.subject });
  if (!customer) throw new ConvexError("No billing account exists");
  return await new StripeSubscriptions(components.stripe, {}).createCustomerPortalSession(ctx, { customerId: customer.stripeCustomerId, returnUrl: `${origin}/billing` });
}});
/** Moves the one active Stripe subscription to another plan in place, and writes the plan into its metadata.
 *  An upgrade invoices the prorated difference now; a downgrade credits it to the next invoice. Moving off Pro
 *  ends its trial, since only Pro has one. The webhook then syncs the plan. */
async function changeSubscriptionPlan(ctx: ActionCtx, tier: PlanTier) {
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Authentication required");
  if (await ctx.runQuery(internal.appleBilling.hasActive, { ownerId: identity.subject })) throw new ConvexError('Manage or change your subscription in the App Store.');
  requireBilling();
  const customer = await ctx.runQuery(components.stripe.public.getCustomerByUserId, { userId: identity.subject });
  if (!customer) throw new ConvexError('Start a membership before changing plans.');
  const client = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const priceId = await planPrice(client, tier);
  const remote = await client.subscriptions.list({ customer: customer.stripeCustomerId, status: 'all', limit: 100 });
  const current = remote.data.filter(sub => ['active', 'trialing'].includes(sub.status) && isEditorSubscription(fromStripeSubscription(sub)));
  if (current.length !== 1 || current[0].items.data.length !== 1) throw new ConvexError('Please manage your subscription in billing.');
  const [subscription] = current, [item] = subscription.items.data;
  const from = subscriptionTier(fromStripeSubscription(subscription));
  if (item.price.id === priceId && from === tier) return null;
  // A price Revline does not know is no plan, so any move off it counts as an upgrade.
  const upgrade = !from || PLAN_RANK[tier] > PLAN_RANK[from];
  try {
    await client.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: priceId, quantity: 1 }],
      metadata: { ...subscription.metadata, plan: tier },
      // An upgrade renews the subscription; a downgrade keeps a cancellation the member already scheduled.
      proration_behavior: upgrade ? 'always_invoice' : 'create_prorations', payment_behavior: 'error_if_incomplete', ...(upgrade ? { cancel_at_period_end: false } : {}),
      ...(subscription.status === 'trialing' && PLANS[tier].trialDays === 0 ? { trial_end: 'now' as const } : {}),
    });
  } catch (error) {
    // No idempotency key: a retry after fixing the card must reach Stripe again, and
    // the price check above already makes a repeated change a no-op.
    if (error instanceof Stripe.errors.StripeCardError) throw new ConvexError('Your card was declined. Update your payment method in billing, then try again.');
    throw error;
  }
  return null;
}
export const changePlan = action({ args: { plan: planArg }, returns: v.null(), handler: async (ctx, args) => changeSubscriptionPlan(ctx, tierOf(args.plan)) });
/** The earlier name for moving to Studio (once Ultra); kept for clients that still call it. */
export const upgradeToUltra = action({ args: {}, returns: v.null(), handler: async (ctx) => changeSubscriptionPlan(ctx, 'studio') });
