import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const postingPlatform = v.union(v.literal('instagram'), v.literal('tiktok'), v.literal('youtube'));
export const postStatus = v.union(v.literal('scheduled'), v.literal('posting'), v.literal('processing'), v.literal('published'), v.literal('failed'));
/**
 * A post that waits for its export: `queued` while the account's exports are all busy (no export started yet),
 * `waiting` until its export ends, then `created` (its batch exists), `failed` or `cancelled`.
 */
export const pendingPostStatus = v.union(v.literal('queued'), v.literal('waiting'), v.literal('created'), v.literal('failed'), v.literal('cancelled'));
/** Who can view a post. YouTube takes the first three; TikTok takes its own privacy levels; Instagram has none. */
export const youtubeVisibility = v.union(v.literal('public'), v.literal('unlisted'), v.literal('private'));
export const tiktokVisibility = v.union(v.literal('PUBLIC_TO_EVERYONE'), v.literal('MUTUAL_FOLLOW_FRIENDS'), v.literal('FOLLOWER_OF_CREATOR'), v.literal('SELF_ONLY'));
export const postVisibility = v.union(youtubeVisibility, tiktokVisibility);
/** The per-post choices TikTok's Direct Post rules make the user tick themselves. Absent means off. */
export const tiktokChoices = v.object({
  allowComment: v.optional(v.boolean()), allowDuet: v.optional(v.boolean()), allowStitch: v.optional(v.boolean()),
  yourBrand: v.optional(v.boolean()), brandedContent: v.optional(v.boolean()),
});
/** What one account's post takes when it differs from the shared text: its own caption or title, who can view it, TikTok's per-post settings. */
export const postTarget = v.object({ accountId: v.id('postingAccounts'), caption: v.optional(v.string()), title: v.optional(v.string()), visibility: v.optional(postVisibility), tiktok: v.optional(tiktokChoices) });
/** Set on what the assistant or an MCP agent created, so the Posts page can say so. Absent on posts the user made by hand. */
export const postAuthor = { createdBy: v.optional(v.literal('assistant')), agentName: v.optional(v.string()) };
/** What a TikTok account's post can be given (postingActions.tiktokCreatorFor). */
export const tiktokCreator = v.object({ accountId: v.id('postingAccounts'), error: v.optional(v.string()), privacyLevels: v.optional(v.array(tiktokVisibility)), maxDurationSeconds: v.optional(v.number()) });
export const accountStatus = v.union(v.literal('connected'), v.literal('needs_reconnect'), v.literal('disconnected'));
/** No longer written (see `postingDeletionRequests`). */
export const deletionRequestStatus = v.union(v.literal('received'), v.literal('completed'));

/** Tables of the posting base (convex/posting*): connected social accounts and the posts sent to them. */
export const postingTables = {
  // One connected social account. An owner can hold several per platform (lib/posting/account-caps.ts). Post Bridge
  // holds its tokens. `tokenCipher`, `tokenExpiresAt`, `refreshLeaseUntil`, `platformScopedId` and `scopes` are from
  // accounts connected through Revline's own platform apps, before Post Bridge: no longer written, and the stored
  // tokens are deleted (posting.tick).
  postingAccounts: defineTable({
    ownerId: v.string(), platform: postingPlatform, platformAccountId: v.string(), username: v.string(),
    // The platform's second id for the same account, where it has one (Instagram: the app-scoped id beside the
    // professional account id). A platform callback may name the account by either. `connectedAt`: the last connect or
    // reconnect, so a callback issued before it does not end the newer connection.
    platformScopedId: v.optional(v.string()), connectedAt: v.optional(v.number()),
    displayName: v.optional(v.string()), avatarUrl: v.optional(v.string()), status: accountStatus, error: v.optional(v.string()),
    // Revline's own copy of the picture at `avatarUrl` (the platform's URL, which can expire), removed on disconnect.
    // `avatarCheckedAt`: when a token renewal last looked for a missing picture, so an account without one is asked weekly, not on every renewal.
    avatarStorageId: v.optional(v.id('_storage')), avatarCheckedAt: v.optional(v.number()),
    tokenCipher: v.optional(v.string()), tokenExpiresAt: v.optional(v.number()), scopes: v.array(v.string()),
    // Held while one action refreshes the tokens, so two posts never spend the same refresh token.
    refreshLeaseUntil: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
    // Set on an account connected through Post Bridge: `providerAccountId` is Post Bridge's social account id. An
    // account without `provider` was connected before Post Bridge and needs reconnecting. Revline's whole user base shares one Post Bridge workspace, so this row is the
    // only thing that says whose account that id is; no id from a client is ever sent to Post Bridge.
    provider: v.optional(v.literal('postbridge')), providerAccountId: v.optional(v.number()),
  }).index('by_owner', ['ownerId']).index('by_provider_account', ['provider', 'providerAccountId']).index('by_owner_platform_account', ['ownerId', 'platform', 'platformAccountId'])
    // No longer read: these found the accounts a platform callback named, when Revline ran its own platform apps.
    .index('by_platform_account', ['platform', 'platformAccountId']).index('by_platform_scoped', ['platform', 'platformScopedId']),
  // No longer written: one data deletion request sent by Meta while Revline ran its own Instagram app. Post Bridge's
  // app receives those callbacks now.
  postingDeletionRequests: defineTable({ code: v.string(), platform: postingPlatform, status: deletionRequestStatus, createdAt: v.number(), completedAt: v.optional(v.number()) })
    .index('by_code', ['code']),
  // The reference Post Bridge tags a user's accounts with (`external_ref` on its connect links): random, so it
  // cannot be guessed from a user id, and fixed for the user, so every account they connect carries the same one.
  // `syncedAt`: when the user's accounts were last read from Post Bridge, so opening a page often does not spend the shared API key's rate limit.
  postingConnectRefs: defineTable({ ownerId: v.string(), ref: v.string(), createdAt: v.number(), syncedAt: v.optional(v.number()) }).index('by_owner', ['ownerId']).index('by_ref', ['ref']),
  // No longer written: a pending sign-in to one of Revline's own platform apps. Leftover rows are deleted by posting.tick.
  postingOauthStates: defineTable({ nonce: v.string(), ownerId: v.string(), platform: postingPlatform, expiresAt: v.number() })
    .index('by_nonce', ['nonce']).index('by_expiresAt', ['expiresAt']),
  // One submit of the Post dialog: an export sent to several accounts with a shared default caption.
  postingBatches: defineTable({
    ownerId: v.string(), jobId: v.id('renderJobs'), projectId: v.id('projects'), exportLabel: v.string(),
    caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()),
    // Typed once convex/campaigns exists.
    campaignId: v.optional(v.string()), createdAt: v.number(), ...postAuthor,
  }).index('by_owner', ['ownerId', 'createdAt']),
  // One post to one account. `caption` is the text this account posts (the batch default or its override).
  // `dueAt` is when the scheduler acts next: the scheduled time, a retry time, or the next processing check.
  postingPosts: defineTable({
    ownerId: v.string(), batchId: v.id('postingBatches'), accountId: v.id('postingAccounts'), platform: postingPlatform, jobId: v.id('renderJobs'),
    caption: v.string(), title: v.optional(v.string()), status: postStatus, error: v.optional(v.string()), attempts: v.number(),
    scheduledAt: v.optional(v.number()), dueAt: v.number(), claimedAt: v.optional(v.number()),
    platformJobId: v.optional(v.string()), platformPostId: v.optional(v.string()), url: v.optional(v.string()), publishedAt: v.optional(v.number()),
    campaignId: v.optional(v.string()),
    // What the user chose in the Post dialog: who can view the post (YouTube, TikTok) and TikTok's interaction and
    // disclosure settings. Absent on posts made before the choice existed and on Instagram posts.
    visibility: v.optional(postVisibility), tiktok: v.optional(tiktokChoices),
    // Latest stats from the platform. Estimated earnings (views x the campaign's rate) will be derived from `views` once campaigns carry a rate.
    views: v.optional(v.number()), likes: v.optional(v.number()), comments: v.optional(v.number()), shares: v.optional(v.number()), statsFetchedAt: v.optional(v.number()),
    // Set when the post was handed to Post Bridge: its job id and its outcome are Post Bridge's, whatever its account is
    // connected through later. `providerResultId` is Post Bridge's id for the outcome, which its analytics are read by.
    provider: v.optional(v.literal('postbridge')), providerResultId: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index('by_owner_createdAt', ['ownerId', 'createdAt']).index('by_owner_status', ['ownerId', 'status', 'publishedAt']).index('by_batch', ['batchId'])
    .index('by_status_dueAt', ['status', 'dueAt']).index('by_status_publishedAt', ['status', 'publishedAt']).index('by_account_status', ['accountId', 'status'])
    // The owner's latest post on one platform: where the Post dialog reads the last-used YouTube visibility.
    .index('by_owner_platform', ['ownerId', 'platform', 'createdAt']),
  // One press of Post in the editor (convex/postExports.ts). Posting needs a file, so the post is recorded against
  // an export of the timeline as it was at that moment and becomes a batch when that export completes.
  postingPending: defineTable({
    ownerId: v.string(), projectId: v.id('projects'), timelineId: v.string(), jobId: v.optional(v.id('renderJobs')),
    caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()), campaignId: v.optional(v.string()),
    accountIds: v.array(v.id('postingAccounts')), status: pendingPostStatus, error: v.optional(v.string()), batchId: v.optional(v.id('postingBatches')),
    createdAt: v.number(), updatedAt: v.number(),
    // Posts the assistant made (convex/assistantPosting.ts): each account's own choices, who made it, and the key
    // that makes a repeated tool call return this post instead of creating a second one.
    targets: v.optional(v.array(postTarget)), ...postAuthor, idempotencyKey: v.optional(v.string()),
  }).index('by_job', ['jobId']).index('by_owner_project', ['ownerId', 'projectId', 'createdAt']).index('by_status', ['status', 'createdAt'])
    .index('by_owner_key', ['ownerId', 'idempotencyKey']).index('by_owner_createdAt', ['ownerId', 'createdAt']),
  // What the in-app assistant asked to post, shown as a card in the chat. Nothing is exported or sent until the
  // signed-in user presses the card; `pendingIds` are the posts that press created.
  postingProposals: defineTable({
    ownerId: v.string(), projectId: v.id('projects'), timelineIds: v.array(v.string()), targets: v.array(postTarget),
    caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()),
    status: v.union(v.literal('proposed'), v.literal('confirmed'), v.literal('cancelled')), pendingIds: v.optional(v.array(v.id('postingPending'))),
    // What TikTok allowed each chosen TikTok account when the card was made, so the press checks the clip against it again.
    tiktokCreators: v.optional(v.array(tiktokCreator)),
    createdAt: v.number(), expiresAt: v.number(),
  }).index('by_owner', ['ownerId', 'createdAt']).index('by_expiresAt', ['expiresAt']),
};
