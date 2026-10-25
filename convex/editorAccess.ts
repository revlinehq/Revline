import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { hasComplimentaryEditorAccess } from './lib/billing_access';

// Administrative operations only. Never expose grants to an authenticated client.
// Resolve and verify the production Clerk account before supplying its subject.
export const grantComplimentary = internalMutation({
  args: { ownerId: v.string(), reason: v.string(), expiresAt: v.optional(v.number()) },
  returns: v.id('editorEntitlements'),
  handler: async (ctx, { ownerId, reason, expiresAt }) => {
    if (!/^user_[A-Za-z0-9]+$/.test(ownerId)) throw new ConvexError('A verified Clerk user ID is required');
    if (!reason.trim()) throw new ConvexError('A grant reason is required');
    const now = Date.now();
    if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= now)) throw new ConvexError('Expiration must be in the future');
    const previous = await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
    // A renewed grant keeps its plan; setPlan alone changes Ultra.
    const fields = { ownerId, reason: reason.trim(), grantedAt: now, updatedAt: now, ...(expiresAt !== undefined ? { expiresAt } : {}), ...(previous?.plan ? { plan: previous.plan } : {}) };
    if (previous) {
      await ctx.db.replace(previous._id, fields);
      return previous._id;
    }
    return await ctx.db.insert('editorEntitlements', fields);
  },
});

/** Operator-only: set or clear the Ultra plan on an existing complimentary grant. */
export const setPlan = internalMutation({
  args: { ownerId: v.string(), plan: v.union(v.literal('ultra'), v.null()) }, returns: v.null(),
  handler: async (ctx, { ownerId, plan }) => {
    const entitlement = await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
    if (!entitlement || !await hasComplimentaryEditorAccess(ctx, ownerId)) throw new ConvexError('Ultra needs an active complimentary grant for this account first');
    await ctx.db.patch(entitlement._id, { plan: plan ?? undefined, updatedAt: Date.now() });
    return null;
  },
});

export const revokeComplimentary = internalMutation({
  args: { ownerId: v.string() }, returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    const entitlement = await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
    if (entitlement && entitlement.revokedAt === undefined) {
      const now = Date.now();
      await ctx.db.patch(entitlement._id, { revokedAt: now, updatedAt: now });
    }
    return null;
  },
});

export const hasComplimentary = internalQuery({
  args: { ownerId: v.string() }, returns: v.boolean(),
  handler: async (ctx, { ownerId }) => await hasComplimentaryEditorAccess(ctx, ownerId),
});

export const complimentaryStatus = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(v.object({ active: v.boolean(), grantedAt: v.number(), expiresAt: v.optional(v.number()), revokedAt: v.optional(v.number()), reason: v.string(), plan: v.optional(v.literal('ultra')) }), v.null()),
  handler: async (ctx, { ownerId }) => {
    const entitlement = await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
    if (!entitlement) return null;
    return { active: await hasComplimentaryEditorAccess(ctx, ownerId), grantedAt: entitlement.grantedAt, reason: entitlement.reason, ...(entitlement.plan ? { plan: entitlement.plan } : {}), ...(entitlement.expiresAt !== undefined ? { expiresAt: entitlement.expiresAt } : {}), ...(entitlement.revokedAt !== undefined ? { revokedAt: entitlement.revokedAt } : {}) };
  },
});
