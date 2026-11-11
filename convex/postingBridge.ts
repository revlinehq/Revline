import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireOwner } from './lib/auth';
import { billingEnabled, hasUltraPlan, requireEditorAccess } from './lib/billing_access';
import { accountStatus, postingPlatform } from './postingTables';
import { ACCOUNT_CAPS, capMessage } from '../lib/posting/account-caps';
import { PostingError, type PostingPlatform, type PublishCheck, type PublishInput } from '../lib/posting/adapter';
import { downloadAvatar } from '../lib/posting/avatar';
import { PLATFORM_NAMES, POSTING_PLATFORMS } from '../lib/posting/platform-names';
import { analytics, createConnectLink, deleteAccount, getAccount, listAccounts, syncAnalytics, PLAN_FULL, type BridgeAccount } from '../lib/posting/postbridge/client';
import { checkPublish, publish } from '../lib/posting/postbridge/publish';
import { accountsUrl, platformLive, postBridgeKey, postingProvider } from '../lib/posting/server';

// Posting through Post Bridge (lib/posting/postbridge): connecting accounts with its connect links, publishing,
// reading results and stats, and disconnecting. Post Bridge holds the platform tokens; Revline holds none for these.
//
// Tenant isolation. Every Revline user's accounts sit in Revline's one Post Bridge workspace, so the API key can
// reach all of them. What keeps users apart is here:
//   - a user's accounts are tagged with their own random reference (postingConnectRefs), set by the server on the link;
//   - an account is only stored for a user when Post Bridge reports that reference on it;
//   - the Post Bridge account id is only ever read from a row whose owner was checked, never taken from a client;
//   - before a post is created the account is read again and must still carry the owner's reference.

/** How long a connect link works. Whoever opens it connects an account for the user it was made for, so it is short. */
const LINK_SECONDS = 15 * 60;
const SIGN_IN_EXPIRED = 'This account’s sign-in expired. Reconnect it to keep posting.';
const GONE = 'This account is no longer connected. Reconnect it to keep posting.';
const TAKEN = 'This account was connected to another Revline account. Reconnect it to post from here.';
const UNAVAILABLE = 'Posting is not available right now. Please try again later.';
const isPlatform = (value: string): value is PostingPlatform => (POSTING_PLATFORMS as readonly string[]).includes(value);
const failure = (error: unknown, fallback: string) => error instanceof PostingError ? error.message : fallback;

/** How many accounts this owner may connect per platform (lib/posting/account-caps.ts). A deployment without billing meters no one. */
export async function accountCap(ctx: QueryCtx | MutationCtx, ownerId: string): Promise<number> {
  if (!billingEnabled()) return ACCOUNT_CAPS.paid;
  if (await hasUltraPlan(ctx, ownerId)) return ACCOUNT_CAPS.ultra;
  return requireEditorAccess(ctx, ownerId).then(() => ACCOUNT_CAPS.paid, () => ACCOUNT_CAPS.none);
}
/** An account that takes one of the owner's slots: connected through Post Bridge and not disconnected. */
export const holdsSlot = (account: Doc<'postingAccounts'>) => account.provider === 'postbridge' && account.status !== 'disconnected';
const ownerAccounts = (ctx: QueryCtx | MutationCtx, ownerId: string) => ctx.db.query('postingAccounts').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect();
export const ownerRef = async (ctx: QueryCtx | MutationCtx, ownerId: string) => (await ctx.db.query('postingConnectRefs').withIndex('by_owner', q => q.eq('ownerId', ownerId)).first())?.ref ?? null;

// ---------------------------------------------------------------- connect

/**
 * Begin connecting: checks the signed-in owner, the platform and the owner's cap, and returns the reference their
 * accounts are tagged with (created on first use). `accountId`: an account of theirs being reconnected, which takes no new slot.
 */
export const begin = internalMutation({
  args: { platform: postingPlatform, accountId: v.optional(v.id('postingAccounts')) }, returns: v.string(),
  handler: async (ctx, { platform, accountId }) => {
    const ownerId = await requireOwner(ctx);
    if (!platformLive(platform)) throw new ConvexError('This platform is coming soon.');
    const accounts = await ownerAccounts(ctx, ownerId), cap = await accountCap(ctx, ownerId);
    const renewing = accountId !== undefined && accounts.some(account => account._id === accountId && account.platform === platform && holdsSlot(account));
    if (!renewing && accounts.filter(account => account.platform === platform && holdsSlot(account)).length >= cap) throw new ConvexError(capMessage(PLATFORM_NAMES[platform], cap));
    const existing = await ownerRef(ctx, ownerId);
    if (existing) return existing;
    const ref = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
    await ctx.db.insert('postingConnectRefs', { ownerId, ref, createdAt: Date.now() });
    return ref;
  },
});

/** The link the user is sent to: the platform's consent screen, then back to Connected accounts. */
export async function connectLink(ctx: ActionCtx, platform: PostingPlatform, accountId?: Id<'postingAccounts'>): Promise<string> {
  const externalRef: string = await ctx.runMutation(internal.postingBridge.begin, { platform, ...(accountId ? { accountId } : {}) });
  const key = postBridgeKey();
  if (!key) throw new ConvexError('This platform is coming soon.');
  try { return await createConnectLink(key, { platform, returnUrl: accountsUrl(), externalRef, expiresInSeconds: LINK_SECONDS }); }
  catch (error) {
    // Revline's own Post Bridge plan is full: nothing the user can change, so it is logged for whoever runs the server.
    if (error instanceof PostingError && error.code === PLAN_FULL) console.error('Posting: Post Bridge refused a connect link because the plan’s account cap is reached. Raise it on the Post Bridge billing page.');
    throw new ConvexError(failure(error, 'Could not start connecting this account. Please try again.'));
  }
}

/** Opening a page again within this time reads nothing new from Post Bridge; coming back from a connect link always may, after a few seconds. */
const SYNC_EVERY_MS = 60_000, SYNC_AFTER_LINK_MS = 3_000;
/** An account without a saved picture is asked for one again this often. */
const PICTURE_RECHECK_MS = 7 * 86400_000;

/** What a sync needs to know about the signed-in owner: their reference and the accounts already stored for it. Null before they ever started connecting. */
export const syncState = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object({
    ownerId: v.string(), ref: v.string(), syncedAt: v.number(),
    known: v.array(v.object({ providerAccountId: v.number(), hasPicture: v.boolean(), pictureCheckedAt: v.number(), connectedAt: v.number() })),
  })),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx), row = await ctx.db.query('postingConnectRefs').withIndex('by_owner', q => q.eq('ownerId', ownerId)).first();
    if (!row) return null;
    const known = (await ownerAccounts(ctx, ownerId)).flatMap(account => holdsSlot(account) && account.providerAccountId !== undefined
      ? [{ providerAccountId: account.providerAccountId, hasPicture: !!account.avatarStorageId, pictureCheckedAt: account.avatarCheckedAt ?? 0, connectedAt: account.connectedAt ?? account.createdAt }] : []);
    return { ownerId, ref: row.ref, syncedAt: row.syncedAt ?? 0, known };
  },
});

const listed = v.object({
  id: v.number(), platform: postingPlatform, username: v.string(), avatarUrl: v.optional(v.string()), avatarStorageId: v.optional(v.id('_storage')),
  /** A picture was looked for in this sync, whether or not one was saved. */
  pictureChecked: v.boolean(), needsReconnect: v.boolean(), linkedAt: v.optional(v.number()),
});
/**
 * Store what Post Bridge lists under the owner's reference. An account already stored is refreshed; a new one is
 * added while the owner is under their cap, and returned in `over` otherwise so the caller removes it at Post
 * Bridge. With a `complete` listing, a stored account that is no longer listed needs reconnecting. `listedAt`: when
 * the listing was asked for, so an account disconnected since then is not brought back by it.
 * `connected` are the handles this sync connected or renewed.
 */
export const applySync = internalMutation({
  args: { ownerId: v.string(), ref: v.string(), complete: v.boolean(), listedAt: v.number(), accounts: v.array(listed) },
  returns: v.object({ connected: v.array(v.string()), over: v.array(v.number()), cap: v.number() }),
  handler: async (ctx, { ownerId, ref, complete, listedAt, accounts }) => {
    const drop = async () => { for (const account of accounts) if (account.avatarStorageId) await ctx.storage.delete(account.avatarStorageId); };
    // The reference must be this owner's: the listing was filtered by it.
    const refRow = await ctx.db.query('postingConnectRefs').withIndex('by_owner', q => q.eq('ownerId', ownerId)).first();
    if (refRow?.ref !== ref) { await drop(); throw new ConvexError('Account not found'); }
    const now = Date.now(), cap = await accountCap(ctx, ownerId), rows = await ownerAccounts(ctx, ownerId);
    await ctx.db.patch(refRow._id, { syncedAt: now });
    const slots = new Map<PostingPlatform, number>(), present = new Set(accounts.map(account => account.id));
    for (const row of rows) if (holdsSlot(row)) slots.set(row.platform, (slots.get(row.platform) ?? 0) + 1);
    const connected: string[] = [], over: number[] = [], used = new Set<Id<'postingAccounts'>>();
    for (const incoming of accounts) {
      const unused = async () => { if (incoming.avatarStorageId) await ctx.storage.delete(incoming.avatarStorageId); };
      const sameHandle = (candidate: Doc<'postingAccounts'>) => candidate.platform === incoming.platform && candidate.username.toLowerCase() === incoming.username.toLowerCase() && !used.has(candidate._id);
      const holder = await ctx.db.query('postingAccounts').withIndex('by_provider_account', q => q.eq('provider', 'postbridge').eq('providerAccountId', incoming.id)).first();
      let row = holder?.ownerId === ownerId ? holder : null;
      // Post Bridge reports this account under this owner's reference now, so another owner's row for it has ended.
      if (holder && holder.ownerId !== ownerId) await ctx.db.patch(holder._id, { providerAccountId: undefined, ...(holder.status === 'connected' ? { status: 'needs_reconnect' as const, error: TAKEN } : {}), updatedAt: now });
      // Disconnected here and still listed: it is waiting to be removed at Post Bridge, unless it was connected again since.
      if (row?.status === 'disconnected' && !((incoming.linkedAt ?? 0) > row.updatedAt)) { await unused(); continue; }
      // Disconnected while this listing was on its way: the listing is older than the disconnect and does not undo it.
      if (!row && rows.some(candidate => sameHandle(candidate) && candidate.status === 'disconnected' && candidate.updatedAt >= listedAt)) { await unused(); continue; }
      // The same handle keeps its row, so its post history stays attached: one connected before through Revline's own
      // apps or disconnected since, or one that needs reconnecting and came back under a new Post Bridge id.
      row ??= rows.find(candidate => sameHandle(candidate) && (!holdsSlot(candidate) || candidate.status === 'needs_reconnect' && (candidate.providerAccountId === undefined || !present.has(candidate.providerAccountId)))) ?? null;
      const held = !!row && holdsSlot(row);
      if (!held && (slots.get(incoming.platform) ?? 0) >= cap) { over.push(incoming.id); await unused(); continue; }
      if (!held) slots.set(incoming.platform, (slots.get(incoming.platform) ?? 0) + 1);
      const renewed = !held || row!.providerAccountId !== incoming.id || (incoming.linkedAt ?? 0) > (row!.connectedAt ?? row!.createdAt);
      if (renewed) connected.push(incoming.username);
      const fields = {
        provider: 'postbridge' as const, providerAccountId: incoming.id, username: incoming.username,
        status: incoming.needsReconnect ? 'needs_reconnect' as const : 'connected' as const, error: incoming.needsReconnect ? SIGN_IN_EXPIRED : undefined, updatedAt: now,
        ...(incoming.avatarUrl ? { avatarUrl: incoming.avatarUrl } : {}), ...(incoming.avatarStorageId ? { avatarStorageId: incoming.avatarStorageId } : {}), ...(incoming.pictureChecked ? { avatarCheckedAt: now } : {}),
      };
      if (!row) { await ctx.db.insert('postingAccounts', { ownerId, platform: incoming.platform, platformAccountId: `postbridge:${incoming.id}`, scopes: [], createdAt: now, connectedAt: now, ...fields }); continue; }
      used.add(row._id);
      if (row.avatarStorageId && incoming.avatarStorageId) await ctx.storage.delete(row.avatarStorageId);
      await ctx.db.patch(row._id, { ...fields, refreshLeaseUntil: undefined, ...(renewed ? { connectedAt: now } : {}) });
      // Post Bridge holds this account's tokens from here on. The ones Revline stored through its own app are
      // revoked at the platform, then deleted.
      if (row.tokenCipher !== undefined) await ctx.scheduler.runAfter(0, internal.postingActions.revokeAccount, { accountId: row._id });
    }
    if (complete) {
      for (const row of rows) if (row.provider === 'postbridge' && row.status === 'connected' && !used.has(row._id) && row.providerAccountId !== undefined && !present.has(row.providerAccountId)) await ctx.db.patch(row._id, { status: 'needs_reconnect', error: GONE, updatedAt: now });
    }
    return { connected, over, cap };
  },
});

/**
 * Read the signed-in owner's accounts from Post Bridge and store them. Run when they come back from a connect link
 * (`afterLink`) and whenever Connected accounts opens (Post Bridge has no webhooks). Nothing in the return address
 * is trusted: the accounts are the ones Post Bridge lists under the owner's own reference.
 */
export async function syncAccounts(ctx: ActionCtx, afterLink: boolean): Promise<{ connected: string[]; overLimit: number; cap: number }> {
  const key = postBridgeKey(), nothing = { connected: [], overLimit: 0, cap: 0 };
  if (postingProvider() !== 'postbridge' || !key) return nothing;
  const state = await ctx.runQuery(internal.postingBridge.syncState, {}), listedAt = Date.now();
  // Every user shares Revline's one API key and its rate limit, so the same accounts are not read again right away.
  if (!state || listedAt - state.syncedAt < (afterLink ? SYNC_AFTER_LINK_MS : SYNC_EVERY_MS)) return nothing;
  const { accounts: all, complete } = await listAccounts(key, state.ref);
  // The listing was filtered by the reference; an account without it is refused all the same.
  const mine = all.filter((account): account is BridgeAccount & { platform: PostingPlatform } => account.externalRef === state.ref && isPlatform(account.platform));
  if (mine.length !== all.length) console.warn(`Posting: ${all.length - mine.length} listed account(s) were ignored (another reference or a platform Revline does not post to).`);
  const stored: Id<'_storage'>[] = [];
  try {
    const accounts = await Promise.all(mine.map(async account => {
      const known = state.known.find(entry => entry.providerAccountId === account.id);
      // Revline keeps its own copy of the picture: for a new account, one connected again since, and weekly for one that has none.
      const pictureChecked = !known || (account.linkedAt ?? 0) > known.connectedAt || !known.hasPicture && listedAt - known.pictureCheckedAt > PICTURE_RECHECK_MS;
      const picture = pictureChecked ? await downloadAvatar(account.pictureUrl) : null, avatarStorageId = picture ? await ctx.storage.store(picture).catch(() => undefined) : undefined;
      if (avatarStorageId) stored.push(avatarStorageId);
      return { id: account.id, platform: account.platform, username: account.username, needsReconnect: account.needsReconnect, pictureChecked, ...(account.pictureUrl ? { avatarUrl: account.pictureUrl } : {}), ...(avatarStorageId ? { avatarStorageId } : {}), ...(account.linkedAt ? { linkedAt: account.linkedAt } : {}) };
    }));
    const result = await ctx.runMutation(internal.postingBridge.applySync, { ownerId: state.ownerId, ref: state.ref, complete, listedAt, accounts });
    // Over the cap: the account is removed at Post Bridge, so it neither posts nor costs a slot.
    for (const id of result.over) await deleteAccount(key, id).catch(error => console.error(`Posting: Post Bridge account ${id} is over its owner's cap and could not be removed there, where it still takes a slot. ${failure(error, '')}`));
    return { connected: result.connected, overLimit: result.over.length, cap: result.cap };
  } catch (error) {
    for (const storageId of stored) await ctx.storage.delete(storageId).catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------- one account, for the server

const target = v.object({ ownerId: v.string(), platform: postingPlatform, username: v.string(), status: accountStatus, providerAccountId: v.union(v.number(), v.null()), ref: v.union(v.string(), v.null()) });
/** An account's Post Bridge id together with its owner's reference. Internal: callers have already established whose account it is. */
export const account = internalQuery({
  args: { accountId: v.id('postingAccounts') }, returns: v.union(v.null(), target),
  handler: async (ctx, { accountId }) => {
    const row = await ctx.db.get(accountId);
    if (!row) return null;
    return { ownerId: row.ownerId, platform: row.platform, username: row.username, status: row.status, providerAccountId: row.provider === 'postbridge' ? row.providerAccountId ?? null : null, ref: await ownerRef(ctx, row.ownerId) };
  },
});

// ---------------------------------------------------------------- disconnect

const REMOVE_RETRY_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 3600_000];
/** The account was removed at Post Bridge: forget its id, unless the row points at an account connected since. */
export const detached = internalMutation({
  args: { accountId: v.id('postingAccounts'), providerAccountId: v.number() }, returns: v.null(),
  handler: async (ctx, { accountId, providerAccountId }) => {
    const row = await ctx.db.get(accountId);
    if (row?.status === 'disconnected' && row.providerAccountId === providerAccountId) await ctx.db.patch(accountId, { providerAccountId: undefined });
    return null;
  },
});
/** Which Post Bridge account a removal is about. Read from the row once, then carried by the retries: the row may be swept (a deleted Revline account) before the removal goes through. */
export type Removal = { accountId: Id<'postingAccounts'>; providerAccountId?: number; ref?: string };
/**
 * Remove an account at Post Bridge, which ends its access to the platform account and frees the slot it was billed
 * for: one that was disconnected here, or one its row no longer points at. The account is already gone for the user.
 * A removal that does not go through is tried again a few times (`attempt`), then logged with Post Bridge's account
 * id: until it succeeds the account still counts on Revline's Post Bridge plan.
 */
export async function removeAtProvider(ctx: ActionCtx, removal: Removal, attempt: number): Promise<void> {
  const row = await ctx.runQuery(internal.postingBridge.account, { accountId: removal.accountId });
  const providerAccountId = removal.providerAccountId ?? row?.providerAccountId ?? undefined, ref = removal.ref ?? row?.ref ?? undefined;
  if (providerAccountId === undefined) return;
  // Connected again in the meantime, on the same Post Bridge account: it stays.
  if (row && row.status !== 'disconnected' && row.providerAccountId === providerAccountId) return;
  const key = postBridgeKey();
  try {
    if (!key) throw new PostingError('POSTBRIDGE_API_KEY is not set.', true);
    if (!ref) throw new PostingError('The owner’s reference is missing, so the account cannot be checked before removing it.', false);
    const remote = await getAccount(key, providerAccountId);
    // Only an account that still carries this owner's reference is removed.
    if (remote && remote.externalRef === ref) await deleteAccount(key, providerAccountId);
    await ctx.runMutation(internal.postingBridge.detached, { accountId: removal.accountId, providerAccountId });
  } catch (error) {
    const delay = error instanceof PostingError && !error.retryable ? undefined : REMOVE_RETRY_MS[attempt];
    if (delay !== undefined) await ctx.scheduler.runAfter(delay, internal.postingActions.removeProviderAccount, { accountId: removal.accountId, providerAccountId, ...(ref ? { ref } : {}), attempt: attempt + 1 });
    else console.error(`Posting: Post Bridge account ${providerAccountId} was disconnected in Revline but could not be removed at Post Bridge, where it still takes a slot. ${failure(error, 'Unexpected error.')}`);
  }
}

// ---------------------------------------------------------------- publish and check

type Outcome = { status: 'published'; platformPostId: string; url: string; providerResultId?: string } | { status: 'processing'; platformJobId: string } | { status: 'failed'; error: string; retryable: boolean };

/** Send a claimed post. Post Bridge publishes it at once and reports the outcome later, so success here is `processing`. */
export async function publishPost(ctx: ActionCtx, accountId: Id<'postingAccounts'>, platform: PostingPlatform, input: PublishInput): Promise<Outcome> {
  const key = postBridgeKey();
  if (!key) return { status: 'failed', error: UNAVAILABLE, retryable: true };
  const row = await ctx.runQuery(internal.postingBridge.account, { accountId });
  const reconnect = async (error: string): Promise<Outcome> => {
    await ctx.runMutation(internal.posting.refreshFailed, { accountId, reconnect: true, error });
    return { status: 'failed', error: `Reconnect @${row?.username ?? 'this account'}, then retry.`, retryable: false };
  };
  if (!row || row.providerAccountId === null || !row.ref) return reconnect(GONE);
  try {
    // Read again right before posting: the account must still exist, be this platform's, and carry this owner's reference.
    const remote = await getAccount(key, row.providerAccountId);
    if (!remote || remote.externalRef !== row.ref || remote.platform !== platform) return reconnect(GONE);
    if (remote.needsReconnect) return reconnect(SIGN_IN_EXPIRED);
    return { status: 'processing', platformJobId: await publish(key, row.providerAccountId, platform, input) };
  } catch (error) {
    // An error nobody classified may have reached the platform; retrying it could post twice.
    return { status: 'failed', error: failure(error, 'Posting stopped unexpectedly. Check the account first, then retry if the video is not there.'), retryable: error instanceof PostingError && error.retryable };
  }
}

/** Poll a post Post Bridge is still publishing. Throws PostingError when the poll itself could not run. */
export async function checkPost(ctx: ActionCtx, accountId: Id<'postingAccounts'>, platform: PostingPlatform, job: string): Promise<PublishCheck & { providerResultId?: string }> {
  const key = postBridgeKey();
  if (!key) throw new PostingError(UNAVAILABLE, true);
  // The post was already handed over, and its job says which Post Bridge account it went to: its outcome is still
  // read when the account was disconnected or reconnected since. The row only names the account for a missing link.
  const row = await ctx.runQuery(internal.postingBridge.account, { accountId });
  // A poll that could not run, or that Post Bridge refused, says nothing about the post: it is asked again later.
  try { return await checkPublish(key, job, { platform, username: row?.username ?? '' }); }
  catch (error) { throw new PostingError(failure(error, 'The post’s outcome could not be read.'), true); }
}

// ---------------------------------------------------------------- stats

const HOUR = 3600_000;
/** Numbers move fastest right after a post goes out: read hourly for two days, then once a day until the stats window ends. */
const HOURLY_FOR_MS = 48 * HOUR;
const statsDue = (post: { publishedAt: number; statsFetchedAt?: number }, now: number) => !post.statsFetchedAt || now - post.statsFetchedAt >= (now - post.publishedAt <= HOURLY_FOR_MS ? HOUR : 24 * HOUR) - 10 * 60_000;
const STATS_BATCH = 50;

export const saveStats = internalMutation({
  args: { fetchedAt: v.number(), posts: v.array(v.object({ postId: v.id('postingPosts'), numbers: v.optional(v.object({ views: v.number(), likes: v.number(), comments: v.number(), shares: v.number() })), url: v.optional(v.string()) })) }, returns: v.null(),
  handler: async (ctx, { fetchedAt, posts }) => {
    for (const { postId, numbers, url } of posts) {
      const post = await ctx.db.get(postId);
      // A post Post Bridge has no numbers for yet keeps what it had; it is still marked as read, so it waits for its next turn.
      // The platform's own link replaces the account page a post was given when it had none yet.
      if (post) await ctx.db.patch(postId, { ...numbers, statsFetchedAt: fetchedAt, ...(url && url !== post.url ? { url } : {}) });
    }
    return null;
  },
});

/**
 * Stats for posts sent through Post Bridge: the posts whose turn it is are collected, Post Bridge is asked once to
 * read fresh numbers from the platforms, and the numbers come back 50 posts per request. One post costs no call of its own.
 */
export async function refreshStats(ctx: ActionCtx, since: number): Promise<void> {
  const key = postBridgeKey();
  if (!key) return;
  const now = Date.now(), due: { postId: Id<'postingPosts'>; resultId: string }[] = [];
  for (let cursor: string | null = null, done = false; !done;) {
    const page: { posts: { postId: Id<'postingPosts'>; providerResultId?: string; publishedAt: number; statsFetchedAt?: number }[]; cursor: string; done: boolean } = await ctx.runQuery(internal.posting.statsPage, { cursor, since });
    for (const post of page.posts) if (post.providerResultId && statsDue(post, now)) due.push({ postId: post.postId, resultId: post.providerResultId });
    cursor = page.cursor; done = page.done;
  }
  if (!due.length) return;
  await syncAnalytics(key);
  for (let index = 0; index < due.length; index += STATS_BATCH) {
    const batch = due.slice(index, index + STATS_BATCH);
    try {
      const numbers = new Map((await analytics(key, batch.map(post => post.resultId))).map(row => [row.resultId, row]));
      await ctx.runMutation(internal.postingBridge.saveStats, { fetchedAt: now, posts: batch.map(post => {
        const row = numbers.get(post.resultId);
        return { postId: post.postId, ...(row ? { numbers: { views: row.views, likes: row.likes, comments: row.comments, shares: row.shares }, ...(row.url ? { url: row.url } : {}) } : {}) };
      }) });
    } catch { /* One batch failing leaves its posts' last numbers in place; they are read again at the next run. */ }
  }
}
