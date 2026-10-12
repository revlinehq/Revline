import { StripeSubscriptions } from "@convex-dev/stripe";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { action, query } from "./_generated/server";
import { EDITOR_PLAN } from "../lib/billing/plan";

const isEditorSubscription = (sub: { priceId: string; metadata?: Record<string, unknown> }) => sub.priceId === process.env.STRIPE_PRO_PRICE_ID || sub.metadata?.app === "revline-editor";
const hasAccess = (sub: { status: string }) => sub.status === "active" || sub.status === "trialing";
function ready() { return process.env.BILLING_ENABLED === "true" && !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.STRIPE_PRO_PRICE_ID && !!process.env.APP_ORIGIN; }
function requireBilling() {
  if (!ready()) throw new ConvexError("Billing is not active");
  const origin = new URL(process.env.APP_ORIGIN!);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new ConvexError("Billing origin is invalid");
  if (!process.env.STRIPE_PRO_PRICE_ID!.startsWith("price_")) throw new ConvexError("Billing price is not configured");
  return origin.origin;
}
export const isSubscribed = query({ args: {}, returns: v.boolean(), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity || !ready()) return false;
  const subs = await ctx.runQuery(components.stripe.public.listSubscriptionsByUserId, { userId: identity.subject }); return subs.some(sub => isEditorSubscription(sub) && hasAccess(sub));
}});
export const status = query({ args: {}, returns: v.object({ enabled: v.boolean(), configured: v.boolean(), subscribed: v.boolean(), trialEligible: v.boolean(), plan: v.union(v.literal("free"), v.literal("pro")) }), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); let subscribed = false; let trialEligible = true;
  if (identity && ready()) { const subs = (await ctx.runQuery(components.stripe.public.listSubscriptionsByUserId, { userId: identity.subject })).filter(isEditorSubscription); subscribed = subs.some(hasAccess); trialEligible = subs.length === 0; }
  return { enabled: process.env.BILLING_ENABLED === "true", configured: ready(), subscribed, trialEligible, plan: subscribed ? "pro" as const : "free" as const };
}});
export const createCheckout = action({ args: { plan: v.literal("pro") }, returns: v.object({ sessionId: v.string(), url: v.union(v.string(), v.null()) }), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Authentication required");
  const origin = requireBilling(); const stripe = new StripeSubscriptions(components.stripe, {});
  const subscriptions = (await ctx.runQuery(components.stripe.public.listSubscriptionsByUserId, { userId: identity.subject })).filter(isEditorSubscription);
  if (subscriptions.some(hasAccess)) throw new ConvexError("You already have a subscription. Manage it in billing.");
  // Only identity.subject selects a customer. Email fallback can alias unrelated identities.
  const customer = await stripe.getOrCreateCustomer(ctx, { userId: identity.subject });
  return await stripe.createCheckoutSession(ctx, {
    priceId: process.env.STRIPE_PRO_PRICE_ID!, customerId: customer.customerId, mode: "subscription",
    successUrl: `${origin}/billing?checkout=success`, cancelUrl: `${origin}/billing?checkout=canceled`,
    subscriptionMetadata: { userId: identity.subject, app: "revline-editor" },
    params: {
      payment_method_collection: "always",
      subscription_data: {
        ...(subscriptions.length === 0 ? { trial_period_days: EDITOR_PLAN.trialDays, trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } } } : {}),
      },
    },
  });
}});
export const createPortal = action({ args: {}, returns: v.object({ url: v.string() }), handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new ConvexError("Authentication required");
  const origin = requireBilling();
  const customer = await ctx.runQuery(components.stripe.public.getCustomerByUserId, { userId: identity.subject });
  if (!customer) throw new ConvexError("No billing account exists");
  return await new StripeSubscriptions(components.stripe, {}).createCustomerPortalSession(ctx, { customerId: customer.stripeCustomerId, returnUrl: `${origin}/billing` });
}});
