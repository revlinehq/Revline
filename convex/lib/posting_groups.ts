import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

// Account groups (convex/postingGroups.ts), read by the posting pages and the assistant's posting tools. Kept apart
// from convex/posting.ts so disconnecting an account can drop it from its groups without a circular import.

export const GROUP_LIMIT = 20, GROUP_NAME_LIMIT = 40, GROUP_ACCOUNT_LIMIT = 20;

export const ownerGroups = (ctx: QueryCtx | MutationCtx, ownerId: string) =>
  ctx.db.query('postingGroups').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect();

/** A group's accounts as they are now: the owner's own, not disconnected, in the group's order. */
export async function groupAccounts(ctx: QueryCtx | MutationCtx, group: Doc<'postingGroups'>) {
  const accounts: Doc<'postingAccounts'>[] = [];
  for (const accountId of group.accountIds) {
    const account = await ctx.db.get(accountId);
    if (account && account.ownerId === group.ownerId && account.status !== 'disconnected') accounts.push(account);
  }
  return accounts;
}

/** A disconnected account leaves every group it was in. */
export async function dropFromGroups(ctx: MutationCtx, ownerId: string, accountId: Id<'postingAccounts'>, now: number) {
  for (const group of await ownerGroups(ctx, ownerId)) {
    if (group.accountIds.includes(accountId)) await ctx.db.patch(group._id, { accountIds: group.accountIds.filter(id => id !== accountId), updatedAt: now });
  }
}

/** The group a name means: exact, ignoring case and surrounding spaces. */
export const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
