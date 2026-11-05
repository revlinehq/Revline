'use node';

import { Webhook, WebhookVerificationError } from 'svix';
import { v } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { appleBillingConfiguration, appleEnvironmentAllowed, appleProductPlan } from './lib/apple_entitlements';

const timestamp = z.number().int().nonnegative();
const identifier = z.string().min(1).max(255);
const eventSchema = z.object({
  id: identifier, type: identifier, project_id: identifier, occurred_at: timestamp,
  app_user_id: identifier.nullable(),
  event_data: z.object({
    transaction_id: identifier, original_transaction_id: identifier, product_id: identifier,
    purchased_at: timestamp, expiration_at: timestamp.nullable(), store: identifier, environment: identifier,
    period_type: identifier.nullable().optional(), is_trial_conversion: z.boolean().nullable().optional(), bundle_id: identifier.nullable(), is_refund: z.boolean().nullable().optional(), price: z.number().nullable().optional(),
  }).nullable(),
  subscriber: z.object({ app_user_id: identifier }).nullable().optional(),
  subscription: z.object({
    subscription_id: identifier, transaction_id: identifier, sequence: timestamp, product_id: identifier,
    store: identifier, environment: identifier, state: identifier, is_active: z.boolean(), will_renew: z.boolean(),
    starts_at: timestamp, renewed_at: timestamp.nullable(), expires_at: timestamp.nullable(),
  }).nullable().optional(),
});

/** V2 uses Svix's raw-body HMAC verification, including the five-minute replay window. */
export const webhook = internalAction({ args: { body: v.string(), id: v.string(), timestamp: v.string(), signature: v.string() }, returns: v.number(), handler: async (ctx, args) => {
  const secret = process.env.SUPERWALL_WEBHOOK_SECRET;
  const projectId = process.env.SUPERWALL_PROJECT_ID;
  if (!secret || !projectId) return 503;
  let config: ReturnType<typeof appleBillingConfiguration>;
  try { config = appleBillingConfiguration(); } catch { return 503; }
  let input: unknown;
  try { input = new Webhook(secret).verify(args.body, { 'svix-id': args.id, 'svix-timestamp': args.timestamp, 'svix-signature': args.signature }); }
  catch (error) { if (error instanceof WebhookVerificationError) return 401; throw error; }
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return 400;
  const event = parsed.data;
  if (event.project_id !== projectId) return 403;
  const data = event.event_data;
  if (!data || !['initial_purchase', 'renewal', 'cancellation', 'uncancellation', 'expiration', 'billing_issue', 'refund', 'product_change', 'subscription_extended'].includes(event.type)) return 200;
  if (data.store !== 'APP_STORE') return 200;
  const environment = data.environment === 'SANDBOX' ? 'Sandbox' : data.environment === 'PRODUCTION' ? 'Production' : null;
  if (!environment || data.bundle_id !== config.bundleId) return 400;
  if (event.app_user_id && event.subscriber?.app_user_id && event.app_user_id !== event.subscriber.app_user_id) return 400;
  const userId = event.app_user_id ?? event.subscriber?.app_user_id;
  const ownerId = await ctx.runQuery(internal.appleBilling.owner, { userId, originalTransactionId: data.original_transaction_id });
  if (!ownerId) return 503;
  if (!appleEnvironmentAllowed(ownerId, environment)) return 400;
  const refunded = event.type === 'refund' || data.is_refund === true || (data.price ?? 0) < 0;
  const paidConversion = event.type === 'renewal' && data.is_trial_conversion === true && (data.price ?? 0) > 0;
  const modelPayment = data.period_type === 'TRIAL' && !paidConversion ? 'free' :
    data.price !== null && data.price !== undefined && data.price > 0 ? 'paid' :
    data.price === 0 && ['initial_purchase', 'renewal'].includes(event.type) ? 'free' : undefined;
  if (data.expiration_at !== null) {
    await ctx.runMutation(internal.appleBilling.apply, {
      modelPayment,
      source: 'superwall', eventId: event.id, ownerId, transactionId: data.transaction_id,
      originalTransactionId: data.original_transaction_id, productId: data.product_id, plan: appleProductPlan(data.product_id),
      environment, purchasedAt: data.purchased_at, expiresAt: data.expiration_at,
      accessUntil: refunded ? 0 : data.expiration_at, eventAt: event.occurred_at,
      ...(refunded ? { revokedAt: event.occurred_at } : {}),
      ...(event.type === 'cancellation' ? { autoRenew: false } : event.type === 'uncancellation' ? { autoRenew: true } : {}),
      ...(event.type === 'billing_issue' ? { billingIssue: true } : {}),
    });
  }
  // A snapshot can describe a newer renewal than the triggering transaction. Keep them separate.
  const snapshot = event.subscription;
  if (snapshot && snapshot.subscription_id === data.original_transaction_id && snapshot.store === 'app-store' && snapshot.expires_at !== null &&
      snapshot.environment === (environment === 'Production' ? 'live' : 'test')) {
    await ctx.runMutation(internal.appleBilling.apply, {
      modelPayment: snapshot.transaction_id === data.transaction_id ? modelPayment : undefined,
      source: 'superwall', eventId: `${event.id}:snapshot`, ownerId, transactionId: snapshot.transaction_id,
      originalTransactionId: snapshot.subscription_id, productId: snapshot.product_id, plan: appleProductPlan(snapshot.product_id),
      environment, purchasedAt: snapshot.renewed_at ?? snapshot.starts_at, expiresAt: snapshot.expires_at,
      accessUntil: snapshot.is_active ? snapshot.expires_at : 0, eventAt: event.occurred_at,
      ...(snapshot.state === 'revoked' ? { revokedAt: event.occurred_at } : {}),
      autoRenew: snapshot.will_renew, billingIssue: ['inGracePeriod', 'inBillingRetryPeriod'].includes(snapshot.state), superwallSequence: snapshot.sequence,
    });
  }
  return 200;
} });

/** Apple has one notification URL per environment. Fan out verified notifications durably. */
export const forwardAppleNotification = internalAction({ args: { body: v.string(), attempt: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const configured = process.env.SUPERWALL_APPLE_NOTIFICATIONS_URL;
  if (!configured) return null;
  const target = new URL(configured);
  if (target.origin !== 'https://integrations.superwall.com' || target.pathname !== '/integrations/app-store-connect/webhook' || target.username || target.password || target.hash) throw new Error('Invalid Superwall notification forwarding URL');
  try {
    const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: args.body, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Superwall notification forwarding failed');
  } catch {
    if (args.attempt >= 24) throw new Error('Superwall notification forwarding exhausted its retries');
    await ctx.scheduler.runAfter(Math.min(3600_000, 1000 * 2 ** args.attempt), internal.superwallBilling.forwardAppleNotification, { ...args, attempt: args.attempt + 1 });
  }
  return null;
} });
