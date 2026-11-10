import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { postingPlatform } from './postingTables';
import { PostingError, type AccountTokens, type PostingPlatform } from '../lib/posting/adapter';
import { decryptTokens, encryptTokens, signState, verifyState } from '../lib/posting/crypto';
import { PLATFORM_NAMES } from '../lib/posting/platform-names';
import { livePlatform, tokenSecret } from '../lib/posting/server';
import { STATS_WINDOW_MS } from './posting';

// Everything that talks to a platform. Adapters are fetch-based, so this runs in the default Convex runtime.
// Tokens exist decrypted only inside these functions: they are never returned, stored in the clear, or logged.

/** Refresh tokens that expire within this window before using them. */
const REFRESH_AHEAD_MS = 10 * 60_000;
const failure = (error: unknown, fallback: string) => error instanceof PostingError ? error.message : fallback;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Begin connecting an account: the platform's consent URL, carrying a signed, single-use `state`. */
export const startConnect = action({
  args: { platform: postingPlatform }, returns: v.string(),
  handler: async (ctx, { platform }): Promise<string> => {
    // Checks the signed-in owner and stores the nonce.
    const nonce: string = await ctx.runMutation(internal.posting.createOauthState, { platform });
    const live = livePlatform(platform);
    if (!live) throw new ConvexError('This platform is coming soon.');
    return live.adapter.authUrl(live.credentials, await signState(tokenSecret(), nonce));
  },
});

/**
 * The OAuth callback, called by the signed-in /accounts/callback page: exchange the code, read the profile and
 * store the account. The state must have been started by this same signed-in owner.
 */
export const finishConnect = action({
  args: { code: v.string(), state: v.string() },
  returns: v.object({ ok: v.boolean(), platform: v.optional(postingPlatform), error: v.optional(v.string()) }),
  handler: async (ctx, { code, state }): Promise<{ ok: boolean; platform?: PostingPlatform; error?: string }> => {
    const expired = { ok: false, error: 'This connection link expired. Start again from Connected accounts.' };
    let nonce: string | null;
    try { nonce = await verifyState(tokenSecret(), state); } catch { return expired; }
    const started = nonce ? await ctx.runMutation(internal.posting.consumeOauthState, { nonce }) : null;
    if (!started) return expired;
    const { ownerId, platform }: { ownerId: string; platform: PostingPlatform } = started, live = livePlatform(platform);
    if (!live) return { ok: false, platform, error: `${PLATFORM_NAMES[platform]} is not available right now.` };
    try {
      const tokens = await live.adapter.exchangeCode(live.credentials, code), profile = await live.adapter.profile(tokens);
      await ctx.runMutation(internal.posting.saveAccount, {
        ownerId, platform, platformAccountId: profile.platformAccountId, username: profile.username,
        ...(profile.displayName ? { displayName: profile.displayName } : {}), ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        tokenCipher: await encryptTokens(tokenSecret(), tokens), ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}), scopes: tokens.scopes,
      });
      return { ok: true, platform };
    } catch (error) {
      return { ok: false, platform, error: failure(error, `${PLATFORM_NAMES[platform]} did not finish connecting this account. Please try again.`) };
    }
  },
});

/**
 * An account's usable tokens, refreshed first when they are near expiry. Throws PostingError: retryable when
 * trying again later can work, not retryable when the user has to reconnect the account.
 */
async function accountTokens(ctx: ActionCtx, accountId: Id<'postingAccounts'>): Promise<AccountTokens> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const account = await ctx.runQuery(internal.posting.accountSecret, { accountId });
    if (!account || account.status !== 'connected' || !account.tokenCipher) throw new PostingError('Reconnect this account, then retry.', false, 'reconnect');
    const live = livePlatform(account.platform);
    if (!live) throw new PostingError(`${PLATFORM_NAMES[account.platform]} posting is not available right now.`, true, 'unavailable');
    // Tokens that no longer open (a changed key, a damaged row) can only be replaced by connecting again.
    const tokens = await decryptTokens(tokenSecret(), account.tokenCipher).catch(() => { throw new PostingError('This account’s saved connection can no longer be read. Reconnect it, then retry.', false, 'reconnect'); });
    if (!tokens.expiresAt || tokens.expiresAt - Date.now() > REFRESH_AHEAD_MS) return tokens;
    // Another action is refreshing: wait for its tokens instead of spending the same refresh token twice.
    if (account.refreshing || !await ctx.runMutation(internal.posting.leaseRefresh, { accountId })) { await wait(2000); continue; }
    let fresh: AccountTokens;
    try { fresh = await live.adapter.refresh(live.credentials, tokens); }
    catch (error) {
      const reconnect = error instanceof PostingError && !error.retryable;
      await ctx.runMutation(internal.posting.refreshFailed, { accountId, reconnect, error: failure(error, 'The connection expired.') });
      throw reconnect ? new PostingError('This account’s connection expired. Reconnect it, then retry.', false, 'reconnect') : new PostingError(failure(error, 'Could not refresh this account’s connection.'), true, 'refresh');
    }
    // The platform may have rotated the refresh token, so the new tokens must be stored: a failed save is tried once more.
    const saved = { accountId, tokenCipher: await encryptTokens(tokenSecret(), fresh), ...(fresh.expiresAt ? { tokenExpiresAt: fresh.expiresAt } : {}), scopes: fresh.scopes };
    await ctx.runMutation(internal.posting.saveTokens, saved).catch(() => ctx.runMutation(internal.posting.saveTokens, saved));
    return fresh;
  }
  throw new PostingError('This account is busy refreshing its connection.', true, 'refresh');
}

/** Publish one post. Safe to schedule more than once: only the run that claims the post publishes it. */
export const runPost = internalAction({
  args: { postId: v.id('postingPosts') }, returns: v.null(),
  handler: async (ctx, { postId }) => {
    const claimed = await ctx.runMutation(internal.posting.claim, { postId });
    if (!claimed) return null;
    const settle = (outcome: { status: 'published'; platformPostId: string; url: string } | { status: 'processing'; platformJobId: string } | { status: 'failed'; error: string; retryable: boolean }) =>
      ctx.runMutation(internal.posting.settle, { postId, from: 'posting', outcome });
    let tokens: AccountTokens;
    // Nothing has been sent yet, so an unknown failure here is safe to retry.
    try { tokens = await accountTokens(ctx, claimed.accountId); }
    catch (error) { await settle({ status: 'failed', error: failure(error, 'Could not reach this account. Trying again shortly.'), retryable: error instanceof PostingError ? error.retryable : true }); return null; }
    const live = livePlatform(claimed.platform);
    if (!live) { await settle({ status: 'failed', error: `${PLATFORM_NAMES[claimed.platform]} posting is not available right now.`, retryable: true }); return null; }
    try {
      const result = await live.adapter.publish(tokens, claimed.input);
      await settle(result.status === 'published' ? { status: 'published', platformPostId: result.platformPostId, url: result.url } : { status: 'processing', platformJobId: result.platformJobId });
    } catch (error) {
      // An error the adapter did not classify may have reached the platform; retrying it could post twice.
      await settle({ status: 'failed', error: failure(error, 'Posting stopped unexpectedly. Check the account first, then retry if the video is not there.'), retryable: error instanceof PostingError && error.retryable });
    }
    return null;
  },
});

/** Poll a post the platform is still processing. */
export const checkPost = internalAction({
  args: { postId: v.id('postingPosts') }, returns: v.null(),
  handler: async (ctx, { postId }) => {
    const post = await ctx.runQuery(internal.posting.processingPost, { postId });
    if (!post) return null;
    const live = livePlatform(post.platform);
    if (!live) return null;
    try {
      const check = await live.adapter.checkPublish(await accountTokens(ctx, post.accountId), post.platformJobId);
      // Still processing: the next tick polls again.
      if (check.status !== 'processing') await ctx.runMutation(internal.posting.settle, { postId, from: 'processing', outcome: check.status === 'published' ? { status: 'published', platformPostId: check.platformPostId, url: check.url } : { status: 'failed', error: check.error, retryable: check.retryable } });
    } catch (error) {
      // A poll that could not run says nothing about the post, unless the account can no longer be used at all.
      if (error instanceof PostingError && !error.retryable) await ctx.runMutation(internal.posting.settle, { postId, from: 'processing', outcome: { status: 'failed', error: error.message, retryable: false } });
    }
    return null;
  },
});

/** Cron, hourly: refresh views, likes and comments for posts published in the last 30 days, a page at a time. */
export const refreshStats = internalAction({
  args: { cursor: v.optional(v.string()), since: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, { cursor, since = Date.now() - STATS_WINDOW_MS }) => {
    const page = await ctx.runQuery(internal.posting.statsPage, { cursor: cursor ?? null, since });
    for (const post of page.posts) {
      const live = livePlatform(post.platform);
      if (!live) continue;
      try {
        const stats = await live.adapter.postStats(await accountTokens(ctx, post.accountId), post.platformPostId);
        await ctx.runMutation(internal.posting.saveStats, { postId: post.postId, views: stats.views, likes: stats.likes, comments: stats.comments, ...(stats.shares !== undefined ? { shares: stats.shares } : {}), fetchedAt: stats.fetchedAt });
      } catch { /* One post's stats failing (a deleted video, a disconnected account) leaves its last numbers in place. */ }
    }
    if (!page.done) await ctx.scheduler.runAfter(0, internal.postingActions.refreshStats, { cursor: page.cursor, since });
    return null;
  },
});
