import { StripeSubscriptions } from "@convex-dev/stripe";
import Stripe from 'stripe';
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { EDITOR_PLAN } from "../lib/billing/plan";
import { billingConfigured, billingEnabled, editorSubscriptions, hasEditorAccess, isEditorSubscription } from './lib/billing_access';

const hasAccess = hasEditorAccess;
function ready() { return billingEnabled() && billingConfigured(); }
function requireBilling() {
  if (!ready()) throw new ConvexError("Billing is not active");
  const origin = new URL(process.env.APP_ORIGIN!);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new ConvexError("Billing origin is invalid");
  if (!process.env.STRIPE_PRO_PRICE_ID!.startsWith("price_")) throw new ConvexError("Billing price is not configured");
  return origin.origin;
}
export const isSubscribed = query({ args: {}, returns: v.boolean(), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity || !ready()) return false;
  return (await editorSubscriptions(ctx, identity.subject)).some(hasAccess);
}});
export const status = query({ args: {}, returns: v.object({ enabled: v.boolean(), configured: v.boolean(), subscribed: v.boolean(), trialEligible: v.boolean(), needsPayment: v.boolean(), plan: v.union(v.literal("free"), v.literal("pro")) }), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); let subscribed = false; let trialEligible = true; let needsPayment = false;
  if (identity && ready()) { const subs = await editorSubscriptions(ctx, identity.subject); subscribed = subs.some(hasAccess); trialEligible = subs.length === 0; needsPayment = subs.some(sub => ['past_due', 'unpaid', 'paused', 'incomplete'].includes(sub.status)); }
  return { enabled: billingEnabled(), configured: ready(), subscribed, trialEligible, needsPayment, plan: subscribed ? "pro" as const : "free" as const };
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
export const createCheckout = action({ args: { plan: v.literal("pro") }, returns: v.object({ sessionId: v.string(), url: v.union(v.string(), v.null()) }), handler: async (ctx): Promise<{sessionId: string; url: string | null}> => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Authentication required");
  const origin = requireBilling(); const stripe = new StripeSubscriptions(components.stripe, {});
  const subscriptions = await editorSubscriptions(ctx, identity.subject);
  if (subscriptions.some(hasAccess)) throw new ConvexError("You already have a subscription. Manage it in billing.");
  if (subscriptions.some(sub => ['past_due', 'unpaid', 'paused', 'incomplete'].includes(sub.status))) throw new ConvexError('Update your existing subscription in billing before creating a new one.');
  // Only identity.subject selects a customer. Email fallback can alias unrelated identities.
  const customer = await stripe.getOrCreateCustomer(ctx, { userId: identity.subject });
  const client = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const priceId = process.env.STRIPE_PRO_PRICE_ID!;
  const price = await client.prices.retrieve(priceId);
  if (!price.active || price.currency !== 'usd' || price.unit_amount !== EDITOR_PLAN.monthlyPrice * 100 || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1) throw new ConvexError('Billing price does not match the editor plan.');
  // Also check Stripe directly so delayed webhooks cannot create duplicate subscriptions or trials.
  const remote = await client.subscriptions.list({ customer: customer.customerId, status: 'all', limit: 100 });
  if (remote.has_more) throw new ConvexError('Please manage your existing subscriptions in billing.');
  const editor = remote.data.filter(sub => isEditorSubscription({ priceId: sub.items.data[0]?.price.id ?? '', metadata: sub.metadata }));
  if (editor.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) throw new ConvexError('You already have a subscription. Manage it in billing.');
  const reservationArgs = { ownerId: identity.subject, priceId, origin, trialEligible: subscriptions.length === 0 && editor.length === 0 };
  let reservation = await ctx.runMutation(internal.billing.reserveCheckout, reservationArgs);
  if (reservation.sessionId) {
    const previous = await client.checkout.sessions.retrieve(reservation.sessionId);
    if (previous.status === 'open' && previous.url) return { sessionId: previous.id, url: previous.url };
    if (previous.status === 'complete') throw new ConvexError('Your checkout is complete. Waiting for Stripe to confirm your membership.');
    reservation = await ctx.runMutation(internal.billing.reserveCheckout, { ...reservationArgs, expiredRequestId: reservation.requestId });
  }
  const session = await client.checkout.sessions.create({
    mode: 'subscription', customer: customer.customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?checkout=success`, cancel_url: `${origin}/billing?checkout=canceled`,
    integration_identifier: 'revline-editor-xpkzqvna', payment_method_collection: 'always',
    managed_payments: { enabled: false },
    metadata: { userId: identity.subject, app: 'revline-editor' },
    subscription_data: {
      metadata: { userId: identity.subject, app: 'revline-editor' },
      ...(reservationArgs.trialEligible ? { trial_period_days: EDITOR_PLAN.trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } } : {}),
    },
  }, { idempotencyKey: `revline-checkout-v2-${reservation.requestId}` });
  if (!session.url) throw new ConvexError('Stripe did not return a checkout link.');
  await ctx.runMutation(internal.billing.saveCheckout, { ownerId: identity.subject, requestId: reservation.requestId, sessionId: session.id, url: session.url, expiresAt: session.expires_at * 1000 });
  return { sessionId: session.id, url: session.url };
}});
export const createPortal = action({ args: {}, returns: v.object({ url: v.string() }), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Authentication required");
  const origin = requireBilling();
  const customer = await ctx.runQuery(components.stripe.public.getCustomerByUserId, { userId: identity.subject });
  if (!customer) throw new ConvexError("No billing account exists");
  return await new StripeSubscriptions(components.stripe, {}).createCustomerPortalSession(ctx, { customerId: customer.stripeCustomerId, returnUrl: `${origin}/billing` });
}});
