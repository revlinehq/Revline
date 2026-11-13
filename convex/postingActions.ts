import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalAction } from './_generated/server';
import { postingPlatform, tiktokCreator as tiktokCreatorResult, tiktokVisibility } from './postingTables';
import type { PostingPlatform } from '../lib/posting/adapter';
import { VIDEO_LIMITS, type TikTokPrivacyLevel } from '../lib/posting/platform-limits';
import { VISIBILITY_OPTIONS } from '../lib/posting/visibility';
import { STATS_WINDOW_MS } from './posting';
import * as bridge from './postingBridge';

// Everything that talks to Post Bridge (convex/postingBridge.ts, lib/posting/postbridge), which connects the
// accounts, holds their tokens and posts for Revline. Revline stores no platform token.

/**
 * Begin connecting an account: a connect link to the platform's consent screen, tagged with the signed-in owner's
 * reference. `accountId` names an account of theirs being reconnected, which takes no new slot.
 */
export const startConnect = action({
  args: { platform: postingPlatform, accountId: v.optional(v.id('postingAccounts')) }, returns: v.string(),
  handler: (ctx, { platform, accountId }): Promise<string> => bridge.connectLink(ctx, platform, accountId),
});

/**
 * Read the signed-in owner's accounts from Post Bridge into Revline: called when they return from a connect link and
 * when Connected accounts opens. `connected` are the handles this read connected or renewed, `overLimit` how many
 * were refused because the owner is at `cap` accounts in total (null: no limit). Does nothing when the accounts were read moments ago.
 */
export const syncAccounts = action({
  args: { afterLink: v.optional(v.boolean()) }, returns: v.object({ connected: v.array(v.string()), overLimit: v.number(), cap: v.union(v.number(), v.null()) }),
  handler: async (ctx, { afterLink }) => {
    try { return await bridge.syncAccounts(ctx, afterLink === true); }
    catch (error) { throw new ConvexError(bridge.failure(error, error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Your accounts could not be refreshed. Please try again.')); }
  },
});

/** Scheduled by `posting.disconnect`: the account is removed at Post Bridge, which ends its access to the platform account. */
export const revokeAccount = internalAction({
  args: { accountId: v.id('postingAccounts') }, returns: v.null(),
  handler: async (ctx, { accountId }) => { await bridge.removeAtProvider(ctx, { accountId }, 0); return null; },
});
/** A removal at Post Bridge that did not go through, tried again. */
export const removeProviderAccount = internalAction({
  args: { accountId: v.id('postingAccounts'), providerAccountId: v.optional(v.number()), ref: v.optional(v.string()), attempt: v.number() }, returns: v.null(),
  handler: async (ctx, { attempt, ...removal }) => { await bridge.removeAtProvider(ctx, removal, attempt); return null; },
});
/** Deleting a Revline account: disconnect every account it connected and remove each at Post Bridge, before its rows are removed. */
export const revokeOwner = internalAction({
  args: { ownerId: v.string() }, returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    const accountIds: Id<'postingAccounts'>[] = await ctx.runMutation(internal.posting.disconnectOwner, { ownerId });
    await Promise.allSettled(accountIds.map(accountId => bridge.removeAtProvider(ctx, { accountId }, 0)));
    return null;
  },
});

/** What a TikTok post can be given. Post Bridge does not pass on TikTok's per-account settings, so it is the same for every account. */
const tiktokOptions = (): { privacyLevels: TikTokPrivacyLevel[]; maxDurationSeconds: number } => ({ privacyLevels: [...VISIBILITY_OPTIONS.tiktok], maxDurationSeconds: VIDEO_LIMITS.maxDurationSeconds });
type TikTokCreator = { ok: true; nickname: string; username: string; privacyLevels: TikTokPrivacyLevel[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxDurationSeconds: number } | { ok: false; error: string };

/**
 * What the Post dialog shows for a TikTok account before a post: who is posting and the choices the user makes
 * themselves (who can view it, interactions, disclosure). `ok: false` carries the reason the account cannot post now.
 */
export const tiktokCreator = action({
  args: { accountId: v.id('postingAccounts') },
  returns: v.union(
    v.object({ ok: v.literal(true), nickname: v.string(), username: v.string(), privacyLevels: v.array(tiktokVisibility), commentDisabled: v.boolean(), duetDisabled: v.boolean(), stitchDisabled: v.boolean(), maxDurationSeconds: v.number() }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { accountId }): Promise<TikTokCreator> => {
    // Throws unless this is the signed-in owner's connected TikTok account.
    const owned: { username: string } = await ctx.runQuery(internal.posting.ownedTikTok, { accountId });
    return { ok: true, nickname: '', username: owned.username, commentDisabled: false, duetDisabled: false, stitchDisabled: false, ...tiktokOptions() };
  },
});

/**
 * `tiktokCreator` for the assistant's posting tools, which know the owner from the run or the MCP connection.
 * Never throws; `error` carries the reason.
 */
export const tiktokCreatorFor = internalAction({
  args: { ownerId: v.string(), accountId: v.id('postingAccounts') },
  returns: tiktokCreatorResult,
  handler: async (ctx, { ownerId, accountId }) => {
    try {
      // Throws unless this is one of the owner's accounts.
      const [account] = await ctx.runQuery(internal.assistantPosting.accountPlatforms, { ownerId, accountIds: [accountId] }) as { platform: PostingPlatform; connected: boolean }[];
      if (account.platform !== 'tiktok') return { accountId, error: 'This is not a TikTok account.' };
      if (!account.connected) return { accountId, error: 'This TikTok account needs reconnecting before it can be posted to. The user reconnects it on the Accounts page (/accounts).' };
      return { accountId, ...tiktokOptions() };
    } catch (error) { return { accountId, error: error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'This account’s posting settings could not be read. Try again in a moment.' }; }
  },
});

/** Publish one post. Safe to schedule more than once: only the run that claims the post publishes it. */
export const runPost = internalAction({
  args: { postId: v.id('postingPosts') }, returns: v.null(),
  handler: async (ctx, { postId }) => {
    const claimed = await ctx.runMutation(internal.posting.claim, { postId });
    if (claimed) await ctx.runMutation(internal.posting.settle, { postId, from: 'posting', outcome: await bridge.publishPost(ctx, claimed.accountId, claimed.platform, claimed.input) });
    return null;
  },
});

/** Poll a post that is still going out. `quickStep`: this is one of the quick checks that follow an upload, which continue from here. */
export const checkPost = internalAction({
  args: { postId: v.id('postingPosts'), quickStep: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, { postId, quickStep }) => {
    const post = await ctx.runQuery(internal.posting.processingPost, { postId });
    if (!post) return null;
    let settled = false;
    try {
      const check = await bridge.checkPost(ctx, post.accountId, post.platform, post.platformJobId);
      // Still processing: the next check polls again.
      if (check.status !== 'processing') {
        settled = true;
        await ctx.runMutation(internal.posting.settle, { postId, from: 'processing', outcome: check.status === 'published'
          ? { status: 'published', platformPostId: check.platformPostId, url: check.url, ...(check.providerResultId ? { providerResultId: check.providerResultId } : {}) }
          : { status: 'failed', error: check.error, retryable: check.retryable } });
      }
    } catch { /* A poll that could not run says nothing about the post: it is asked again at the next check. */ }
    if (quickStep !== undefined && !settled) await ctx.runMutation(internal.posting.afterQuickCheck, { postId, step: quickStep });
    return null;
  },
});

/**
 * Cron, hourly: views, likes, comments and shares of published posts, read from Post Bridge in batches. A post is
 * read hourly for two days after it goes out, then daily, and not at all after 30 days.
 */
export const refreshStats = internalAction({
  args: {}, returns: v.null(),
  handler: async ctx => { await bridge.refreshStats(ctx, Date.now() - STATS_WINDOW_MS); return null; },
});
