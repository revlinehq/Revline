import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireOwner } from './lib/auth';
import { mediaUrl } from './lib/media_storage';
import { exportFileName } from './renders';
import { accountStatus, postingPlatform, postStatus, postVisibility, tiktokChoices, tiktokVisibility, youtubeVisibility } from './postingTables';
import { dimensions, timelineDuration, type Timeline } from '../lib/editor/types';
import { POSTING_PLATFORMS } from '../lib/posting/platform-names';
import { CAPTION_LIMIT, MAX_ATTEMPTS, TITLE_LIMIT } from '../lib/posting/limits';
import { livePlatform } from '../lib/posting/server';
import { YOUTUBE_FIRST_VISIBILITY, isTikTokVisibility, isYouTubeVisibility, type YouTubeVisibility } from '../lib/posting/visibility';

// The posting base: connected social accounts, posts to them, and the scheduler state machine.
// Network work (OAuth, publishing, stats) lives in postingActions.ts; every state change is a mutation here,
// so a post moves `scheduled -> posting -> processing? -> published | failed` in single transactions.

const TARGET_LIMIT = 50, ERROR_LIMIT = 500;
const SCHEDULE_HORIZON_MS = 90 * 86400_000;
/** A post still `posting` after this long lost its action; it is failed rather than re-sent, which could post twice. */
const STALE_POSTING_MS = 20 * 60_000;
const PROCESSING_LIMIT_MS = 24 * 3600_000, PROCESSING_POLL_MS = 4 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
/**
 * Waits between the quick checks of a post the platform just accepted: about 15 s, 45 s, 2 min and 4 min after it.
 * Most uploads finish processing within these, so "Posting" does not sit until the next tick; after them the tick polls.
 */
const QUICK_CHECK_DELAYS_MS = [15_000, 30_000, 75_000, 120_000];
/** How long the tick leaves a post alone once a quick check starts: longer than the longest check (a YouTube upload that resumes inside it), so the two never poll the same post at once. */
const QUICK_CHECK_LEASE_MS = 8 * 60_000;
/** A disconnect removes the tokens once the platform was asked to revoke them; this removes them if that never ran. */
const PURGE_FALLBACK_MS = 2 * 60_000;
export const STATS_WINDOW_MS = 30 * 86400_000;

const INTERRUPTED = 'Posting was interrupted before the platform confirmed it. Check the account first, then retry if the video is not there.';

async function ownedAccount(ctx: QueryCtx | MutationCtx, ownerId: string, accountId: Id<'postingAccounts'>) {
  const account = await ctx.db.get(accountId);
  if (!account || account.ownerId !== ownerId || account.status === 'disconnected') throw new ConvexError('Account not found');
  return account;
}
async function ownedPost(ctx: QueryCtx | MutationCtx, ownerId: string, postId: Id<'postingPosts'>) {
  const post = await ctx.db.get(postId);
  if (!post || post.ownerId !== ownerId) throw new ConvexError('Post not found');
  return post;
}
const optional = <T,>(value: T | undefined) => value ?? null;
/** Accounts without a saved picture are asked for one again this often, when their tokens are renewed. */
const AVATAR_RECHECK_MS = 7 * 86400_000;
/** An account's picture: Revline's saved copy, or the platform's own URL (which can expire) for an account connected before pictures were saved. */
async function accountPicture(ctx: QueryCtx, account: Doc<'postingAccounts'> | null | undefined) {
  return (account?.avatarStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : null) ?? account?.avatarUrl ?? null;
}

// ---------------------------------------------------------------- platforms and accounts

/** Which platforms can be connected right now. A platform turns on by itself once its adapter and credentials exist. */
export const platforms = query({
  args: {}, returns: v.array(v.object({ platform: postingPlatform, live: v.boolean() })),
  handler: async ctx => {
    await requireOwner(ctx);
    return POSTING_PLATFORMS.map(platform => ({ platform, live: !!livePlatform(platform) }));
  },
});

const accountView = v.object({
  id: v.id('postingAccounts'), platform: postingPlatform, username: v.string(), displayName: v.union(v.string(), v.null()), avatarUrl: v.union(v.string(), v.null()),
  status: accountStatus, error: v.union(v.string(), v.null()), connectedAt: v.number(),
});
/** The signed-in owner's connected accounts. Tokens are never part of this. */
export const accounts = query({
  args: {}, returns: v.array(accountView),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db.query('postingAccounts').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect();
    return Promise.all(rows.filter(row => row.status !== 'disconnected').map(async row => ({
      id: row._id, platform: row.platform, username: row.username, displayName: optional(row.displayName), avatarUrl: await accountPicture(ctx, row),
      status: row.status, error: optional(row.error), connectedAt: row.createdAt,
    })));
  },
});
/**
 * The picture Revline shows for the signed-in person: the saved picture of their earliest connected account that
 * has one, or null (the app then shows their sign-in photo or initials).
 */
export const profilePicture = query({
  args: {}, returns: v.union(v.string(), v.null()),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db.query('postingAccounts').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect();
    for (const row of rows.filter(row => row.status !== 'disconnected' && row.avatarStorageId).sort((a, b) => a.createdAt - b.createdAt)) {
      const url = await ctx.storage.getUrl(row.avatarStorageId!);
      if (url) return url;
    }
    return null;
  },
});

/** Stop using an account: it reads as disconnected at once and posts still waiting for it fail. Its tokens are removed by `purgeTokens`. */
async function markDisconnected(ctx: MutationCtx, account: Doc<'postingAccounts'>, now: number) {
  if (account.avatarStorageId) await ctx.storage.delete(account.avatarStorageId);
  await ctx.db.patch(account._id, { status: 'disconnected', tokenExpiresAt: undefined, refreshLeaseUntil: undefined, error: undefined, avatarStorageId: undefined, avatarCheckedAt: undefined, updatedAt: now });
  const waiting = await ctx.db.query('postingPosts').withIndex('by_account_status', q => q.eq('accountId', account._id).eq('status', 'scheduled')).collect();
  for (const post of waiting) await ctx.db.patch(post._id, { status: 'failed', error: 'This account was disconnected before the post went out.', updatedAt: now });
}
/**
 * Disconnect an account: Revline's access is revoked at the platform, then its tokens are deleted here. The account
 * is gone for the user at once; a platform that fails or does not answer never keeps the tokens from being deleted.
 * Its published posts stay in the history; posts still waiting for it fail.
 */
export const disconnect = mutation({
  args: { accountId: v.id('postingAccounts') }, returns: v.null(),
  handler: async (ctx, { accountId }) => {
    const ownerId = await requireOwner(ctx), account = await ownedAccount(ctx, ownerId, accountId);
    await markDisconnected(ctx, account, Date.now());
    await ctx.scheduler.runAfter(0, internal.postingActions.revokeAccount, { accountId });
    // The action deletes the tokens when it ends. Should it never run, they are deleted here all the same.
    await ctx.scheduler.runAfter(PURGE_FALLBACK_MS, internal.posting.purgeTokens, { accountId });
    return null;
  },
});
/** Delete a disconnected account's tokens. A reconnect in the meantime stored new ones, which stay. */
export const purgeTokens = internalMutation({
  args: { accountId: v.id('postingAccounts') }, returns: v.null(),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    if (account?.status === 'disconnected' && account.tokenCipher !== undefined) await ctx.db.patch(accountId, { tokenCipher: undefined, updatedAt: Date.now() });
    return null;
  },
});
/** Deleting a Revline account disconnects every account it connected. Returns the ones whose access is still to be revoked. */
export const disconnectOwner = internalMutation({
  args: { ownerId: v.string() }, returns: v.array(v.id('postingAccounts')),
  handler: async (ctx, { ownerId }) => {
    const now = Date.now(), accounts = (await ctx.db.query('postingAccounts').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect()).filter(account => account.tokenCipher !== undefined);
    // No fallback purge here: the rows themselves are removed with the account.
    for (const account of accounts) if (account.status !== 'disconnected') await markDisconnected(ctx, account, now);
    return accounts.map(account => account._id);
  },
});
/** A connected TikTok account of the signed-in owner, checked before its posting settings are read for the Post dialog. */
export const ownedTikTok = internalQuery({
  args: { accountId: v.id('postingAccounts') }, returns: v.null(),
  handler: async (ctx, { accountId }) => {
    const account = await ownedAccount(ctx, await requireOwner(ctx), accountId);
    if (account.platform !== 'tiktok' || account.status !== 'connected') throw new ConvexError('Account not found');
    return null;
  },
});

// ---------------------------------------------------------------- connect (OAuth) state

export const createOauthState = internalMutation({
  args: { platform: postingPlatform }, returns: v.string(),
  handler: async (ctx, { platform }) => {
    const ownerId = await requireOwner(ctx);
    if (!livePlatform(platform)) throw new ConvexError('This platform is coming soon.');
    const nonce = crypto.randomUUID().replaceAll('-', '');
    await ctx.db.insert('postingOauthStates', { nonce, ownerId, platform, expiresAt: Date.now() + 15 * 60_000 });
    return nonce;
  },
});
/**
 * Single use: the row is deleted whether or not it was still valid. Only the signed-in owner who started the
 * connection can finish it, so a consent link sent to someone else cannot attach their account to the sender.
 */
export const consumeOauthState = internalMutation({
  args: { nonce: v.string() }, returns: v.union(v.object({ ownerId: v.string(), platform: postingPlatform }), v.null()),
  handler: async (ctx, { nonce }) => {
    const ownerId = await requireOwner(ctx);
    const row = await ctx.db.query('postingOauthStates').withIndex('by_nonce', q => q.eq('nonce', nonce)).first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.ownerId === ownerId && row.expiresAt > Date.now() ? { ownerId, platform: row.platform } : null;
  },
});
export const saveAccount = internalMutation({
  args: {
    ownerId: v.string(), platform: postingPlatform, platformAccountId: v.string(), username: v.string(), displayName: v.optional(v.string()), avatarUrl: v.optional(v.string()),
    avatarStorageId: v.optional(v.id('_storage')), tokenCipher: v.string(), tokenExpiresAt: v.optional(v.number()), scopes: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { ownerId, platform, platformAccountId, ...fields }) => {
    const now = Date.now(), current = await ctx.db.query('postingAccounts').withIndex('by_owner_platform_account', q => q.eq('ownerId', ownerId).eq('platform', platform).eq('platformAccountId', platformAccountId)).unique();
    const values = { ...fields, status: 'connected' as const, error: undefined, refreshLeaseUntil: undefined, updatedAt: now };
    // A new picture replaces the saved one; a reconnect whose picture could not be downloaded keeps the one it had.
    if (current?.avatarStorageId && fields.avatarStorageId) await ctx.storage.delete(current.avatarStorageId);
    // Reconnecting keeps the row, so the account's post history and stats stay attached.
    if (current) await ctx.db.replace(current._id, { ownerId, platform, platformAccountId, createdAt: current.createdAt, ...values, avatarStorageId: fields.avatarStorageId ?? current.avatarStorageId });
    else await ctx.db.insert('postingAccounts', { ownerId, platform, platformAccountId, createdAt: now, ...values });
    return null;
  },
});

// ---------------------------------------------------------------- account tokens (server only)

export const accountSecret = internalQuery({
  args: { accountId: v.id('postingAccounts') },
  returns: v.union(v.object({ platform: postingPlatform, status: accountStatus, tokenCipher: v.union(v.string(), v.null()), refreshing: v.boolean() }), v.null()),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    return account ? { platform: account.platform, status: account.status, tokenCipher: optional(account.tokenCipher), refreshing: (account.refreshLeaseUntil ?? 0) > Date.now() } : null;
  },
});
/** True when the caller may refresh this account's tokens now; false while another action is doing it. */
export const leaseRefresh = internalMutation({
  args: { accountId: v.id('postingAccounts') }, returns: v.boolean(),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId), now = Date.now();
    if (!account || account.status !== 'connected' || (account.refreshLeaseUntil ?? 0) > now) return false;
    await ctx.db.patch(accountId, { refreshLeaseUntil: now + 60_000 });
    return true;
  },
});
export const saveTokens = internalMutation({
  args: { accountId: v.id('postingAccounts'), tokenCipher: v.string(), tokenExpiresAt: v.optional(v.number()), scopes: v.array(v.string()) }, returns: v.null(),
  handler: async (ctx, { accountId, ...tokens }) => {
    const account = await ctx.db.get(accountId);
    // A disconnect during the refresh wins: the new tokens are dropped.
    if (account?.status !== 'connected') return null;
    const now = Date.now();
    // An account with no saved picture (connected before pictures were saved, or its download failed) gets one now that its tokens work.
    const fill = !account.avatarStorageId && (account.avatarCheckedAt ?? 0) < now - AVATAR_RECHECK_MS;
    await ctx.db.patch(accountId, { ...tokens, tokenExpiresAt: tokens.tokenExpiresAt, refreshLeaseUntil: undefined, ...(fill ? { avatarCheckedAt: now } : {}), updatedAt: now });
    if (fill) await ctx.scheduler.runAfter(0, internal.postingActions.fillAvatar, { accountId, platform: account.platform });
    return null;
  },
});
/**
 * Store a picture downloaded for an account that had none, with the name read in the same profile call.
 * A disconnect meanwhile wins: the file is dropped.
 */
export const saveAvatar = internalMutation({
  args: { accountId: v.id('postingAccounts'), username: v.string(), avatarUrl: v.string(), avatarStorageId: v.id('_storage') }, returns: v.null(),
  handler: async (ctx, { accountId, username, avatarUrl, avatarStorageId }) => {
    const account = await ctx.db.get(accountId);
    if (!account || account.status === 'disconnected') { await ctx.storage.delete(avatarStorageId); return null; }
    if (account.avatarStorageId) await ctx.storage.delete(account.avatarStorageId);
    await ctx.db.patch(accountId, { username, avatarUrl, avatarStorageId, avatarCheckedAt: Date.now() });
    return null;
  },
});
/** The refresh did not produce tokens. `reconnect` marks the account as needing the user to connect it again. */
export const refreshFailed = internalMutation({
  args: { accountId: v.id('postingAccounts'), reconnect: v.boolean(), error: v.string() }, returns: v.null(),
  handler: async (ctx, { accountId, reconnect, error }) => {
    const account = await ctx.db.get(accountId);
    if (account?.status === 'connected') await ctx.db.patch(accountId, { refreshLeaseUntil: undefined, ...(reconnect ? { status: 'needs_reconnect' as const, error: error.slice(0, ERROR_LIMIT) } : {}), updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------- creating posts

/** The finished export a post sends, or the reason it cannot be posted. Only completed Revline exports qualify. */
async function postableExport(ctx: QueryCtx | MutationCtx, ownerId: string, jobId: Id<'renderJobs'>) {
  const job = await ctx.db.get(jobId);
  if (!job || job.ownerId !== ownerId) return { job: null, error: 'The export was deleted before it could be posted.' };
  if (job.status !== 'completed' || !job.outputR2Key && !job.outputStorageId) return { job: null, error: 'Only a finished export can be posted.' };
  return { job, error: '' };
}

/**
 * Post one finished export to several accounts, now or at `scheduledAt`. One post per target account, grouped by the
 * returned batch. "Now" is the scheduled path with the time set to now.
 */
export const createBatch = mutation({
  args: {
    jobId: v.id('renderJobs'), caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()), campaignId: v.optional(v.string()),
    targets: v.array(v.object({
      accountId: v.id('postingAccounts'), caption: v.optional(v.string()), title: v.optional(v.string()),
      /** Who can view this account's post, and TikTok's per-post settings. Instagram ignores both. */
      visibility: v.optional(postVisibility), tiktok: v.optional(tiktokChoices),
    })),
  },
  returns: v.id('postingBatches'),
  handler: async (ctx, args) => createBatchFor(ctx, await requireOwner(ctx), args),
});
export type BatchInput = {
  jobId: Id<'renderJobs'>; caption: string; title?: string; scheduledAt?: number; campaignId?: string;
  targets: { accountId: Id<'postingAccounts'>; caption?: string; title?: string; visibility?: Doc<'postingPosts'>['visibility']; tiktok?: Doc<'postingPosts'>['tiktok'] }[];
};
/** The visibility of the owner's most recent YouTube post that carries one: the Post dialog's last-used value. "Public" before any. */
async function lastYouTubeVisibility(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<YouTubeVisibility> {
  // Every YouTube post made since the choice exists carries one, so the newest row answers; older rows are skipped.
  const recent = await ctx.db.query('postingPosts').withIndex('by_owner_platform', q => q.eq('ownerId', ownerId).eq('platform', 'youtube')).order('desc').take(20);
  const last = recent.find(post => post.visibility !== undefined)?.visibility;
  return isYouTubeVisibility(last) ? last : YOUTUBE_FIRST_VISIBILITY;
}
/** What the Post dialog starts from: the YouTube visibility this owner used last. TikTok never has a default. */
export const lastVisibility = query({
  args: {}, returns: v.object({ youtube: youtubeVisibility }),
  handler: async ctx => ({ youtube: await lastYouTubeVisibility(ctx, await requireOwner(ctx)) }),
});
/**
 * The choices one post stores, checked against what its platform takes. A YouTube post without a choice (a post
 * from the editor) uses the owner's last one. A TikTok post without one is sent by the adapter as "Only me" with
 * interactions off. Instagram has no per-post privacy, so nothing is stored for it.
 */
async function postChoices(platform: Doc<'postingPosts'>['platform'], target: BatchInput['targets'][number], lastYouTube: () => Promise<YouTubeVisibility>): Promise<Pick<Doc<'postingPosts'>, 'visibility' | 'tiktok'>> {
  if (platform === 'youtube') {
    if (target.visibility !== undefined && !isYouTubeVisibility(target.visibility)) throw new ConvexError('Pick Public, Unlisted or Private for YouTube.');
    return { visibility: target.visibility ?? await lastYouTube() };
  }
  if (platform !== 'tiktok') return {};
  if (target.visibility !== undefined && !isTikTokVisibility(target.visibility)) throw new ConvexError('Pick who can view the TikTok post.');
  // Without a choice the adapter posts as "Only me", so branded content needs a wider one stated.
  if (target.tiktok?.brandedContent && (target.visibility ?? 'SELF_ONLY') === 'SELF_ONLY') throw new ConvexError('Branded content cannot be posted as "Only me" on TikTok.');
  // Only what was switched on is stored: absent means off.
  const on = Object.fromEntries(Object.entries(target.tiktok ?? {}).filter(([, value]) => value === true));
  return { ...(target.visibility ? { visibility: target.visibility } : {}), ...(Object.keys(on).length ? { tiktok: on } : {}) };
}
/** The checks a post's text and time must pass, shared by `createBatch` and a post that waits for its export. */
const text = (value: string | undefined, limit: number, name: string) => {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length > limit) throw new ConvexError(`${name} can be up to ${limit} characters.`);
  return trimmed || undefined;
};
export function batchText(args: Pick<BatchInput, 'caption' | 'title' | 'scheduledAt' | 'campaignId'>, now: number) {
  const caption = text(args.caption, CAPTION_LIMIT, 'A caption') ?? '', title = text(args.title, TITLE_LIMIT, 'A title');
  if (args.scheduledAt !== undefined && (!Number.isFinite(args.scheduledAt) || args.scheduledAt < now - 60_000 || args.scheduledAt > now + SCHEDULE_HORIZON_MS)) throw new ConvexError('Pick a time in the next 90 days.');
  if (args.campaignId !== undefined && (!args.campaignId || args.campaignId.length > 200)) throw new ConvexError('Campaign not found');
  return { caption, title };
}
/** `createBatch` for an owner already identified: also what a post waiting for its export runs when the export completes. */
export async function createBatchFor(ctx: MutationCtx, ownerId: string, args: BatchInput) {
  const now = Date.now();
  if (!args.targets.length) throw new ConvexError('Pick at least one account.');
  if (args.targets.length > TARGET_LIMIT || new Set(args.targets.map(target => target.accountId)).size !== args.targets.length) throw new ConvexError(`Pick up to ${TARGET_LIMIT} different accounts.`);
  const { caption, title } = batchText(args, now);
  const found = await postableExport(ctx, ownerId, args.jobId);
  if (!found.job) throw new ConvexError(found.error);
  const project = await ctx.db.get(found.job.projectId);
  const scheduledAt = args.scheduledAt !== undefined && args.scheduledAt > now ? args.scheduledAt : undefined, dueAt = scheduledAt ?? now;
  const batchId = await ctx.db.insert('postingBatches', {
    ownerId, jobId: found.job._id, projectId: found.job.projectId, exportLabel: exportFileName(project?.title ?? 'Video', found.job.label).replace(/\.mp4$/, ''),
    caption, ...(title ? { title } : {}), ...(scheduledAt ? { scheduledAt } : {}), ...(args.campaignId ? { campaignId: args.campaignId } : {}), createdAt: now,
  });
  let remembered: YouTubeVisibility | undefined;
  const lastYouTube = async () => remembered ??= await lastYouTubeVisibility(ctx, ownerId);
  for (const target of args.targets) {
    const account = await ownedAccount(ctx, ownerId, target.accountId);
    if (account.status !== 'connected') throw new ConvexError(`Reconnect @${account.username} before posting to it.`);
    const own = text(target.caption, CAPTION_LIMIT, 'A caption'), ownTitle = text(target.title, TITLE_LIMIT, 'A title') ?? title;
    const postId = await ctx.db.insert('postingPosts', {
      ownerId, batchId, accountId: account._id, platform: account.platform, jobId: found.job._id, caption: own ?? caption, ...(ownTitle ? { title: ownTitle } : {}),
      ...await postChoices(account.platform, target, lastYouTube), status: 'scheduled', attempts: 0, ...(scheduledAt ? { scheduledAt } : {}), dueAt, ...(args.campaignId ? { campaignId: args.campaignId } : {}), createdAt: now, updatedAt: now,
    });
    // "Post now" does not wait for the next scheduler tick.
    if (!scheduledAt) await ctx.scheduler.runAfter(0, internal.postingActions.runPost, { postId });
  }
  return batchId;
}

/** Try a failed post again from a clean attempt count. */
export const retry = mutation({
  args: { postId: v.id('postingPosts') }, returns: v.null(),
  handler: async (ctx, { postId }) => {
    const ownerId = await requireOwner(ctx), post = await ownedPost(ctx, ownerId, postId), now = Date.now();
    if (post.status !== 'failed') throw new ConvexError('Only a failed post can be retried.');
    const account = await ctx.db.get(post.accountId);
    if (!account || account.status !== 'connected') throw new ConvexError('Reconnect this account before retrying.');
    await ctx.db.patch(postId, { status: 'scheduled', attempts: 0, error: undefined, dueAt: now, claimedAt: undefined, platformJobId: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.postingActions.runPost, { postId });
    return null;
  },
});
/** Remove a post that has not started. */
export const cancel = mutation({
  args: { postId: v.id('postingPosts') }, returns: v.null(),
  handler: async (ctx, { postId }) => {
    const ownerId = await requireOwner(ctx), post = await ownedPost(ctx, ownerId, postId);
    if (post.status !== 'scheduled') throw new ConvexError('This post has already started.');
    await ctx.db.delete(postId);
    return null;
  },
});

// ---------------------------------------------------------------- reading posts

const postView = v.object({
  id: v.id('postingPosts'), batchId: v.id('postingBatches'), platform: postingPlatform, username: v.string(), exportLabel: v.string(),
  caption: v.string(), title: v.union(v.string(), v.null()), status: postStatus, error: v.union(v.string(), v.null()), attempts: v.number(),
  scheduledAt: v.union(v.number(), v.null()), dueAt: v.number(), url: v.union(v.string(), v.null()), publishedAt: v.union(v.number(), v.null()),
  campaignId: v.union(v.string(), v.null()), views: v.union(v.number(), v.null()), likes: v.union(v.number(), v.null()), comments: v.union(v.number(), v.null()),
  createdAt: v.number(),
});
/** The owner's most recent posts in every state, newest first. */
export const posts = query({
  args: {}, returns: v.array(postView),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db.query('postingPosts').withIndex('by_owner_createdAt', q => q.eq('ownerId', ownerId)).order('desc').take(200);
    const accountsById = new Map<string, Doc<'postingAccounts'> | null>(), batches = new Map<string, Doc<'postingBatches'> | null>();
    for (const row of rows) {
      if (!accountsById.has(row.accountId)) accountsById.set(row.accountId, await ctx.db.get(row.accountId));
      if (!batches.has(row.batchId)) batches.set(row.batchId, await ctx.db.get(row.batchId));
    }
    return rows.map(row => ({
      id: row._id, batchId: row.batchId, platform: row.platform, username: accountsById.get(row.accountId)?.username ?? 'removed account', exportLabel: batches.get(row.batchId)?.exportLabel ?? 'Video',
      caption: row.caption, title: optional(row.title), status: row.status, error: optional(row.error), attempts: row.attempts,
      scheduledAt: optional(row.scheduledAt), dueAt: row.dueAt, url: optional(row.url), publishedAt: optional(row.publishedAt),
      campaignId: optional(row.campaignId), views: optional(row.views), likes: optional(row.likes), comments: optional(row.comments), createdAt: row.createdAt,
    }));
  },
});

/**
 * The live post URLs of one batch. For a batch linked to a campaign the UI shows them as a
 * "paste these links into Content Rewards" checklist; submitting there is manual.
 */
export const batchLinks = query({
  args: { batchId: v.id('postingBatches') },
  returns: v.object({ campaignId: v.union(v.string(), v.null()), total: v.number(), links: v.array(v.object({ postId: v.id('postingPosts'), platform: postingPlatform, username: v.string(), url: v.string() })) }),
  handler: async (ctx, { batchId }) => {
    const ownerId = await requireOwner(ctx), batch = await ctx.db.get(batchId);
    if (!batch || batch.ownerId !== ownerId) throw new ConvexError('Posts not found');
    const rows = await ctx.db.query('postingPosts').withIndex('by_batch', q => q.eq('batchId', batchId)).collect();
    const links = [];
    for (const row of rows) if (row.status === 'published' && row.url) links.push({ postId: row._id, platform: row.platform, username: (await ctx.db.get(row.accountId))?.username ?? 'removed account', url: row.url });
    return { campaignId: optional(batch.campaignId), total: rows.length, links };
  },
});

// ---------------------------------------------------------------- posts as clips (the Posts page and the Post dialog)

const cover = { coverUrl: v.union(v.string(), v.null()), coverKind: v.union(v.literal('video'), v.literal('image'), v.null()) };
/** An export has no picture of its own, so a clip shows the cover of the project it was exported from. */
async function projectCover(ctx: QueryCtx, projectId: Id<'projects'>) {
  const row = await ctx.db.query('projectCatalog').withIndex('by_project', q => q.eq('projectId', projectId)).first();
  const coverUrl = row ? await mediaUrl(ctx, { storageId: row.coverStorageId, r2Key: row.coverR2Key }) : null;
  return { title: row?.title, coverUrl, coverKind: !row || !coverUrl ? null : row.coverKind === 'video' && row.coverR2Key ? 'video' as const : 'image' as const };
}

const clipPost = v.object({
  id: v.id('postingPosts'), platform: postingPlatform, username: v.string(), avatarUrl: v.union(v.string(), v.null()),
  /** The account's state now: a failed post can only be retried while its account is `connected`. */
  accountStatus, status: postStatus, error: v.union(v.string(), v.null()), attempts: v.number(),
  scheduledAt: v.union(v.number(), v.null()), url: v.union(v.string(), v.null()), publishedAt: v.union(v.number(), v.null()), views: v.union(v.number(), v.null()),
});
const POSTS_WINDOW = 200;
/**
 * The owner's most recent posts grouped the way they were sent: one entry per clip (one submit of the Post dialog)
 * with the post to each account inside it, newest first.
 */
export const clipPosts = query({
  args: {},
  returns: v.array(v.object({ batchId: v.id('postingBatches'), label: v.string(), caption: v.string(), ...cover, campaignId: v.union(v.string(), v.null()), createdAt: v.number(), posts: v.array(clipPost) })),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    // One indexed read, as `posts` does; a clip's posts are created together, so they sit next to each other in it.
    const rows = await ctx.db.query('postingPosts').withIndex('by_owner_createdAt', q => q.eq('ownerId', ownerId)).order('desc').take(POSTS_WINDOW);
    const groups = new Map<Id<'postingBatches'>, Doc<'postingPosts'>[]>();
    for (const row of rows) groups.set(row.batchId, [...groups.get(row.batchId) ?? [], row]);
    // The oldest clip in a full window may have posts beyond it; it is left out rather than shown with accounts missing.
    if (rows.length === POSTS_WINDOW) groups.delete(rows[rows.length - 1].batchId);
    const accountsById = new Map<string, Doc<'postingAccounts'> | null>(), pictures = new Map<string, string | null>(), covers = new Map<string, Awaited<ReturnType<typeof projectCover>>>();
    const clips = [];
    for (const [batchId, group] of groups) {
      const batch = await ctx.db.get(batchId);
      if (!batch) continue;
      if (!covers.has(batch.projectId)) covers.set(batch.projectId, await projectCover(ctx, batch.projectId));
      const posts = [];
      // Back in the order the accounts were picked.
      for (const row of group.reverse()) {
        if (!accountsById.has(row.accountId)) accountsById.set(row.accountId, await ctx.db.get(row.accountId));
        const account = accountsById.get(row.accountId);
        if (!pictures.has(row.accountId)) pictures.set(row.accountId, await accountPicture(ctx, account));
        posts.push({
          id: row._id, platform: row.platform, username: account?.username ?? 'removed account', avatarUrl: pictures.get(row.accountId)!, accountStatus: account?.status ?? 'disconnected' as const,
          status: row.status, error: optional(row.error), attempts: row.attempts, scheduledAt: optional(row.scheduledAt), url: optional(row.url), publishedAt: optional(row.publishedAt), views: optional(row.views),
        });
      }
      const { coverUrl, coverKind } = covers.get(batch.projectId)!;
      clips.push({ batchId, label: batch.exportLabel, caption: batch.caption, coverUrl, coverKind, campaignId: optional(batch.campaignId), createdAt: batch.createdAt, posts });
    }
    return clips;
  },
});

/** One finished export as the Post dialog shows it, with the campaign its project is attached to. Null when it cannot be posted. */
export const clip = query({
  args: { jobId: v.id('renderJobs') },
  returns: v.union(v.null(), v.object({ jobId: v.id('renderJobs'), label: v.string(), durationSeconds: v.union(v.number(), v.null()), ...cover, campaign: v.union(v.null(), v.object({ id: v.id('campaigns'), name: v.string() })) })),
  handler: async (ctx, { jobId }) => {
    const ownerId = await requireOwner(ctx), { job } = await postableExport(ctx, ownerId, jobId);
    if (!job) return null;
    const { title, coverUrl, coverKind } = await projectCover(ctx, job.projectId);
    const timeline = (job.timeline ?? (await ctx.db.query('renderSnapshots').withIndex('by_job', q => q.eq('jobId', job._id)).first())?.timeline) as Timeline | undefined;
    const link = await ctx.db.query('projectCampaigns').withIndex('by_project', q => q.eq('projectId', job.projectId)).unique();
    const campaign = link?.campaignId ? await ctx.db.get(link.campaignId) : null;
    return {
      jobId: job._id, label: exportFileName(title ?? (await ctx.db.get(job.projectId))?.title ?? 'Video', job.label).replace(/\.mp4$/, ''),
      durationSeconds: timeline ? timelineDuration(timeline) : null, coverUrl, coverKind, campaign: campaign ? { id: campaign._id, name: campaign.name } : null,
    };
  },
});

/** The owner's most recent finished exports, for choosing a clip to post from the Posts page. */
export const finishedClips = query({
  args: {}, returns: v.array(v.object({ jobId: v.id('renderJobs'), label: v.string(), createdAt: v.number() })),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    const jobs = await ctx.db.query('renderJobs').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', 'completed')).order('desc').take(20);
    const titles = new Map<string, string>(), clips = [];
    for (const job of jobs) {
      if (!job.outputR2Key && !job.outputStorageId) continue;
      if (!titles.has(job.projectId)) titles.set(job.projectId, (await ctx.db.query('projectCatalog').withIndex('by_project', q => q.eq('projectId', job.projectId)).first())?.title ?? (await ctx.db.get(job.projectId))?.title ?? 'Video');
      clips.push({ jobId: job._id, label: exportFileName(titles.get(job.projectId)!, job.label).replace(/\.mp4$/, ''), createdAt: job.createdAt });
    }
    return clips;
  },
});

const totals = { posts: v.number(), views: v.number(), likes: v.number(), comments: v.number(), shares: v.number() };
/**
 * Totals for a Stats page: overall and per account, over the owner's published posts.
 * `estimatedEarnings` stays null until campaigns carry a rate (views x rate for campaign-linked posts).
 */
export const stats = query({
  args: {},
  returns: v.object({
    overall: v.object(totals), estimatedEarnings: v.null(),
    accounts: v.array(v.object({ accountId: v.id('postingAccounts'), platform: postingPlatform, username: v.string(), ...totals })),
  }),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db.query('postingPosts').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', 'published')).order('desc').take(2000);
    const empty = () => ({ posts: 0, views: 0, likes: 0, comments: 0, shares: 0 }), overall = empty(), perAccount = new Map<Id<'postingAccounts'>, ReturnType<typeof empty>>();
    for (const row of rows) {
      const account = perAccount.get(row.accountId) ?? empty();
      perAccount.set(row.accountId, account);
      for (const sum of [overall, account]) { sum.posts += 1; sum.views += row.views ?? 0; sum.likes += row.likes ?? 0; sum.comments += row.comments ?? 0; sum.shares += row.shares ?? 0; }
    }
    const list = [];
    for (const [accountId, sum] of perAccount) {
      const account = await ctx.db.get(accountId);
      if (account) list.push({ accountId, platform: account.platform, username: account.username, ...sum });
    }
    return { overall, estimatedEarnings: null, accounts: list.sort((a, b) => b.views - a.views) };
  },
});

/**
 * Estimated earnings: each published post's views x the rate its campaign pays on that platform, summed per
 * campaign. An estimate only: Content Rewards sets the real payout (minimums, caps and approval are not applied).
 * Posts without a campaign add nothing; a platform the campaign states no rate for counts its views at $0.
 */
export const earnings = query({
  args: {},
  returns: v.object({ estimatedCents: v.number(), campaigns: v.array(v.object({
    campaignId: v.id('campaigns'), name: v.string(), imageUrl: v.optional(v.string()), ended: v.boolean(), posts: v.number(), views: v.number(), estimatedCents: v.number(),
  })) }),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db.query('postingPosts').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', 'published')).order('desc').take(2000);
    const found = new Map<string, Doc<'campaigns'> | null>(), sums = new Map<Id<'campaigns'>, { campaign: Doc<'campaigns'>; posts: number; views: number; estimatedCents: number }>();
    for (const row of rows) {
      if (!row.campaignId) continue;
      if (!found.has(row.campaignId)) { const id = ctx.db.normalizeId('campaigns', row.campaignId); found.set(row.campaignId, id ? await ctx.db.get(id) : null); }
      const campaign = found.get(row.campaignId);
      if (!campaign) continue;
      const sum = sums.get(campaign._id) ?? { campaign, posts: 0, views: 0, estimatedCents: 0 };
      sums.set(campaign._id, sum);
      const rateCents = campaign.payouts.find(payout => payout.platform === row.platform)?.rateCents ?? 0;
      sum.posts += 1; sum.views += row.views ?? 0; sum.estimatedCents += (row.views ?? 0) * rateCents / 1000;
    }
    const campaigns = [...sums].map(([campaignId, { campaign, ...sum }]) => ({ campaignId, name: campaign.name, ...(campaign.imageUrl ? { imageUrl: campaign.imageUrl } : {}), ended: campaign.ended, ...sum, estimatedCents: Math.round(sum.estimatedCents) }));
    return { estimatedCents: campaigns.reduce((total, campaign) => total + campaign.estimatedCents, 0), campaigns };
  },
});

// ---------------------------------------------------------------- scheduler state machine

/**
 * Take a due post for publishing. This is the guard against double-posting: only a `scheduled` post whose time has
 * come can be claimed, the claim flips it to `posting` in the same transaction, and nothing publishes without one.
 */
export const claim = internalMutation({
  args: { postId: v.id('postingPosts') },
  returns: v.union(v.null(), v.object({
    accountId: v.id('postingAccounts'), platform: postingPlatform,
    input: v.object({ videoUrl: v.string(), videoBytes: v.number(), durationSeconds: v.number(), width: v.number(), height: v.number(), title: v.optional(v.string()), caption: v.string(),
      youtube: v.optional(v.object({ privacyStatus: youtubeVisibility })),
      tiktok: v.optional(v.object({ privacyLevel: v.optional(tiktokVisibility), ...tiktokChoices.fields })),
    }),
  })),
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId), now = Date.now();
    if (!post || post.status !== 'scheduled' || post.dueAt > now) return null;
    const fail = async (error: string) => { await ctx.db.patch(postId, { status: 'failed', error, updatedAt: now }); return null; };
    const account = await ctx.db.get(post.accountId);
    if (!account || account.status === 'disconnected') return fail('This account was disconnected before the post went out.');
    if (account.status !== 'connected') return fail(`Reconnect @${account.username}, then retry.`);
    const found = await postableExport(ctx, post.ownerId, post.jobId);
    if (!found.job) return fail(found.error);
    const { job } = found;
    const timeline = (job.timeline ?? (await ctx.db.query('renderSnapshots').withIndex('by_job', q => q.eq('jobId', job._id)).first())?.timeline) as Timeline | undefined;
    // A signed link the platform can pull the file from: valid for 7 days from now, far longer than any platform takes.
    // A post that cannot be prepared fails here instead of throwing, so it never stays due and blocks the queue.
    const videoUrl = await mediaUrl(ctx, { storageId: job.outputStorageId, r2Key: job.outputR2Key }, true).catch(() => null);
    if (!timeline || !videoUrl) return fail('The export file could not be read. Export the video again, then post it.');
    const size = job.outputSize ?? (job.outputStorageId ? (await ctx.db.system.get(job.outputStorageId))?.size : undefined) ?? 0;
    // The stored choice in the shape each adapter reads. Without one the adapter's own default applies.
    const choices = post.platform === 'youtube' ? isYouTubeVisibility(post.visibility) ? { youtube: { privacyStatus: post.visibility } } : {}
      : post.platform === 'tiktok' && (post.visibility || post.tiktok) ? { tiktok: { ...(isTikTokVisibility(post.visibility) ? { privacyLevel: post.visibility } : {}), ...post.tiktok } } : {};
    await ctx.db.patch(postId, { status: 'posting', attempts: post.attempts + 1, claimedAt: now, dueAt: now, error: undefined, updatedAt: now });
    return {
      accountId: post.accountId, platform: post.platform,
      input: { videoUrl, videoBytes: size, durationSeconds: timelineDuration(timeline), ...dimensions(timeline.aspectRatio, job.resolution ?? 1080), ...(post.title ? { title: post.title } : {}), caption: post.caption, ...choices },
    };
  },
});

const outcome = v.union(
  v.object({ status: v.literal('published'), platformPostId: v.string(), url: v.string() }),
  v.object({ status: v.literal('processing'), platformJobId: v.string() }),
  v.object({ status: v.literal('failed'), error: v.string(), retryable: v.boolean() }),
);
/**
 * Record what the platform answered. `from` is the state the caller saw: a result only applies while the post is
 * still in it, so a late or duplicate action cannot overwrite a newer state.
 */
export const settle = internalMutation({
  args: { postId: v.id('postingPosts'), from: v.union(v.literal('posting'), v.literal('processing')), outcome }, returns: v.null(),
  handler: async (ctx, { postId, from, outcome }) => {
    const post = await ctx.db.get(postId), now = Date.now();
    if (!post || post.status !== from) return null;
    if (outcome.status === 'published') await ctx.db.patch(postId, { status: 'published', platformPostId: outcome.platformPostId, url: outcome.url, publishedAt: now, error: undefined, updatedAt: now });
    else if (outcome.status === 'processing') {
      if (from === 'posting') {
        // The tick stays away while the quick checks run, then polls as before.
        await ctx.db.patch(postId, { status: 'processing', platformJobId: outcome.platformJobId, dueAt: now + PROCESSING_POLL_MS, updatedAt: now });
        await ctx.scheduler.runAfter(QUICK_CHECK_DELAYS_MS[0], internal.posting.quickCheck, { postId, step: 0 });
      }
      // A check can move the job on (a YouTube upload that finished becomes a video to watch): the next check needs the new id.
      else if (outcome.platformJobId !== post.platformJobId) await ctx.db.patch(postId, { platformJobId: outcome.platformJobId, updatedAt: now });
    }
    else {
      const error = outcome.error.slice(0, ERROR_LIMIT) || 'The platform refused this post.';
      // At most MAX_ATTEMPTS tries, and only for errors the adapter marked retryable.
      if (outcome.retryable && post.attempts < MAX_ATTEMPTS) {
        const dueAt = now + post.attempts * RETRY_DELAY_MS;
        await ctx.db.patch(postId, { status: 'scheduled', error, dueAt, platformJobId: undefined, updatedAt: now });
        // Retry on time rather than at the first tick after it; the tick stays as the safety net.
        await ctx.scheduler.runAt(dueAt + 1000, internal.postingActions.runPost, { postId });
      }
      else await ctx.db.patch(postId, { status: 'failed', error, updatedAt: now });
    }
    return null;
  },
});

/**
 * One quick check of a post the platform accepted moments ago. Each check is scheduled by the one before it, so they
 * never overlap, exist only while that post is processing, and end after the last delay; then the tick polls.
 */
export const quickCheck = internalMutation({
  args: { postId: v.id('postingPosts'), step: v.number() }, returns: v.null(),
  handler: async (ctx, { postId, step }) => {
    const post = await ctx.db.get(postId), now = Date.now();
    if (!post || post.status !== 'processing') return null;
    await ctx.db.patch(postId, { dueAt: now + QUICK_CHECK_LEASE_MS });
    await ctx.scheduler.runAfter(0, internal.postingActions.checkPost, { postId, quickStep: step });
    return null;
  },
});
/** A quick check ended with the post still processing: schedule the next one, or hand the post back to the tick after the last. */
export const afterQuickCheck = internalMutation({
  args: { postId: v.id('postingPosts'), step: v.number() }, returns: v.null(),
  handler: async (ctx, { postId, step }) => {
    const post = await ctx.db.get(postId), next = QUICK_CHECK_DELAYS_MS[step + 1];
    if (!post || post.status !== 'processing') return null;
    if (next !== undefined) await ctx.scheduler.runAfter(next, internal.posting.quickCheck, { postId, step: step + 1 });
    // Due now, so the next tick polls it instead of waiting out the lease.
    else await ctx.db.patch(postId, { dueAt: Date.now() });
    return null;
  },
});

/** A `processing` post's account and platform job, for a checkPublish poll. */
export const processingPost = internalQuery({
  args: { postId: v.id('postingPosts') },
  returns: v.union(v.null(), v.object({ accountId: v.id('postingAccounts'), platform: postingPlatform, platformJobId: v.string() })),
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    return post?.status === 'processing' && post.platformJobId ? { accountId: post.accountId, platform: post.platform, platformJobId: post.platformJobId } : null;
  },
});

/** Cron, every 5 minutes: start due posts, poll processing ones (after their quick checks), and close posts whose action was lost. */
export const tick = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const now = Date.now();
    const due = await ctx.db.query('postingPosts').withIndex('by_status_dueAt', q => q.eq('status', 'scheduled').lte('dueAt', now)).take(100);
    for (const post of due) await ctx.scheduler.runAfter(0, internal.postingActions.runPost, { postId: post._id });
    const processing = await ctx.db.query('postingPosts').withIndex('by_status_dueAt', q => q.eq('status', 'processing').lte('dueAt', now)).take(100);
    for (const post of processing) {
      if ((post.claimedAt ?? post.updatedAt) < now - PROCESSING_LIMIT_MS) { await ctx.db.patch(post._id, { status: 'failed', error: 'The platform did not finish processing this video within a day. Check the account first, then retry if the video is not there.', updatedAt: now }); continue; }
      await ctx.db.patch(post._id, { dueAt: now + PROCESSING_POLL_MS });
      await ctx.scheduler.runAfter(0, internal.postingActions.checkPost, { postId: post._id });
    }
    const lost = await ctx.db.query('postingPosts').withIndex('by_status_dueAt', q => q.eq('status', 'posting').lte('dueAt', now - STALE_POSTING_MS)).take(100);
    for (const post of lost) await ctx.db.patch(post._id, { status: 'failed', error: INTERRUPTED, updatedAt: now });
    // Posts waiting for an export are settled when it ends; this catches an export that ended without saying so.
    const waiting = await ctx.db.query('postingPending').withIndex('by_status', q => q.eq('status', 'waiting')).take(100);
    for (const pending of waiting) {
      if (!pending.jobId) continue;
      const job = await ctx.db.get(pending.jobId);
      if (!job || job.status !== 'queued' && job.status !== 'rendering') await ctx.scheduler.runAfter(0, internal.postExports.settle, { jobId: pending.jobId });
    }
    // Posts queued behind the account's export limit start as exports finish; this catches a missed start.
    const queued = await ctx.db.query('postingPending').withIndex('by_status', q => q.eq('status', 'queued')).take(100);
    for (const ownerId of new Set(queued.map(pending => pending.ownerId))) await ctx.scheduler.runAfter(0, internal.postExports.advance, { ownerId });
    const expired = await ctx.db.query('postingOauthStates').withIndex('by_expiresAt', q => q.lte('expiresAt', now)).take(100);
    for (const state of expired) await ctx.db.delete(state._id);
    return null;
  },
});

// ---------------------------------------------------------------- stats

/** One page of posts published in the last 30 days, for the hourly stats refresh. */
export const statsPage = internalQuery({
  // `since` is fixed by the caller for a whole run, so every page of it reads the same range.
  args: { cursor: v.union(v.string(), v.null()), since: v.number() },
  returns: v.object({ posts: v.array(v.object({ postId: v.id('postingPosts'), accountId: v.id('postingAccounts'), platform: postingPlatform, platformPostId: v.string() })), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, { cursor, since }) => {
    const page = await ctx.db.query('postingPosts').withIndex('by_status_publishedAt', q => q.eq('status', 'published').gte('publishedAt', since)).paginate({ cursor, numItems: 25 });
    return { posts: page.page.flatMap(post => post.platformPostId ? [{ postId: post._id, accountId: post.accountId, platform: post.platform, platformPostId: post.platformPostId }] : []), cursor: page.continueCursor, done: page.isDone };
  },
});
export const saveStats = internalMutation({
  args: { postId: v.id('postingPosts'), views: v.number(), likes: v.number(), comments: v.number(), shares: v.optional(v.number()), fetchedAt: v.number() }, returns: v.null(),
  handler: async (ctx, { postId, fetchedAt, ...numbers }) => {
    if (await ctx.db.get(postId)) await ctx.db.patch(postId, { ...numbers, statsFetchedAt: fetchedAt });
    return null;
  },
});
