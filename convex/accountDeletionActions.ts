'use node';

import { createClerkClient } from '@clerk/backend';
import { StripeSubscriptions } from '@convex-dev/stripe';
import { isClerkAPIResponseError } from '@clerk/shared/error';
import { ConvexError, v } from 'convex/values';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { components, internal } from './_generated/api';
import { revokeAppleAccount } from './lib/apple_account_revocation';
import { editorSubscriptions } from './lib/billing_access';

async function stopOwnedWebRenewals(ctx: ActionCtx, ownerId: string) {
  const subscriptions = await editorSubscriptions(ctx, ownerId);
  for (const subscription of subscriptions) {
    if (subscription.cancelAtPeriodEnd || ['canceled', 'incomplete_expired'].includes(subscription.status)) continue;
    await new StripeSubscriptions(components.stripe, {}).cancelSubscription(ctx, {
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      cancelAtPeriodEnd: !['incomplete', 'paused'].includes(subscription.status),
    });
  }
}

export const stopWebRenewals = internalAction({
  args: { ownerId: v.string() }, returns: v.null(),
  handler: async (ctx, { ownerId }): Promise<null> => {
    await stopOwnedWebRenewals(ctx, ownerId);
    return null;
  },
});

export const remove = action({ args: { policyVersion: v.literal(1), confirmation: v.literal('DELETE'), appleAuthorizationCode: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError('Sign in again before deleting your account.');
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new ConvexError('Account deletion is temporarily unavailable. Please contact support.');
  const ownerId = identity.subject;
  const clerk=createClerkClient({secretKey});
  // Verify the configured Clerk instance owns this subject before making a destructive request.
  const user = await clerk.users.getUser(ownerId);
  const appleAccounts = user.externalAccounts.filter(account => account.provider === 'oauth_apple' || account.provider === 'apple');
  if (appleAccounts.length) await revokeAppleAccount(args.appleAuthorizationCode, appleAccounts.map(account => account.externalId));
  try { await stopOwnedWebRenewals(ctx, ownerId); }
  catch { throw new ConvexError('Your web membership could not be stopped. Try again before deleting your account.'); }
  await ctx.runMutation(internal.accountDeletion.prepare, { ownerId });
  try {
    await clerk.users.deleteUser(ownerId);
  } catch (error) {
    if (!isClerkAPIResponseError(error) || error.status !== 404) {
      await ctx.runMutation(internal.accountDeletion.abort, { ownerId });
      throw new ConvexError('The account could not be deleted. Sign in again and retry.');
    }
  }
  // The account is gone, so Revline's access to its connected social accounts ends too: each is revoked at its
  // platform before the rows are swept. This waits at most a few seconds per platform (they run together); one
  // that fails or does not answer is logged and the deletion goes on.
  try { await ctx.runAction(internal.postingActions.revokeOwner, { ownerId }); }
  catch { console.warn('Account deletion: connected social accounts could not be revoked at their platforms; their tokens are deleted with the account.'); }
  await ctx.runMutation(internal.accountDeletion.activate, { ownerId });
  return null;
} });
