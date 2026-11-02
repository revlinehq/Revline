import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation } from './_generated/server';
import { requireOwner } from './lib/auth';
import { activeAppleEntitlement, appleBillingConfiguration, appleEntitlementEvent } from './lib/apple_entitlements';
import { internal } from './_generated/api';

/** StoreKit requires a UUID. The authenticated Clerk subject owns this stable mapping. */
export const accountToken = mutation({ args: {}, returns: v.string(), handler: async ctx => {
  const ownerId = await requireOwner(ctx);
  try { appleBillingConfiguration(); } catch { throw new ConvexError('App Store subscriptions are temporarily unavailable. Please try again later.'); }
  const existing = await ctx.db.query('appleBillingAccounts').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  if (existing) return existing.appAccountToken;
  const appAccountToken = crypto.randomUUID().toLowerCase();
  await ctx.db.insert('appleBillingAccounts', { ownerId, appAccountToken, createdAt: Date.now() });
  return appAccountToken;
} });

export const owner = internalQuery({ args: { token: v.optional(v.string()), originalTransactionId: v.optional(v.string()), userId: v.optional(v.string()) }, returns: v.union(v.string(), v.null()), handler: async (ctx, args) => {
  const mapped = args.token ? await ctx.db.query('appleBillingAccounts').withIndex('by_token', q => q.eq('appAccountToken', args.token!.toLowerCase())).unique() : null;
  const original = args.originalTransactionId ? await ctx.db.query('appleEntitlements').withIndex('by_original', q => q.eq('originalTransactionId', args.originalTransactionId!)).first() : null;
  const user = args.userId ? await ctx.db.query('users').withIndex('by_clerk_id', q => q.eq('clerkId', args.userId!)).unique() : null;
  const owners = [mapped?.ownerId, original?.ownerId, user?.clerkId].filter((value): value is string => value !== undefined);
  if (new Set(owners).size > 1) throw new ConvexError('App Store subscription ownership does not match');
  // A supplied token must belong to the account. Never transfer subscriptions during restore.
  if (args.token && !mapped) return null;
  return owners[0] ?? null;
} });

export const hasActive = internalQuery({ args: { ownerId: v.string() }, returns: v.boolean(), handler: async (ctx, { ownerId }) => !!await activeAppleEntitlement(ctx, ownerId) });

/** Both verified providers upsert the same transaction row. Cancellation retains paid access. */
export const apply = internalMutation({ args: appleEntitlementEvent, returns: v.null(), handler: async (ctx, event) => {
  const receipt = await ctx.db.query('appleBillingEvents').withIndex('by_source_event', q => q.eq('source', event.source).eq('eventId', event.eventId)).unique();
  if (receipt) return null;
  const previous = await ctx.db.query('appleEntitlements').withIndex('by_transaction', q => q.eq('transactionId', event.transactionId)).unique();
  const original = await ctx.db.query('appleEntitlements').withIndex('by_original', q => q.eq('originalTransactionId', event.originalTransactionId)).first();
  if ((previous && previous.ownerId !== event.ownerId) || (original && original.ownerId !== event.ownerId)) throw new ConvexError('App Store subscription already belongs to another account');
  const { eventId, refundReversed, forwardBody, ...fields } = event;
  const staleSequence = event.source === 'superwall' && event.superwallSequence !== undefined && previous?.superwallSequence !== undefined && event.superwallSequence < previous.superwallSequence;
  const staleTime = previous && event.eventAt < previous.eventAt;
  const appleWinsTie = previous?.source === 'apple' && event.source === 'superwall' && event.eventAt === previous.eventAt;
  const newRevocation = event.revokedAt !== undefined && (!previous?.refundReversedAt || event.eventAt > previous.refundReversedAt);
  if (previous && newRevocation && (staleTime || staleSequence || appleWinsTie)) {
    await ctx.db.patch(previous._id, { revokedAt: event.revokedAt, accessUntil: 0, updatedAt: Date.now() });
  }
  if (!staleSequence && !staleTime && !appleWinsTie) {
    // A replayed active receipt or later cancellation cannot undo a refund. Only Apple can reverse it.
    const revokedAt = newRevocation ? event.revokedAt : refundReversed && event.source === 'apple' ? undefined : previous?.revokedAt;
    const value = { ...fields, revokedAt, accessUntil: revokedAt === undefined ? event.accessUntil : 0,
      ...(refundReversed && event.source === 'apple' ? { refundReversedAt: event.eventAt } : previous?.refundReversedAt ? { refundReversedAt: previous.refundReversedAt } : {}),
      ...(event.superwallSequence === undefined && previous?.superwallSequence !== undefined ? { superwallSequence: previous.superwallSequence } : {}), updatedAt: Date.now() };
    if (previous) await ctx.db.replace(previous._id, value);
    else await ctx.db.insert('appleEntitlements', value);
  }
  await ctx.db.insert('appleBillingEvents', { source: event.source, eventId, transactionId: event.transactionId, receivedAt: Date.now() });
  if (event.source === 'apple' && forwardBody && process.env.SUPERWALL_APPLE_NOTIFICATIONS_URL) {
    await ctx.scheduler.runAfter(0, internal.superwallBilling.forwardAppleNotification, { body: forwardBody, attempt: 0 });
  }
  return null;
} });
