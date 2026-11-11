import type { HttpRouter } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { boundedBody } from './appleBillingHttp';
import type { Doc } from './_generated/dataModel';
import { httpAction, internalMutation, query, type MutationCtx } from './_generated/server';
import { markDisconnected } from './posting';
import { deletionRequestStatus, postingPlatform } from './postingTables';
import type { PostingPlatform } from '../lib/posting/adapter';
import { readSignedRequest } from '../lib/posting/platforms/instagram/signed-request';

// The two callbacks Meta requires of an app that uses Instagram Login, registered under
// Instagram > API setup with Instagram login > Business login settings (docs/posting/instagram-setup.md):
//   POST /instagram/deauthorize     the person removed Revline in Instagram: every connection to that account ends here
//   POST /instagram/data-deletion   the person asked for their data to be deleted: the connection is deleted, the
//                                   posts made to it keep only what the Revline user wrote, and Meta gets a status link
// Both carry a form-encoded `signed_request` signed with the app secret. Nothing is done for a request whose
// signature does not match, and nothing here can be called by a signed-in user: the mutations are internal.

/** A signed request is a few hundred bytes; anything larger is not one. */
const BODY_LIMIT = 16_000;
const POSTS_PER_PASS = 100;
/** How far the platform's clock and this server's may differ when a callback is compared with a reconnect. */
const CLOCK_ALLOWANCE_MS = 5_000;
const REMOVED = 'This post did not go out. Its account has since been removed from Revline.';
const CUT_SHORT = 'Posting was cut short because the account was removed from Revline. Check the account to see whether the video is there.';
/** Connected (again) after the callback was issued: a new permission, which a callback about the earlier one leaves alone. */
const connectedAfter = (account: Doc<'postingAccounts'>, issuedAt: number | undefined) => issuedAt !== undefined && (account.connectedAt ?? account.createdAt) > issuedAt + CLOCK_ALLOWANCE_MS;

/** Every Revline user's connection to one platform account, named by either of the ids the platform uses for it. */
async function connectionsOf(ctx: MutationCtx, platform: PostingPlatform, platformUserId: string) {
  const found = new Map<string, Doc<'postingAccounts'>>();
  for (const account of await ctx.db.query('postingAccounts').withIndex('by_platform_account', q => q.eq('platform', platform).eq('platformAccountId', platformUserId)).collect()) found.set(account._id, account);
  for (const account of await ctx.db.query('postingAccounts').withIndex('by_platform_scoped', q => q.eq('platform', platform).eq('platformScopedId', platformUserId)).collect()) found.set(account._id, account);
  return [...found.values()];
}

/**
 * The platform says the person removed Revline's access. Each connection to that account is disconnected as
 * `posting.disconnect` does (picture deleted, waiting posts failed) and its tokens are deleted at once: there is
 * nothing left to revoke. Safe to receive twice. Returns how many connections it ended.
 */
export const deauthorized = internalMutation({
  args: { platform: postingPlatform, platformUserId: v.string(), issuedAt: v.optional(v.number()) }, returns: v.number(),
  handler: async (ctx, { platform, platformUserId, issuedAt }) => {
    const now = Date.now();
    let ended = 0;
    for (const account of await connectionsOf(ctx, platform, platformUserId)) {
      if (connectedAfter(account, issuedAt)) continue;
      if (account.status === 'disconnected' && account.tokenCipher === undefined) continue;
      if (account.status !== 'disconnected') await markDisconnected(ctx, account, now);
      await ctx.db.patch(account._id, { tokenCipher: undefined, updatedAt: now });
      ended++;
    }
    return ended;
  },
});

/**
 * The platform passes on the person's request to delete their data. Deleted in this transaction: every connection
 * to that account (tokens, ids, username, name, picture URL and Revline's saved picture). The request is recorded
 * under `code` with no id of the person; `stripPosts` then clears what the platform gave for each post.
 */
export const dataDeletion = internalMutation({
  args: { platform: postingPlatform, platformUserId: v.string(), code: v.string(), issuedAt: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, { platform, platformUserId, code, issuedAt }) => {
    // A request that arrives late or twice does not delete a connection the person made after asking.
    const now = Date.now(), accounts = (await connectionsOf(ctx, platform, platformUserId)).filter(account => !connectedAfter(account, issuedAt));
    for (const account of accounts) {
      if (account.avatarStorageId) await ctx.storage.delete(account.avatarStorageId);
      await ctx.db.delete(account._id);
    }
    const requestId = await ctx.db.insert('postingDeletionRequests', { code, platform, status: accounts.length ? 'received' : 'completed', createdAt: now, ...(accounts.length ? {} : { completedAt: now }) });
    if (accounts.length) await ctx.scheduler.runAfter(0, internal.postingCallbacks.stripPosts, { requestId, accountIds: accounts.map(account => account._id), cursor: null });
    return null;
  },
});

/**
 * Posts made to a deleted connection stay in their owner's history with what the owner made in Revline (the export,
 * caption, title and times). Everything the platform gave is removed: the post and job ids, the link, the stats, and
 * error text that names the account. A post that had not gone out is failed; one caught mid-upload is failed with a
 * note to check the account, since Instagram may still publish it. Runs a page at a time, then marks the request completed.
 */
export const stripPosts = internalMutation({
  args: { requestId: v.id('postingDeletionRequests'), accountIds: v.array(v.id('postingAccounts')), cursor: v.union(v.string(), v.null()) }, returns: v.null(),
  handler: async (ctx, { requestId, accountIds, cursor }) => {
    const now = Date.now(), [accountId, ...rest] = accountIds;
    if (!accountId) {
      await ctx.db.patch(requestId, { status: 'completed', completedAt: now });
      return null;
    }
    const page = await ctx.db.query('postingPosts').withIndex('by_account_status', q => q.eq('accountId', accountId)).paginate({ cursor, numItems: POSTS_PER_PASS });
    for (const post of page.page) {
      const outcome = post.status === 'published' ? { error: undefined }
        : post.status === 'failed' ? (post.error?.includes('@') ? { error: REMOVED } : {})
        : { status: 'failed' as const, error: post.status === 'scheduled' ? REMOVED : CUT_SHORT };
      await ctx.db.patch(post._id, { platformJobId: undefined, platformPostId: undefined, url: undefined, views: undefined, likes: undefined, comments: undefined, shares: undefined, statsFetchedAt: undefined, ...outcome, updatedAt: now });
    }
    await ctx.scheduler.runAfter(0, internal.postingCallbacks.stripPosts, page.isDone ? { requestId, accountIds: rest, cursor: null } : { requestId, accountIds, cursor: page.continueCursor });
    return null;
  },
});

/** The state of a data deletion request, for the public status page. Only the confirmation code opens it, and it says nothing about who asked. */
export const deletionStatus = query({
  args: { code: v.string() }, returns: v.union(deletionRequestStatus, v.null()),
  handler: async (ctx, { code }) => {
    if (!/^[a-f0-9]{32}$/.test(code)) return null;
    return (await ctx.db.query('postingDeletionRequests').withIndex('by_code', q => q.eq('code', code)).unique())?.status ?? null;
  },
});

/**
 * Meta signs with "your app secret". An Instagram Login app has two (the Instagram app secret, which is
 * INSTAGRAM_CLIENT_SECRET, and the Meta app's own) and Meta's pages do not say which signs these callbacks, so the
 * Meta app secret is accepted too when META_APP_SECRET is set.
 */
const appSecrets = () => [process.env.INSTAGRAM_CLIENT_SECRET, process.env.META_APP_SECRET].filter((secret): secret is string => !!secret);

/** The verified sender of a callback, or the response that refuses it: 400 without a readable signed request, 401 for a wrong signature. */
async function signedUser(request: Request): Promise<{ userId: string; issuedAt?: number } | Response> {
  const secrets = appSecrets();
  if (!secrets.length) return new Response('Instagram is not set up on this server', { status: 503 });
  const body = await boundedBody(request);
  if (body !== null && body.length > BODY_LIMIT) return new Response('Payload too large', { status: 413 });
  const signedRequest = body ? new URLSearchParams(body).get('signed_request') : null;
  if (!signedRequest) return new Response('signed_request is required', { status: 400 });
  const read = await readSignedRequest(signedRequest, secrets);
  if (!read.ok) return read.reason === 'signature' ? new Response('Invalid signature', { status: 401 }) : new Response('Invalid signed_request', { status: 400 });
  return read;
}

export function registerPostingCallbackRoutes(http: HttpRouter) {
  http.route({ path: '/instagram/deauthorize', method: 'POST', handler: httpAction(async (ctx, request) => {
    const user = await signedUser(request);
    if (user instanceof Response) return user;
    const ended = await ctx.runMutation(internal.postingCallbacks.deauthorized, { platform: 'instagram', platformUserId: user.userId, ...(user.issuedAt !== undefined ? { issuedAt: user.issuedAt } : {}) });
    // Never the id of the person or the account.
    console.log(`Posting: Instagram deauthorize callback ended ${ended} connection(s).`);
    return new Response('OK', { status: 200 });
  }) });
  http.route({ path: '/instagram/data-deletion', method: 'POST', handler: httpAction(async (ctx, request) => {
    const origin = process.env.APP_ORIGIN;
    if (!origin) return new Response('Instagram is not set up on this server', { status: 503 });
    const user = await signedUser(request);
    if (user instanceof Response) return user;
    const code = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    await ctx.runMutation(internal.postingCallbacks.dataDeletion, { platform: 'instagram', platformUserId: user.userId, code, ...(user.issuedAt !== undefined ? { issuedAt: user.issuedAt } : {}) });
    console.log('Posting: Instagram data deletion request recorded.');
    // The answer Meta requires: where the person can follow the request, and the code that identifies it.
    return new Response(JSON.stringify({ url: `${origin}/data-deletion/${code}`, confirmation_code: code }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) });
}
