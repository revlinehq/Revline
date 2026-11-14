import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { requireOwner } from './lib/auth';
import { GROUP_ACCOUNT_LIMIT, GROUP_LIMIT, GROUP_NAME_LIMIT, groupAccounts, ownerGroups, sameName } from './lib/posting_groups';
import { tableRow } from './lib/exact';

// Account groups: a named set of the signed-in owner's connected accounts, across platforms, picked together when
// posting (the Post dialog, the editor's Post menu, the assistant's confirmation card). Managed on the Connected
// accounts page. Web only; the iOS app does not call these.

const groupView = v.object({ id: v.id('postingGroups'), name: v.string(), isDefault: v.boolean(), accountIds: v.array(v.id('postingAccounts')) });

/** The signed-in owner's groups, oldest first, each with its accounts as they are now (disconnected ones are gone). */
export const list = query({
  args: {}, returns: v.array(groupView),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx), groups = await ownerGroups(ctx, ownerId);
    return Promise.all(groups.map(async group => ({ id: group._id, name: group.name, isDefault: group.isDefault === true, accountIds: (await groupAccounts(ctx, group)).map(account => account._id) })));
  },
});

async function ownedGroup(ctx: MutationCtx, ownerId: string, groupId: Id<'postingGroups'>) {
  const group = await ctx.db.get(groupId);
  if (!group || group.ownerId !== ownerId) throw new ConvexError('Group not found');
  return group;
}

/** A name that is not empty, not too long, and not another of the owner's groups (the assistant finds a group by its name). */
function checkedName(name: string, groups: Doc<'postingGroups'>[], except?: Id<'postingGroups'>) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new ConvexError('Give the group a name.');
  if (trimmed.length > GROUP_NAME_LIMIT) throw new ConvexError(`Keep the group name to ${GROUP_NAME_LIMIT} characters.`);
  if (groups.some(group => group._id !== except && sameName(group.name, trimmed))) throw new ConvexError(`You already have a group called ${trimmed}.`);
  return trimmed;
}

/** Only the owner's own connected accounts, each once. */
async function checkedAccounts(ctx: MutationCtx, ownerId: string, accountIds: Id<'postingAccounts'>[]) {
  const unique = [...new Set(accountIds)];
  if (unique.length > GROUP_ACCOUNT_LIMIT) throw new ConvexError(`A group holds up to ${GROUP_ACCOUNT_LIMIT} accounts.`);
  for (const accountId of unique) {
    const account = await ctx.db.get(accountId);
    if (!account || account.ownerId !== ownerId || account.status === 'disconnected') throw new ConvexError('One of these accounts is no longer connected.');
  }
  return unique;
}

/** A new group, with the next free "Group N" name when none is given. */
export const create = mutation({
  args: { name: v.optional(v.string()), accountIds: v.optional(v.array(v.id('postingAccounts'))) }, returns: v.id('postingGroups'),
  handler: async (ctx, { name, accountIds }) => {
    const ownerId = await requireOwner(ctx), groups = await ownerGroups(ctx, ownerId), now = Date.now();
    if (groups.length >= GROUP_LIMIT) throw new ConvexError(`You can have up to ${GROUP_LIMIT} groups.`);
    let fallback = groups.length + 1;
    while (groups.some(group => sameName(group.name, `Group ${fallback}`))) fallback++;
    return ctx.db.insert('postingGroups', tableRow<'postingGroups'>()({
      ownerId, name: checkedName(name ?? `Group ${fallback}`, groups), accountIds: await checkedAccounts(ctx, ownerId, accountIds ?? []),
      createdAt: now, updatedAt: now,
    }));
  },
});

export const rename = mutation({
  args: { groupId: v.id('postingGroups'), name: v.string() }, returns: v.null(),
  handler: async (ctx, { groupId, name }) => {
    const ownerId = await requireOwner(ctx), group = await ownedGroup(ctx, ownerId, groupId);
    await ctx.db.patch(group._id, { name: checkedName(name, await ownerGroups(ctx, ownerId), group._id), updatedAt: Date.now() });
    return null;
  },
});

/** Put an account in a group or take it out. Taking it out does not disconnect it. */
export const setMember = mutation({
  args: { groupId: v.id('postingGroups'), accountId: v.id('postingAccounts'), member: v.boolean() }, returns: v.null(),
  handler: async (ctx, { groupId, accountId, member }) => {
    const ownerId = await requireOwner(ctx), group = await ownedGroup(ctx, ownerId, groupId);
    const current = (await groupAccounts(ctx, group)).map(account => account._id);
    const next = member ? (current.includes(accountId) ? current : [...current, accountId]) : current.filter(id => id !== accountId);
    await ctx.db.patch(group._id, { accountIds: await checkedAccounts(ctx, ownerId, next), updatedAt: Date.now() });
    return null;
  },
});

/** A copy with the same accounts, named "<name> copy" (or "copy 2", …). Never the default. */
export const duplicate = mutation({
  args: { groupId: v.id('postingGroups') }, returns: v.id('postingGroups'),
  handler: async (ctx, { groupId }) => {
    const ownerId = await requireOwner(ctx), group = await ownedGroup(ctx, ownerId, groupId), groups = await ownerGroups(ctx, ownerId), now = Date.now();
    if (groups.length >= GROUP_LIMIT) throw new ConvexError(`You can have up to ${GROUP_LIMIT} groups.`);
    // Room for " copy 99" within the limit, with the cut never leaving a trailing space.
    const base = `${group.name.slice(0, GROUP_NAME_LIMIT - 8).trim()} copy`;
    let name = base;
    for (let count = 2; groups.some(other => sameName(other.name, name)); count++) name = `${base} ${count}`;
    return ctx.db.insert('postingGroups', tableRow<'postingGroups'>()({ ownerId, name: checkedName(name, groups), accountIds: (await groupAccounts(ctx, group)).map(account => account._id), createdAt: now, updatedAt: now }));
  },
});

/** Delete a group. Its accounts stay connected and in their other groups. */
export const remove = mutation({
  args: { groupId: v.id('postingGroups') }, returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const group = await ownedGroup(ctx, await requireOwner(ctx), groupId);
    await ctx.db.delete(group._id);
    return null;
  },
});

/** Star a group as the default (the assistant posts to it when the user names no accounts), or clear the star with null. */
export const setDefault = mutation({
  args: { groupId: v.union(v.id('postingGroups'), v.null()) }, returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const ownerId = await requireOwner(ctx), now = Date.now();
    if (groupId) await ownedGroup(ctx, ownerId, groupId);
    for (const group of await ownerGroups(ctx, ownerId)) {
      const isDefault = group._id === groupId;
      if ((group.isDefault === true) !== isDefault) await ctx.db.patch(group._id, { isDefault: isDefault || undefined, updatedAt: now });
    }
    return null;
  },
});
