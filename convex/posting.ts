import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireOwner } from './lib/auth';
import { mediaUrl } from './lib/media_storage';
import { exportFileName } from './renders';
import { accountStatus, postingPlatform, postStatus } from './postingTables';
import { dimensions, timelineDuration, type Timeline } from '../lib/editor/types';
import { POSTING_PLATFORMS } from '../lib/posting/platform-names';
import { CAPTION_LIMIT, MAX_ATTEMPTS, TITLE_LIMIT } from '../lib/posting/limits';
import { livePlatform } from '../lib/posting/server';

// The posting base: connected social accounts, posts to them, and the scheduler state machine.
// Network work (OAuth, publishing, stats) lives in postingActions.ts; every state change is a mutation here,
// so a post moves `scheduled -> posting -> processing? -> published | failed` in single transactions.

const TARGET_LIMIT = 50, ERROR_LIMIT = 500;
const SCHEDULE_HORIZON_MS = 90 * 86400_000;
/** A post still `posting` after this long lost its action; it is failed rather than re-sent, which could post twice. */
const STALE_POSTING_MS = 20 * 60_000;
const PROCESSING_LIMIT_MS = 24 * 3600_000, PROCESSING_POLL_MS = 4 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
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
    return rows.filter(row => row.status !== 'disconnected').map(row => ({
      id: row._id, platform: row.platform, username: row.username, displayName: optional(row.displayName), avatarUrl: optional(row.avatarUrl),
      status: row.status, error: optional(row.error), connectedAt: row.createdAt,
    }));
  },
});

/** Remove an account's tokens. Its published posts stay in the history; posts still waiting for it fail. */
export const disconnect = mutation({
  args: { accountId: v.id('postingAccounts') }, returns: v.null(),
  handler: async (ctx, { accountId }) => {
    const ownerId = await requireOwner(ctx), account = await ownedAccount(ctx, ownerId, accountId), now = Date.now();
    await ctx.db.patch(account._id, { status: 'disconnected', tokenCipher: undefined, tokenExpiresAt: undefined, refreshLeaseUntil: undefined, error: undefined, updatedAt: now });
    const waiting = await ctx.db.query('postingPosts').withIndex('by_account_status', q => q.eq('accountId', account._id).eq('status', 'scheduled')).collect();
    for (const post of waiting) await ctx.db.patch(post._id, { status: 'failed', error: 'This account was disconnected before the post went out.', updatedAt: now });
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
    tokenCipher: v.string(), tokenExpiresAt: v.optional(v.number()), scopes: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { ownerId, platform, platformAccountId, ...fields }) => {
    const now = Date.now(), current = await ctx.db.query('postingAccounts').withIndex('by_owner_platform_account', q => q.eq('ownerId', ownerId).eq('platform', platform).eq('platformAccountId', platformAccountId)).unique();
    const values = { ...fields, status: 'connected' as const, error: undefined, refreshLeaseUntil: undefined, updatedAt: now };
    // Reconnecting keeps the row, so the account's post history and stats stay attached.
    if (current) await ctx.db.replace(current._id, { ownerId, platform, platformAccountId, createdAt: current.createdAt, ...values });
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
    if (account?.status === 'connected') await ctx.db.patch(accountId, { ...tokens, tokenExpiresAt: tokens.tokenExpiresAt, refreshLeaseUntil: undefined, updatedAt: Date.now() });
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
    targets: v.array(v.object({ accountId: v.id('postingAccounts'), caption: v.optional(v.string()), title: v.optional(v.string()) })),
  },
  returns: v.id('postingBatches'),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx), now = Date.now();
    if (!args.targets.length) throw new ConvexError('Pick at least one account.');
    if (args.targets.length > TARGET_LIMIT || new Set(args.targets.map(target => target.accountId)).size !== args.targets.length) throw new ConvexError(`Pick up to ${TARGET_LIMIT} different accounts.`);
    const text = (value: string | undefined, limit: number, name: string) => {
      const trimmed = value?.trim();
      if (trimmed && trimmed.length > limit) throw new ConvexError(`${name} can be up to ${limit} characters.`);
      return trimmed || undefined;
    };
    const caption = text(args.caption, CAPTION_LIMIT, 'A caption') ?? '', title = text(args.title, TITLE_LIMIT, 'A title');
    if (args.scheduledAt !== undefined && (!Number.isFinite(args.scheduledAt) || args.scheduledAt < now - 60_000 || args.scheduledAt > now + SCHEDULE_HORIZON_MS)) throw new ConvexError('Pick a time in the next 90 days.');
    if (args.campaignId !== undefined && (!args.campaignId || args.campaignId.length > 200)) throw new ConvexError('Campaign not found');
    const found = await postableExport(ctx, ownerId, args.jobId);
    if (!found.job) throw new ConvexError(found.error);
    const project = await ctx.db.get(found.job.projectId);
    const scheduledAt = args.scheduledAt !== undefined && args.scheduledAt > now ? args.scheduledAt : undefined, dueAt = scheduledAt ?? now;
    const batchId = await ctx.db.insert('postingBatches', {
      ownerId, jobId: found.job._id, projectId: found.job.projectId, exportLabel: exportFileName(project?.title ?? 'Video', found.job.label).replace(/\.mp4$/, ''),
      caption, ...(title ? { title } : {}), ...(scheduledAt ? { scheduledAt } : {}), ...(args.campaignId ? { campaignId: args.campaignId } : {}), createdAt: now,
    });
    for (const target of args.targets) {
      const account = await ownedAccount(ctx, ownerId, target.accountId);
      if (account.status !== 'connected') throw new ConvexError(`Reconnect @${account.username} before posting to it.`);
      const own = text(target.caption, CAPTION_LIMIT, 'A caption'), ownTitle = text(target.title, TITLE_LIMIT, 'A title') ?? title;
      const postId = await ctx.db.insert('postingPosts', {
        ownerId, batchId, accountId: account._id, platform: account.platform, jobId: found.job._id, caption: own ?? caption, ...(ownTitle ? { title: ownTitle } : {}),
        status: 'scheduled', attempts: 0, ...(scheduledAt ? { scheduledAt } : {}), dueAt, ...(args.campaignId ? { campaignId: args.campaignId } : {}), createdAt: now, updatedAt: now,
      });
      // "Post now" does not wait for the next scheduler tick.
      if (!scheduledAt) await ctx.scheduler.runAfter(0, internal.postingActions.runPost, { postId });
    }
    return batchId;
  },
});

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
    const accountsById = new Map<string, Doc<'postingAccounts'> | null>(), covers = new Map<string, Awaited<ReturnType<typeof projectCover>>>();
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
        posts.push({
          id: row._id, platform: row.platform, username: account?.username ?? 'removed account', avatarUrl: optional(account?.avatarUrl), accountStatus: account?.status ?? 'disconnected' as const,
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
    input: v.object({ videoUrl: v.string(), videoBytes: v.number(), durationSeconds: v.number(), width: v.number(), height: v.number(), title: v.optional(v.string()), caption: v.string() }),
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
    await ctx.db.patch(postId, { status: 'posting', attempts: post.attempts + 1, claimedAt: now, dueAt: now, error: undefined, updatedAt: now });
    return {
      accountId: post.accountId, platform: post.platform,
      input: { videoUrl, videoBytes: size, durationSeconds: timelineDuration(timeline), ...dimensions(timeline.aspectRatio, job.resolution ?? 1080), ...(post.title ? { title: post.title } : {}), caption: post.caption },
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
    else if (outcome.status === 'processing') { if (from === 'posting') await ctx.db.patch(postId, { status: 'processing', platformJobId: outcome.platformJobId, dueAt: now + 60_000, updatedAt: now }); }
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

/** A `processing` post's account and platform job, for a checkPublish poll. */
export const processingPost = internalQuery({
  args: { postId: v.id('postingPosts') },
  returns: v.union(v.null(), v.object({ accountId: v.id('postingAccounts'), platform: postingPlatform, platformJobId: v.string() })),
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    return post?.status === 'processing' && post.platformJobId ? { accountId: post.accountId, platform: post.platform, platformJobId: post.platformJobId } : null;
  },
});

/** Cron, every 5 minutes: start due posts, poll processing ones, and close posts whose action was lost. */
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
