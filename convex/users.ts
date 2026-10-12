import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireOwner } from './lib/auth';
import { userDocument } from './schema';

/** ViralShark's profile repair pattern, using only the verified Clerk JWT. */
export const store = mutation({
  args: {},
  returns: v.id('users'),
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError('Authentication required');
    const existing = await ctx.db.query('users').withIndex('by_clerk_id', q => q.eq('clerkId', identity.subject)).unique();
    // Missing claims must not erase details stored by an earlier verified token.
    const profile = {
      ...(identity.email !== undefined ? { email: identity.email } : {}),
      ...(identity.name !== undefined ? { name: identity.name } : {}),
      ...(identity.pictureUrl !== undefined ? { imageUrl: identity.pictureUrl } : {}),
    };
    if (existing) {
      const changed = Object.entries(profile).some(([key, value]) => existing[key as keyof typeof profile] !== value);
      if (changed) await ctx.db.patch(existing._id, { ...profile, updatedAt: Date.now() });
      return existing._id;
    }
    const now = Date.now();
    return await ctx.db.insert('users', { clerkId: identity.subject, ...profile, createdAt: now, updatedAt: now });
  },
});

export const current = query({
  args: {},
  returns: v.union(userDocument, v.null()),
  handler: async ctx => {
    const clerkId = await requireOwner(ctx);
    return await ctx.db.query('users').withIndex('by_clerk_id', q => q.eq('clerkId', clerkId)).unique();
  },
});

/** Private Clerk lifecycle hook; profile removal does not delete owned projects. */
export const removeFromClerk = internalMutation({
  args: { clerkId: v.string() },
  returns: v.null(),
  handler: async (ctx, { clerkId }) => {
    const existing = await ctx.db.query('users').withIndex('by_clerk_id', q => q.eq('clerkId', clerkId)).unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
