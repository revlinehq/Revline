import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const postingPlatform = v.union(v.literal('instagram'), v.literal('tiktok'), v.literal('youtube'));
export const postStatus = v.union(v.literal('scheduled'), v.literal('posting'), v.literal('processing'), v.literal('published'), v.literal('failed'));
/**
 * A post that waits for its export: `queued` while the account's exports are all busy (no export started yet),
 * `waiting` until its export ends, then `created` (its batch exists), `failed` or `cancelled`.
 */
export const pendingPostStatus = v.union(v.literal('queued'), v.literal('waiting'), v.literal('created'), v.literal('failed'), v.literal('cancelled'));
export const accountStatus = v.union(v.literal('connected'), v.literal('needs_reconnect'), v.literal('disconnected'));

/** Tables of the posting base (convex/posting*): connected social accounts and the posts sent to them. */
export const postingTables = {
  // One connected social account. An owner can hold many per platform. `tokenCipher` is the AES-GCM sealed
  // AccountTokens (lib/posting/crypto.ts); it never leaves the server and is removed on disconnect.
  postingAccounts: defineTable({
    ownerId: v.string(), platform: postingPlatform, platformAccountId: v.string(), username: v.string(),
    displayName: v.optional(v.string()), avatarUrl: v.optional(v.string()), status: accountStatus, error: v.optional(v.string()),
    // Revline's own copy of the picture at `avatarUrl` (the platform's URL, which can expire), removed on disconnect.
    // `avatarCheckedAt`: when a token renewal last looked for a missing picture, so an account without one is asked weekly, not on every renewal.
    avatarStorageId: v.optional(v.id('_storage')), avatarCheckedAt: v.optional(v.number()),
    tokenCipher: v.optional(v.string()), tokenExpiresAt: v.optional(v.number()), scopes: v.array(v.string()),
    // Held while one action refreshes the tokens, so two posts never spend the same refresh token.
    refreshLeaseUntil: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
  }).index('by_owner', ['ownerId']).index('by_owner_platform_account', ['ownerId', 'platform', 'platformAccountId']),
  // A pending "connect account" round trip. The nonce is single-use: the callback deletes the row.
  postingOauthStates: defineTable({ nonce: v.string(), ownerId: v.string(), platform: postingPlatform, expiresAt: v.number() })
    .index('by_nonce', ['nonce']).index('by_expiresAt', ['expiresAt']),
  // One submit of the Post dialog: an export sent to several accounts with a shared default caption.
  postingBatches: defineTable({
    ownerId: v.string(), jobId: v.id('renderJobs'), projectId: v.id('projects'), exportLabel: v.string(),
    caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()),
    // Typed once convex/campaigns exists.
    campaignId: v.optional(v.string()), createdAt: v.number(),
  }).index('by_owner', ['ownerId', 'createdAt']),
  // One post to one account. `caption` is the text this account posts (the batch default or its override).
  // `dueAt` is when the scheduler acts next: the scheduled time, a retry time, or the next processing check.
  postingPosts: defineTable({
    ownerId: v.string(), batchId: v.id('postingBatches'), accountId: v.id('postingAccounts'), platform: postingPlatform, jobId: v.id('renderJobs'),
    caption: v.string(), title: v.optional(v.string()), status: postStatus, error: v.optional(v.string()), attempts: v.number(),
    scheduledAt: v.optional(v.number()), dueAt: v.number(), claimedAt: v.optional(v.number()),
    platformJobId: v.optional(v.string()), platformPostId: v.optional(v.string()), url: v.optional(v.string()), publishedAt: v.optional(v.number()),
    campaignId: v.optional(v.string()),
    // Latest stats from the platform. Estimated earnings (views x the campaign's rate) will be derived from `views` once campaigns carry a rate.
    views: v.optional(v.number()), likes: v.optional(v.number()), comments: v.optional(v.number()), shares: v.optional(v.number()), statsFetchedAt: v.optional(v.number()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index('by_owner_createdAt', ['ownerId', 'createdAt']).index('by_owner_status', ['ownerId', 'status', 'publishedAt']).index('by_batch', ['batchId'])
    .index('by_status_dueAt', ['status', 'dueAt']).index('by_status_publishedAt', ['status', 'publishedAt']).index('by_account_status', ['accountId', 'status']),
  // One press of Post in the editor (convex/postExports.ts). Posting needs a file, so the post is recorded against
  // an export of the timeline as it was at that moment and becomes a batch when that export completes.
  postingPending: defineTable({
    ownerId: v.string(), projectId: v.id('projects'), timelineId: v.string(), jobId: v.optional(v.id('renderJobs')),
    caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()), campaignId: v.optional(v.string()),
    accountIds: v.array(v.id('postingAccounts')), status: pendingPostStatus, error: v.optional(v.string()), batchId: v.optional(v.id('postingBatches')),
    createdAt: v.number(), updatedAt: v.number(),
  }).index('by_job', ['jobId']).index('by_owner_project', ['ownerId', 'projectId', 'createdAt']).index('by_status', ['status', 'createdAt']),
};
