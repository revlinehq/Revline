import { ConvexError, v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireOwner, requireProject } from './lib/auth';
import { groupAccounts, ownerGroups, sameName } from './lib/posting_groups';
import { accountState, batchText, cancelPostFor, notSent, postChoices, requirePosting, reschedulePostFor, scheduleTime } from './posting';
import { clipShape, exportPlan, pendingForKey, startPendingFor } from './postExports';
import { postTarget, postVisibility, tiktokChoices, tiktokCreator, tiktokVisibility } from './postingTables';
import { tabsOf, storedTabTimeline } from './timelineTabs';
import { MAX_EXPORT_LABEL, MAX_EXPORT_SECONDS } from '../lib/editor/limits';
import { PLATFORM_NAMES } from '../lib/posting/platform-names';
import { shapeProblems, textProblems } from '../lib/posting/precheck';
import { POSTING_NOT_SET_UP } from '../lib/posting/limits';
import { postingReady } from '../lib/posting/server';
import { TIKTOK_VISIBILITY_NAMES, VISIBILITY_OPTIONS, isTikTokVisibility } from '../lib/posting/visibility';

// Posting for the assistant: one implementation behind the in-app assistant's tools and the MCP tools
// (convex/lib/editorToolkit.ts). Every function takes the owner the caller was authenticated as and reads or writes
// only that owner's projects, accounts and posts. A post is an export followed by the posts (convex/postExports.ts):
// nothing here talks to a platform, and nothing is sent without the user's confirmation, which is the press of the
// card in the editor's chat (`confirmProposal`, a signed-in mutation) or `confirm: true` over MCP (`send`).

const CLIP_LIMIT = 10, ACCOUNT_LIMIT = 20, PROPOSAL_MS = 15 * 60_000;
const iso = (time: number | undefined | null) => time ? new Date(time).toISOString() : undefined;

/** What a posting tool call asks for: these timeline tabs of one project, to these accounts, with this text. */
const request = {
  projectId: v.id('projects'), timelineIds: v.array(v.string()), targets: v.array(postTarget), caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()),
  /** What TikTok said each chosen TikTok account may do, read by the tool just before this call (postingActions.tiktokCreatorFor). */
  tiktokCreators: v.array(tiktokCreator),
  /** The account group the request was made from (its accounts are in `targets`), and its accounts left out because they need reconnecting. */
  groupId: v.optional(v.id('postingGroups')), skippedAccountIds: v.optional(v.array(v.id('postingAccounts'))),
};
const requestObject = v.object(request);
type PostRequest = Infer<typeof requestObject>;

/** The owner's connected accounts as the posting tools list them. Tokens are never read here. */
export const accounts = internalQuery({
  args: { ownerId: v.string() }, returns: v.any(),
  handler: async (ctx, { ownerId }) => {
    const rows = await ctx.db.query('postingAccounts').withIndex('by_owner', q => q.eq('ownerId', ownerId)).collect();
    return rows.filter(row => row.status !== 'disconnected').map(row => {
      const live = postingReady(), state = accountState(row);
      return {
        accountId: row._id, platform: row.platform, handle: `@${row.username}`, ...(row.displayName ? { name: row.displayName } : {}),
        status: state.status, needsReconnect: state.status === 'needs_reconnect', ...(state.error ? { problem: state.error } : {}),
        canPost: live && state.status === 'connected',
        ...(live ? {} : { unavailable: `${POSTING_NOT_SET_UP} Nothing can be posted or scheduled until it is; tell the user exactly this.` }),
        visibility: row.platform === 'youtube' ? 'Always public: YouTube videos cannot be posted as unlisted or private from Revline.' : row.platform === 'tiktok' ? [...VISIBILITY_OPTIONS.tiktok] : 'Instagram has no per-post visibility.',
      };
    });
  },
});

/** The owner's account groups as the posting tools list them: each group's accounts and which of them can be posted to now. */
export const groups = internalQuery({
  args: { ownerId: v.string() }, returns: v.any(),
  handler: async (ctx, { ownerId }) => {
    const live = postingReady();
    return Promise.all((await ownerGroups(ctx, ownerId)).map(async group => ({
      groupId: group._id, name: group.name, ...(group.isDefault ? { isDefault: true } : {}),
      accounts: (await groupAccounts(ctx, group)).map(account => {
        const state = accountState(account);
        return { accountId: account._id, platform: account.platform, handle: `@${account.username}`, canPost: live && state.status === 'connected', ...(state.status === 'needs_reconnect' ? { needsReconnect: true } : {}) };
      }),
    })));
  },
});

/**
 * The accounts a group stands for, for postVideo and schedulePost: `group` is a groupId or a group's name (ignoring
 * case). Accounts that need reconnecting are left out and returned as `skipped`, so the post still goes to the others.
 */
export const groupTargets = internalQuery({
  args: { ownerId: v.string(), group: v.string() }, returns: v.any(),
  handler: async (ctx, { ownerId, group: wanted }) => {
    const groups = await ownerGroups(ctx, ownerId), id = ctx.db.normalizeId('postingGroups', wanted);
    const group = groups.find(item => item._id === id) ?? groups.find(item => sameName(item.name, wanted));
    if (!group) throw new ConvexError(groups.length ? `No group called "${wanted}". This user's groups: ${groups.map(item => item.name).join(', ')}. Call listConnectedAccounts for their groupIds, or ask which accounts to post to.` : 'This user has no account groups. Ask which accounts to post to, or suggest making a group on the Accounts page (/accounts).');
    const accounts = await groupAccounts(ctx, group);
    const ready = accounts.filter(account => accountState(account).status === 'connected'), skipped = accounts.filter(account => accountState(account).status !== 'connected');
    if (!ready.length) throw new ConvexError(accounts.length ? `Every account in ${group.name} needs reconnecting. The user reconnects them on the Accounts page (/accounts).` : `${group.name} has no accounts yet. The user adds accounts to it on the Accounts page (/accounts), or names the accounts to post to.`);
    return { groupId: group._id, name: group.name, accounts: ready.map(account => ({ accountId: account._id, platform: account.platform })), skipped: skipped.map(account => account._id) };
  },
});

/** The platform of each of these accounts, for the tool to know which ones need TikTok's creator info. Only the owner's accounts. */
export const accountPlatforms = internalQuery({
  args: { ownerId: v.string(), accountIds: v.array(v.string()) }, returns: v.any(),
  handler: async (ctx, { ownerId, accountIds }) => {
    const found = [];
    for (const raw of accountIds) {
      const id = ctx.db.normalizeId('postingAccounts', raw), account = id ? await ctx.db.get(id) : null;
      if (!account || account.ownerId !== ownerId || account.status === 'disconnected') throw new ConvexError(`Account ${raw} is not one of this user's connected accounts. Call listConnectedAccounts for their IDs.`);
      found.push({ accountId: account._id, platform: account.platform, connected: accountState(account).status === 'connected' });
    }
    return found;
  },
});

/**
 * Check a request completely and describe exactly what it would do. Throws the reason when any part of it cannot
 * be posted, so a request is all or nothing. Shared by the preview, the proposal card and the send.
 */
async function plan(ctx: QueryCtx | MutationCtx, ownerId: string, args: PostRequest, schedule: boolean) {
  const now = Date.now(), project = await requireProject(ctx, args.projectId, ownerId);
  if (!args.timelineIds.length || args.timelineIds.length > CLIP_LIMIT || new Set(args.timelineIds).size !== args.timelineIds.length) throw new ConvexError(`Name 1 to ${CLIP_LIMIT} different timelines to post.`);
  if (!args.targets.length || args.targets.length > ACCOUNT_LIMIT || new Set(args.targets.map(target => target.accountId)).size !== args.targets.length) throw new ConvexError(`Name 1 to ${ACCOUNT_LIMIT} different accounts to post to.`);
  if (schedule) { if (args.scheduledAt === undefined) throw new ConvexError('schedulePost needs the time to post at.'); scheduleTime(args.scheduledAt, now); }
  else if (args.scheduledAt !== undefined) throw new ConvexError('postVideo posts now. Use schedulePost to post at a later time.');
  const { caption, title } = batchText(args, now);

  // The one plain reason, as the person pressing a confirmation card reads it too. What to do with it is in the posting skill.
  requirePosting();
  const accounts = [];
  for (const target of args.targets) {
    const account = await ctx.db.get(target.accountId);
    if (!account || account.ownerId !== ownerId || account.status === 'disconnected') throw new ConvexError(`Account ${target.accountId} is not one of this user's connected accounts. Call listConnectedAccounts for their IDs.`);
    const name = PLATFORM_NAMES[account.platform], handle = `@${account.username}`;
    if (accountState(account).status !== 'connected') throw new ConvexError(`${handle} on ${name} needs reconnecting before it can be posted to. The user reconnects it on the Accounts page (/accounts).`);
    const own = batchText({ caption: target.caption ?? '', title: target.title }, now), text = { caption: own.caption || caption, title: own.title ?? title };
    const refused = textProblems(account.platform, text)[0];
    if (refused) throw new ConvexError(`${handle}: ${refused}`);
    if (account.platform === 'instagram' && (target.visibility !== undefined || target.tiktok !== undefined)) throw new ConvexError(`${handle}: Instagram has no per-post visibility or TikTok settings. Remove them for this account.`);
    if (account.platform === 'youtube' && target.tiktok !== undefined) throw new ConvexError(`${handle}: the tiktok settings only apply to TikTok accounts.`);
    let allowed: readonly string[] | undefined, maxSeconds: number | undefined;
    if (account.platform === 'tiktok') {
      // TikTok's rules: the user chooses who can view every post. No default.
      const creator = args.tiktokCreators.find(item => item.accountId === account._id);
      if (!creator || creator.error || !creator.privacyLevels?.length) throw new ConvexError(`${handle}: ${creator?.error ?? 'TikTok did not share this account’s posting settings. Try again in a moment.'}`);
      allowed = creator.privacyLevels; maxSeconds = creator.maxDurationSeconds;
      const levels = creator.privacyLevels.map(level => `${level} (${TIKTOK_VISIBILITY_NAMES[level]})`).join(', ');
      if (!isTikTokVisibility(target.visibility)) throw new ConvexError(`${handle}: TikTok needs the user's choice of who can view this post. Ask the user, then pass visibility as one of: ${levels}.`);
      if (!creator.privacyLevels.includes(target.visibility)) throw new ConvexError(`${handle}: this TikTok account does not allow ${target.visibility} right now. It allows: ${levels}.`);
    }
    // The same checks the Post dialog's posts pass, resolved here so the preview and the card state who will be able to view it.
    const choices = postChoices(account.platform, target);
    const visibility = choices.visibility;
    accounts.push({
      account, text, maxSeconds,
      view: {
        accountId: account._id, platform: account.platform, handle, caption: text.caption, ...(text.title ? { title: text.title } : {}),
        ...(account.platform === 'youtube' ? { visibility } : {}),
        ...(account.platform === 'tiktok' ? { visibility: `${target.visibility} (${TIKTOK_VISIBILITY_NAMES[target.visibility as keyof typeof TIKTOK_VISIBILITY_NAMES]})`, allowedVisibility: allowed, tiktok: { allowComment: false, allowDuet: false, allowStitch: false, yourBrand: false, brandedContent: false, ...choices.tiktok } } : {}),
      },
      target: { accountId: account._id, ...(own.caption ? { caption: own.caption } : {}), ...(own.title ? { title: own.title } : {}), ...(visibility ? { visibility } : {}), ...(choices.tiktok ? { tiktok: choices.tiktok } : {}) },
    });
  }

  const tabs = tabsOf(project), clips = [];
  for (const timelineId of args.timelineIds) {
    const tab = tabs.find(item => item.id === timelineId);
    if (!tab) throw new ConvexError(`Timeline ${timelineId} is not in this project. Call listTimelines for its tabs.`);
    const { settings, ready, running } = await exportPlan(ctx, ownerId, project, timelineId), shape = await clipShape(ctx, project, timelineId, settings.resolution);
    const timeline = await storedTabTimeline(ctx, project, timelineId);
    if (!shape || !timeline?.clips.length) throw new ConvexError(`"${tab.name}" is empty, so there is nothing to post.`);
    if (!ready && !running && shape.durationSeconds > MAX_EXPORT_SECONDS) throw new ConvexError(`"${tab.name}" is longer than ${MAX_EXPORT_LABEL}, the longest Revline exports. Shorten it before posting.`);
    for (const { account, maxSeconds } of accounts) {
      const refused = shapeProblems(account.platform, shape)[0] ?? (maxSeconds && shape.durationSeconds > maxSeconds ? `This TikTok account can post videos up to ${maxSeconds} seconds; "${tab.name}" is ${Math.ceil(shape.durationSeconds)} seconds.` : undefined);
      if (refused) throw new ConvexError(`"${tab.name}" cannot go to @${account.username}: ${refused}`);
    }
    clips.push({
      timelineId, name: tab.name, durationSeconds: Math.round(shape.durationSeconds * 10) / 10, size: `${shape.width}×${shape.height}`,
      export: ready ? 'A finished export of this exact version exists and is posted as it is.' : running ? 'An export of this exact version is already rendering; the post waits for it.' : `Not exported at this version yet: Revline exports it first (${settings.resolution}p, ${settings.fps} fps, ${settings.quality} quality, the settings this project was last exported with) and posts when the export finishes.`,
      exports: !ready,
    });
  }
  const needsExport = clips.filter(clip => clip.exports).length, posts = clips.length * accounts.length;
  const group = args.groupId ? await ctx.db.get(args.groupId) : null;
  if (args.groupId && (!group || group.ownerId !== ownerId)) throw new ConvexError('That account group no longer exists. Call listConnectedAccounts for the current groups.');
  const skipped = [];
  for (const accountId of args.skippedAccountIds ?? []) {
    const account = await ctx.db.get(accountId);
    if (account && account.ownerId === ownerId && account.status !== 'disconnected') skipped.push({ accountId, platform: account.platform, handle: `@${account.username}`, reason: 'needs reconnecting on the Accounts page (/accounts)' });
  }
  return {
    project, caption, title, targets: accounts.map(item => item.target),
    view: {
      project: project.title, clips: clips.map(({ exports: _exports, ...clip }) => clip), accounts: accounts.map(item => item.view),
      ...(group ? { group: group.name } : {}), ...(skipped.length ? { skipped, skippedNote: `${skipped.length} ${skipped.length === 1 ? 'account' : 'accounts'} of ${group?.name ?? 'the group'} ${skipped.length === 1 ? 'needs' : 'need'} reconnecting and ${skipped.length === 1 ? 'is' : 'are'} skipped; the others still get the post. Tell the user which, and that they reconnect on the Accounts page.` } : {}),
      ...(args.scheduledAt !== undefined ? { scheduledFor: iso(args.scheduledAt) } : { when: 'now, as soon as each clip is exported' }),
      posts,
      summary: `${needsExport ? `Will export ${needsExport === clips.length ? (clips.length === 1 ? 'the clip' : `${clips.length} clips`) : `${needsExport} of ${clips.length} clips`} and ` : 'Will '}${args.scheduledAt !== undefined ? 'schedule' : 'post'} ${posts} ${posts === 1 ? 'post' : 'posts'}: ${clips.map(clip => `"${clip.name}"`).join(', ')} to ${accounts.map(item => `${item.view.handle} on ${PLATFORM_NAMES[item.account.platform]}`).join(', ')}${args.scheduledAt !== undefined ? ` at ${iso(args.scheduledAt)}` : ''}.`,
    },
  };
}

/** What a post or schedule request would do, exactly, without creating anything. Throws the reason when it cannot be posted. */
export const preview = internalQuery({
  args: { ownerId: v.string(), schedule: v.boolean(), ...request }, returns: v.any(),
  handler: async (ctx, { ownerId, schedule, ...args }) => (await plan(ctx, ownerId, args, schedule)).view,
});

/**
 * The in-app assistant's post or schedule call: the checked request is stored as a proposal and shown as a card in
 * the chat. Nothing is exported or sent here; only the signed-in user's press of the card (`confirmProposal`) does that.
 */
export const propose = internalMutation({
  args: { ownerId: v.string(), runId: v.optional(v.string()), schedule: v.boolean(), ...request }, returns: v.any(),
  handler: async (ctx, { ownerId, runId: _runId, schedule, ...args }) => {
    const checked = await plan(ctx, ownerId, args, schedule), now = Date.now();
    const proposalId = await ctx.db.insert('postingProposals', {
      ownerId, projectId: checked.project._id, timelineIds: args.timelineIds, targets: checked.targets, caption: checked.caption, ...(checked.title ? { title: checked.title } : {}),
      ...(args.scheduledAt !== undefined ? { scheduledAt: args.scheduledAt } : {}), status: 'proposed', createdAt: now, expiresAt: now + PROPOSAL_MS,
      ...(args.tiktokCreators.length ? { tiktokCreators: args.tiktokCreators } : {}),
      ...(args.groupId ? { groupId: args.groupId } : {}), ...(args.skippedAccountIds?.length ? { skippedAccountIds: args.skippedAccountIds } : {}),
    });
    return {
      awaitingConfirmation: true, proposalId, ...checked.view,
      next: 'Nothing has been exported or posted. A confirmation card with these accounts, captions, visibility and time is now in the chat; only the user pressing it sends the posts. End your turn with one short sentence asking them to confirm on the card. Never say it was posted or scheduled. Later, listPosts or getPost shows whether they confirmed and how each post is doing.',
    };
  },
});

/** Start the export-then-post chain for each clip of a checked request. One pending post per clip; a repeated key returns the first call's posts. */
async function createPending(ctx: MutationCtx, ownerId: string, input: { projectId: Id<'projects'>; timelineIds: string[]; targets: Doc<'postingProposals'>['targets']; caption: string; title?: string; scheduledAt?: number; agentName?: string; key: string }) {
  const created: { pendingId: Id<'postingPending'>; repeated: boolean }[] = [];
  for (const timelineId of input.timelineIds) {
    const idempotencyKey = `${input.key}:${timelineId}`;
    const repeated = !!await pendingForKey(ctx, ownerId, idempotencyKey);
    const pendingId = await startPendingFor(ctx, ownerId, {
      projectId: input.projectId, timelineId, caption: input.caption, ...(input.title ? { title: input.title } : {}), ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
      accountIds: input.targets.map(target => target.accountId), targets: input.targets, createdBy: 'assistant', ...(input.agentName ? { agentName: input.agentName } : {}), idempotencyKey,
    });
    created.push({ pendingId, repeated });
  }
  return created;
}

async function digest(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
  return Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The MCP post or schedule call with `confirm: true`: the request is checked again and the posts are created.
 * `idempotencyKey` makes a retried call return the same posts; without one, an identical request made the same
 * day counts as a retry.
 */
export const send = internalMutation({
  args: { ownerId: v.string(), runId: v.optional(v.string()), schedule: v.boolean(), agentName: v.optional(v.string()), idempotencyKey: v.optional(v.string()), ...request }, returns: v.any(),
  handler: async (ctx, { ownerId, runId: _runId, schedule, agentName, idempotencyKey, ...args }) => {
    const checked = await plan(ctx, ownerId, args, schedule), now = Date.now();
    const key = idempotencyKey ? `key:${idempotencyKey}` : `same:${Math.floor(now / 86400_000)}:${await digest([checked.project._id, checked.project.revision ?? 0, checked.targets, checked.caption, checked.title ?? null, args.scheduledAt ?? null])}`;
    const created = await createPending(ctx, ownerId, { projectId: checked.project._id, timelineIds: args.timelineIds, targets: checked.targets, caption: checked.caption, title: checked.title, scheduledAt: args.scheduledAt, agentName, key });
    const repeats = created.filter(item => item.repeated).length, again = `already sent${idempotencyKey ? ' with this idempotencyKey' : ' today'}`;
    return {
      confirmed: true, ...(repeats === created.length ? { alreadyCreated: true } : {}), ...checked.view,
      posts: await Promise.all(created.map(async item => ({ ...await pendingView(ctx, (await ctx.db.get(item.pendingId))!), ...(item.repeated ? { alreadyCreated: true } : {}) }))),
      next: repeats === created.length
        ? `This exact request was ${again}, so nothing new was created; these are its posts. To post the same clip again on purpose, pass a new idempotencyKey.`
        : repeats ? `Posts marked alreadyCreated were ${again} and were not created again; the others are new and run on their own. getPost with a postId reports progress, the link once published, or the reason it failed.`
        : 'The posts are created and run on their own: each clip is exported if needed, then posted (or held until the scheduled time). Do not wait in this call. Tell the user it is exporting and will post when ready; getPost with a postId reports progress, the link once published, or the reason it failed.',
    };
  },
});

// ---------------------------------------------------------------- the confirmation card (signed-in user only)

const proposalState = (proposal: Doc<'postingProposals'>, now: number) => proposal.status === 'proposed' && proposal.expiresAt <= now ? 'expired' as const : proposal.status;
async function ownedProposal(ctx: QueryCtx | MutationCtx, proposalId: Id<'postingProposals'>) {
  const ownerId = await requireOwner(ctx), proposal = await ctx.db.get(proposalId);
  if (!proposal || proposal.ownerId !== ownerId) throw new ConvexError('Post not found');
  return { ownerId, proposal };
}

/** A proposal as its card shows it: what would be posted, and whether the user has confirmed, cancelled or let it expire. */
export const proposal = query({
  args: { proposalId: v.id('postingProposals') },
  returns: v.union(v.null(), v.object({
    status: v.union(v.literal('proposed'), v.literal('confirmed'), v.literal('cancelled'), v.literal('expired')),
    /** When an unconfirmed card stops working; the card compares it with its own clock. */
    expiresAt: v.number(), scheduledAt: v.union(v.number(), v.null()), clips: v.array(v.object({ timelineId: v.string(), name: v.string(), exports: v.boolean() })),
    accounts: v.array(v.object({ accountId: v.id('postingAccounts'), platform: v.union(v.literal('instagram'), v.literal('tiktok'), v.literal('youtube')), username: v.string(), caption: v.string(), title: v.union(v.string(), v.null()), visibility: v.union(postVisibility, v.null()), tiktok: v.union(tiktokChoices, v.null()) })),
    /** The group the assistant chose (null: single accounts) and the accounts of it skipped because they need reconnecting. */
    groupId: v.optional(v.union(v.id('postingGroups'), v.null())), skippedAccountIds: v.optional(v.array(v.id('postingAccounts'))),
    /** Who can view a post on each TikTok account TikTok answered for when the card was made: what the card offers for a TikTok account the user adds. */
    tiktokLevels: v.optional(v.array(v.object({ accountId: v.id('postingAccounts'), levels: v.array(tiktokVisibility) }))),
    /** The shared caption and title, which an account the user adds on the card posts with. */
    caption: v.optional(v.string()), title: v.optional(v.union(v.string(), v.null())),
  })),
  handler: async (ctx, { proposalId }) => {
    const ownerId = await requireOwner(ctx), row = await ctx.db.get(proposalId);
    if (!row || row.ownerId !== ownerId) return null;
    const project = await ctx.db.get(row.projectId), tabs = project ? tabsOf(project) : [];
    const clips = [];
    for (const timelineId of row.timelineIds) {
      // Whether pressing now would start an export; a confirmed card no longer asks.
      const ready = project && row.status === 'proposed' ? (await exportPlan(ctx, ownerId, project, timelineId)).ready : undefined;
      clips.push({ timelineId, name: tabs.find(tab => tab.id === timelineId)?.name ?? 'Removed timeline', exports: row.status === 'proposed' && !ready });
    }
    const accounts = [];
    for (const target of row.targets) {
      const account = await ctx.db.get(target.accountId);
      accounts.push({ accountId: target.accountId, platform: account?.platform ?? 'youtube' as const, username: account?.username ?? 'removed account', caption: target.caption ?? row.caption, title: target.title ?? row.title ?? null, visibility: target.visibility ?? null, tiktok: target.tiktok ?? null });
    }
    const tiktokLevels = (row.tiktokCreators ?? []).filter(creator => !creator.error && creator.privacyLevels?.length).map(creator => ({ accountId: creator.accountId, levels: creator.privacyLevels! }));
    return { status: proposalState(row, Date.now()), expiresAt: row.expiresAt, scheduledAt: row.scheduledAt ?? null, clips, accounts, groupId: row.groupId ?? null, skippedAccountIds: row.skippedAccountIds ?? [], tiktokLevels, caption: row.caption, title: row.title ?? null };
  },
});

/**
 * The user pressed the card: export each clip that needs it and create the posts. Pressing twice creates them once.
 * `accountIds`: the accounts the user left ticked or switched to on the card (absent: the assistant's). An account
 * the assistant did not choose takes the shared caption, and on TikTok the `visibility` the user picked on the card.
 */
export const confirmProposal = mutation({
  args: {
    proposalId: v.id('postingProposals'), accountIds: v.optional(v.array(v.id('postingAccounts'))), groupId: v.optional(v.union(v.id('postingGroups'), v.null())),
    visibility: v.optional(v.array(v.object({ accountId: v.id('postingAccounts'), visibility: tiktokVisibility }))),
  },
  returns: v.null(),
  handler: async (ctx, { proposalId, accountIds, groupId, visibility }) => {
    const { ownerId, proposal: proposed } = await ownedProposal(ctx, proposalId), now = Date.now();
    const picked = (accountId: Id<'postingAccounts'>) => visibility?.find(item => item.accountId === accountId)?.visibility;
    const row = accountIds ? { ...proposed, targets: accountIds.map(accountId => proposed.targets.find(target => target.accountId === accountId) ?? { accountId, ...(picked(accountId) ? { visibility: picked(accountId) } : {}) }) } : proposed;
    if (row.status === 'confirmed') return null;
    if (groupId) { const group = await ctx.db.get(groupId); if (!group || group.ownerId !== ownerId) throw new ConvexError('That group no longer exists. Pick another one.'); }
    if (proposalState(row, now) !== 'proposed') throw new ConvexError(row.status === 'cancelled' ? 'This post was cancelled. Ask the assistant again to post it.' : 'This confirmation expired. Ask the assistant again to post it.');
    // The clip may have been edited and an account disconnected since the card was made: everything is checked again
    // against the project as it is now. (Each platform's limits are checked again when the post is sent.)
    const checked = await plan(ctx, ownerId, { projectId: row.projectId, timelineIds: row.timelineIds, targets: row.targets, caption: row.caption, ...(row.title ? { title: row.title } : {}), ...(row.scheduledAt !== undefined ? { scheduledAt: row.scheduledAt } : {}), tiktokCreators: row.tiktokCreators ?? [] }, row.scheduledAt !== undefined);
    const created = await createPending(ctx, ownerId, { projectId: row.projectId, timelineIds: row.timelineIds, targets: checked.targets, caption: checked.caption, title: checked.title, scheduledAt: row.scheduledAt, key: `proposal:${proposalId}` });
    await ctx.db.patch(proposalId, { status: 'confirmed', pendingIds: created.map(item => item.pendingId), ...(accountIds ? { targets: checked.targets } : {}), ...(groupId !== undefined && groupId !== (proposed.groupId ?? null) ? { groupId: groupId ?? undefined, skippedAccountIds: undefined } : {}) });
    return null;
  },
});
export const cancelProposal = mutation({
  args: { proposalId: v.id('postingProposals') }, returns: v.null(),
  handler: async (ctx, { proposalId }) => {
    const { proposal: row } = await ownedProposal(ctx, proposalId);
    if (row.status === 'proposed') await ctx.db.patch(proposalId, { status: 'cancelled' });
    return null;
  },
});

// ---------------------------------------------------------------- reading, cancelling and moving posts

const STATUS: Record<Doc<'postingPosts'>['status'], string> = { scheduled: 'scheduled', posting: 'posting', processing: 'posting', published: 'published', failed: 'failed' };

/** One post to one account, as the tools report it. */
async function postView(ctx: QueryCtx, post: Doc<'postingPosts'>) {
  const account = await ctx.db.get(post.accountId), batch = await ctx.db.get(post.batchId), now = Date.now();
  const waiting = notSent(post) && post.scheduledAt !== undefined && post.scheduledAt > now;
  let outdated: string | undefined;
  if (waiting && batch) {
    // A scheduled post sends the version that was exported when it was confirmed. An edit made since does not change it.
    const job = await ctx.db.get(post.jobId), project = await ctx.db.get(batch.projectId);
    if (job && project && (job.sourceRevision ?? -1) !== (project.revision ?? 0) && job.sourceTimelineId) {
      const current = await storedTabTimeline(ctx, project, job.sourceTimelineId), exported = job.timeline ?? (await ctx.db.query('renderSnapshots').withIndex('by_job', q => q.eq('jobId', job._id)).first())?.timeline;
      if (!current || !exported || JSON.stringify((current as { clips: unknown }).clips) !== JSON.stringify((exported as { clips: unknown }).clips)) outdated = `The clip was edited after this post was scheduled. The post still sends the version exported at ${iso(job.createdAt)}. To post the newer version, cancel this post and schedule it again.`;
    }
  }
  return {
    postId: post._id, status: waiting || post.status === 'scheduled' && !postingReady() ? 'scheduled' : post.status === 'scheduled' ? 'posting' : STATUS[post.status], platform: post.platform, account: `@${account?.username ?? 'removed account'}`,
    clip: batch?.exportLabel ?? 'Video', caption: post.caption, ...(post.title ? { title: post.title } : {}), ...(post.visibility ? { visibility: post.visibility } : {}),
    ...(post.scheduledAt ? { scheduledFor: iso(post.scheduledAt) } : {}), ...(post.publishedAt ? { publishedAt: iso(post.publishedAt) } : {}), ...(post.url ? { link: post.url } : {}),
    ...(post.status === 'failed' || post.error ? { reason: post.error ?? `${PLATFORM_NAMES[post.platform]} did not accept this post.` } : (post.status === 'scheduled' || post.status === 'processing') && !postingReady() ? { reason: `${POSTING_NOT_SET_UP} This post stays queued and goes out once it is.` } : {}),
    ...(post.status === 'failed' && account && accountState(account).status === 'needs_reconnect' ? { needsReconnect: true } : {}),
    ...(post.statsFetchedAt ? { stats: { views: post.views ?? 0, likes: post.likes ?? 0, comments: post.comments ?? 0, ...(post.shares !== undefined ? { shares: post.shares } : {}), asOf: iso(post.statsFetchedAt) } } : {}),
    createdBy: batch?.createdBy === 'assistant' ? batch.agentName ?? 'Revline assistant' : 'the user', ...(outdated ? { outdated } : {}),
  };
}
/** A post that has no batch yet (still exporting, or its export failed or was cancelled); once the batch exists, its posts. */
async function pendingView(ctx: QueryCtx, pending: Doc<'postingPending'>): Promise<Record<string, unknown>> {
  const project = await ctx.db.get(pending.projectId), tab = project ? tabsOf(project).find(item => item.id === pending.timelineId) : undefined;
  const base = { postId: pending._id, clip: tab?.name ?? project?.title ?? 'Video', timelineId: pending.timelineId, createdBy: pending.createdBy === 'assistant' ? pending.agentName ?? 'Revline assistant' : 'the user' };
  if (pending.status === 'created' && pending.batchId) {
    const posts = await ctx.db.query('postingPosts').withIndex('by_batch', q => q.eq('batchId', pending.batchId!)).collect();
    return { ...base, status: 'exported', note: 'The export finished and each account now has its own post, listed here with its own postId.', posts: await Promise.all(posts.map(post => postView(ctx, post))) };
  }
  const usernames = [];
  for (const accountId of pending.accountIds) usernames.push(`@${(await ctx.db.get(accountId))?.username ?? 'removed account'}`);
  const shared = { ...base, accounts: usernames, caption: pending.caption, ...(pending.scheduledAt ? { scheduledFor: iso(pending.scheduledAt) } : {}) };
  if (pending.status === 'failed') return { ...shared, status: 'failed', reason: pending.error ?? 'The export failed, so nothing was posted.' };
  if (pending.status === 'cancelled') return { ...shared, status: 'cancelled' };
  const job = pending.jobId ? await ctx.db.get(pending.jobId) : null;
  return {
    ...shared, status: 'exporting', exportProgress: job?.status === 'rendering' ? Math.round(job.progress ?? 0) : 0,
    note: pending.status === 'queued' ? 'Waiting for another export to finish before this clip’s export starts. Nothing has been posted yet.' : `Exporting. ${pending.scheduledAt ? 'The posts are created when the export finishes and go out at the scheduled time.' : 'The posts go out as soon as the export finishes.'}`,
  };
}

/** A postId from the tools is either a post to one account or a post still waiting for its export. Only the owner's. */
async function resolve(ctx: QueryCtx | MutationCtx, ownerId: string, raw: string) {
  const postId = ctx.db.normalizeId('postingPosts', raw), post = postId ? await ctx.db.get(postId) : null;
  if (post && post.ownerId === ownerId) return { post };
  const pendingId = ctx.db.normalizeId('postingPending', raw), pending = pendingId ? await ctx.db.get(pendingId) : null;
  if (pending && pending.ownerId === ownerId) return { pending };
  throw new ConvexError('Post not found. Call listPosts for this user’s posts and their IDs.');
}

export const get = internalQuery({
  args: { ownerId: v.string(), postId: v.string() }, returns: v.any(),
  handler: async (ctx, { ownerId, postId }) => {
    const found = await resolve(ctx, ownerId, postId);
    return found.post ? postView(ctx, found.post) : pendingView(ctx, found.pending);
  },
});

/** The owner's recent posts, newest first: clips still exporting, then every post to an account. Optionally one project's. */
export const list = internalQuery({
  args: { ownerId: v.string(), projectId: v.optional(v.id('projects')), status: v.optional(v.string()), limit: v.number() }, returns: v.any(),
  handler: async (ctx, { ownerId, projectId, status, limit }) => {
    if (projectId) await requireProject(ctx, projectId, ownerId, false);
    const now = Date.now(), entries: Record<string, unknown>[] = [];
    const pendings = (await ctx.db.query('postingPending').withIndex('by_owner_createdAt', q => q.eq('ownerId', ownerId)).order('desc').take(60))
      .filter(row => (!projectId || row.projectId === projectId) && (row.status === 'waiting' || row.status === 'queued' || row.status === 'failed' && now - row.updatedAt < 7 * 86400_000));
    const wanted = (entry: Record<string, unknown>) => !status || entry.status === status;
    for (const pending of pendings) { const entry = await pendingView(ctx, pending); if (wanted(entry)) entries.push(entry); }
    const posts = await ctx.db.query('postingPosts').withIndex('by_owner_createdAt', q => q.eq('ownerId', ownerId)).order('desc').take(200);
    const batches = new Map<Id<'postingBatches'>, Doc<'postingBatches'> | null>();
    for (const post of posts) {
      if (entries.length >= limit) break;
      if (!batches.has(post.batchId)) batches.set(post.batchId, await ctx.db.get(post.batchId));
      if (projectId && batches.get(post.batchId)?.projectId !== projectId) continue;
      const entry = await postView(ctx, post);
      if (wanted(entry)) entries.push(entry);
    }
    return entries.slice(0, limit);
  },
});

/** Cancel posts that have not been sent: a clip still exporting, or scheduled posts. A post that started cannot be cancelled. */
export const cancel = internalMutation({
  args: { ownerId: v.string(), runId: v.optional(v.string()), projectId: v.optional(v.id('projects')), postId: v.string() }, returns: v.any(),
  handler: async (ctx, { ownerId, postId }) => {
    const found = await resolve(ctx, ownerId, postId), now = Date.now();
    if (found.post) { await cancelPostFor(ctx, ownerId, found.post._id); return { cancelled: 1, note: 'The scheduled post was removed. Nothing was sent.' }; }
    const { pending } = found;
    if (pending.status === 'waiting' || pending.status === 'queued') {
      await ctx.db.patch(pending._id, { status: 'cancelled', updatedAt: now });
      return { cancelled: pending.accountIds.length, note: 'The post was cancelled before its export finished. Nothing was sent; the export itself keeps going and stays in the project’s exports.' };
    }
    if (pending.status !== 'created' || !pending.batchId) throw new ConvexError(`This post already ${pending.status === 'cancelled' ? 'was cancelled' : 'failed'}.`);
    const waiting = (await ctx.db.query('postingPosts').withIndex('by_batch', q => q.eq('batchId', pending.batchId!)).collect()).filter(post => post.status === 'scheduled');
    if (!waiting.length) throw new ConvexError('Every post of this clip has already started. A post that was sent cannot be cancelled or deleted from Revline.');
    for (const post of waiting) await ctx.db.delete(post._id);
    return { cancelled: waiting.length, note: 'The posts that had not started were removed. Nothing was sent for them.' };
  },
});

/** Move posts that have not been sent to another time. */
export const reschedule = internalMutation({
  args: { ownerId: v.string(), runId: v.optional(v.string()), projectId: v.optional(v.id('projects')), postId: v.string(), scheduledAt: v.number() }, returns: v.any(),
  handler: async (ctx, { ownerId, postId, scheduledAt }) => {
    const found = await resolve(ctx, ownerId, postId), now = Date.now();
    scheduleTime(scheduledAt, now);
    const moved = { scheduledFor: iso(scheduledAt) };
    if (found.post) { await reschedulePostFor(ctx, ownerId, found.post._id, scheduledAt); return { rescheduled: 1, ...moved }; }
    const { pending } = found;
    if (pending.status === 'waiting' || pending.status === 'queued') { await ctx.db.patch(pending._id, { scheduledAt, updatedAt: now }); return { rescheduled: pending.accountIds.length, ...moved, note: 'Still exporting; the posts go out at the new time.' }; }
    if (pending.status !== 'created' || !pending.batchId) throw new ConvexError(`This post already ${pending.status === 'cancelled' ? 'was cancelled' : 'failed'}.`);
    const waiting = (await ctx.db.query('postingPosts').withIndex('by_batch', q => q.eq('batchId', pending.batchId!)).collect()).filter(notSent);
    if (!waiting.length) throw new ConvexError('Every post of this clip has already started, so none can be moved.');
    for (const post of waiting) await reschedulePostFor(ctx, ownerId, post._id, scheduledAt);
    return { rescheduled: waiting.length, ...moved };
  },
});
