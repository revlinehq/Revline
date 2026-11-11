import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireOwner, requireProject } from './lib/auth';
import { projectIdentity } from './lib/project_data';
import { activeTabOf, storedTabTimeline, tabsOf } from './timelineTabs';
import { exportsFull, startRenderFor } from './renders';
import { internal } from './_generated/api';
import { hasUltraPlan } from './lib/billing_access';
import { accountPicture, accountState, batchText, createBatchFor, projectCover } from './posting';
import { postingPlatform } from './postingTables';
import { pendingPostStatus } from './postingTables';
import { platformLive } from '../lib/posting/server';
import { shapeProblems } from '../lib/posting/precheck';
import { dimensions, timelineDuration } from '../lib/editor/types';

// Post from the editor. Posting needs a file, so a press of Post is two steps: an export of the timeline as it is
// at that moment, then the posts. `start` reuses a finished export of the unchanged timeline when there is one;
// otherwise it starts one and records the post as waiting. `settle` turns a waiting post into a posting batch when
// its export completes, or fails it with the reason when the export does not. Nothing is sent without a file.

const TARGET_LIMIT = 50, ERROR_LIMIT = 500, DOUBLE_PRESS_MS = 30_000;

/** An export counts as "this timeline, unchanged" when it rendered the whole open tab at the project's current revision. */
function sameVersion(job: Doc<'renderJobs'>, project: Doc<'projects'>, timelineId: string) {
  return job.sourceTimelineId === timelineId && job.sourceClipId === undefined && job.sourceSectionId === undefined && (job.sourceRevision ?? -1) === (project.revision ?? 0);
}
/**
 * The export settings the user last chose for a whole timeline of this project (a finished export), or the export
 * dialog's defaults. No new preference is stored. 4K stays with the Ultra plan.
 */
function exportSettings(jobs: Doc<'renderJobs'>[], fps: number, ultra: boolean) {
  const last = jobs.find(job => job.status === 'completed' && job.sourceClipId === undefined && job.resolution !== undefined && (job.quality === 'standard' || job.quality === 'high'));
  const resolution = last?.resolution ?? 1080;
  return { resolution: resolution === 2160 && !ultra ? 1080 : resolution, fps: last?.fps ?? (fps === 24 || fps === 30 ? fps : 60), quality: last?.quality ?? 'standard' };
}
/** Why these accounts cannot be posted to right now, or null. Checked at the press and again when the export is ready. */
async function targetsProblem(ctx: QueryCtx | MutationCtx, ownerId: string, accountIds: Id<'postingAccounts'>[]) {
  for (const accountId of accountIds) {
    const account = await ctx.db.get(accountId);
    if (!account || account.ownerId !== ownerId || account.status === 'disconnected') return 'An account is no longer connected.';
    if (!platformLive(account.platform)) return 'This platform is coming soon.';
    if (accountState(account).status !== 'connected') return `Reconnect @${account.username} before posting to it.`;
  }
  return null;
}

/** What posting a timeline tab would export: the settings, and whether a finished or running export of this exact version already exists. */
export async function exportPlan(ctx: QueryCtx | MutationCtx, ownerId: string, project: Doc<'projects'>, timelineId: string) {
  const jobs = await ctx.db.query('renderJobs').withIndex('by_ownerId_projectId', q => q.eq('ownerId', ownerId).eq('projectId', project._id)).order('desc').take(50);
  const ultra = await hasUltraPlan(ctx, ownerId), settings = exportSettings(jobs, project.timeline?.fps ?? 30, ultra);
  // Only an export made with the settings this post would use counts: a draft or a smaller render is not what the user means to publish.
  const usable = (job: Doc<'renderJobs'>) => sameVersion(job, project, timelineId) && job.resolution === settings.resolution && job.fps === settings.fps && job.quality === settings.quality;
  // A finished export of this exact version is posted as it is; one still rendering is waited for instead of doubled.
  const ready = jobs.find(job => job.status === 'completed' && (job.outputR2Key || job.outputStorageId) && usable(job));
  const running = ready ? undefined : jobs.find(job => (job.status === 'queued' || job.status === 'rendering') && usable(job));
  return { settings, ultra, ready, running };
}

export type PendingInput = {
  projectId: Id<'projects'>; caption: string; title?: string; scheduledAt?: number; campaignId?: string; accountIds: Id<'postingAccounts'>[]; timelineId?: string;
  /** Each account's own text and choices (the assistant's posts); without it every account posts the shared caption with its platform's defaults. */
  targets?: Doc<'postingPending'>['targets']; createdBy?: 'assistant'; agentName?: string;
  /** A repeated call with the same key returns the post the first one created. */
  idempotencyKey?: string;
};
/** `start` for an owner already identified: also what the assistant's posting tools run once the user confirmed. */
export async function startPendingFor(ctx: MutationCtx, ownerId: string, args: PendingInput) {
  const now = Date.now(), project = await requireProject(ctx, args.projectId, ownerId);
  if (args.idempotencyKey) {
    const existing = await pendingForKey(ctx, ownerId, args.idempotencyKey);
    if (existing) return existing._id;
  }
  if (!args.accountIds.length) throw new ConvexError('Pick at least one account.');
  if (args.accountIds.length > TARGET_LIMIT || new Set(args.accountIds).size !== args.accountIds.length) throw new ConvexError(`Pick up to ${TARGET_LIMIT} different accounts.`);
  const { caption, title } = batchText(args, now);
  const problem = await targetsProblem(ctx, ownerId, args.accountIds);
  if (problem) throw new ConvexError(problem);
  const open = activeTabOf(project), timelineId = args.timelineId ?? open;
  if (!tabsOf(project).some(tab => tab.id === timelineId)) throw new ConvexError('That timeline no longer exists.');
  if (project.aiRunning) throw new ConvexError('Wait for the current edit to finish, then post.');
  // One press, one post: a second editor tab or a repeated request must not send the same clip twice.
  const recent = await ctx.db.query('postingPending').withIndex('by_owner_project', q => q.eq('ownerId', ownerId).eq('projectId', project._id)).order('desc').take(20);
  if (recent.some(row => (row.status === 'waiting' || row.status === 'queued') && row.timelineId === timelineId)) throw new ConvexError('This clip is already exporting for a post. Wait for it, or cancel it first.');
  if (recent.some(row => row.status === 'created' && now - row.createdAt < DOUBLE_PRESS_MS && row.timelineId === timelineId && (row.scheduledAt ?? null) === (args.scheduledAt !== undefined && args.scheduledAt > now ? args.scheduledAt : null) && row.accountIds.length === args.accountIds.length && row.accountIds.every(id => args.accountIds.includes(id)))) throw new ConvexError('This clip was just posted to these accounts.');
  const { settings, ultra, ready, running } = await exportPlan(ctx, ownerId, project, timelineId);
  // A clip no chosen platform can take is refused here, before an export is spent on it.
  const shape = await clipShape(ctx, project, timelineId, settings.resolution);
  if (!shape) throw new ConvexError('That timeline no longer exists.');
  for (const accountId of args.accountIds) {
    const account = (await ctx.db.get(accountId))!, refused = shapeProblems(account.platform, shape)[0];
    if (refused) throw new ConvexError(`Nothing was exported or posted. ${refused}`);
  }
  // Several clips posted at once can outnumber the exports an account may run: the rest queue and start as exports finish.
  const queued = !ready && !running && !!await exportsFull(ctx, ownerId, ultra);
  const jobId = queued ? undefined : ready?._id ?? running?._id ?? await startRenderFor(ctx, ownerId, { projectId: project._id, ...settings, ...(timelineId !== open ? { timelineId } : {}) });
  const pendingId = await ctx.db.insert('postingPending', {
    ownerId, projectId: project._id, timelineId, ...(jobId ? { jobId } : {}), caption, ...(title ? { title } : {}), ...(args.scheduledAt !== undefined && args.scheduledAt > now ? { scheduledAt: args.scheduledAt } : {}),
    ...(args.campaignId ? { campaignId: args.campaignId } : {}), accountIds: args.accountIds, status: queued ? 'queued' : 'waiting', createdAt: now, updatedAt: now,
    ...(args.targets ? { targets: args.targets } : {}), ...(args.createdBy ? { createdBy: args.createdBy } : {}), ...(args.agentName ? { agentName: args.agentName } : {}), ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
  });
  if (ready && jobId) await settleJob(ctx, jobId);
  return pendingId;
}
/** The post an earlier call with this key created and that still stands. One that failed or was cancelled sent nothing, so asking again starts a new one. */
export async function pendingForKey(ctx: QueryCtx | MutationCtx, ownerId: string, idempotencyKey: string) {
  const rows = await ctx.db.query('postingPending').withIndex('by_owner_key', q => q.eq('ownerId', ownerId).eq('idempotencyKey', idempotencyKey)).collect();
  return rows.find(row => row.status !== 'failed' && row.status !== 'cancelled') ?? null;
}
/** How long and how large a timeline tab is when exported at this resolution; null when the tab is gone. */
export async function clipShape(ctx: QueryCtx | MutationCtx, project: Doc<'projects'>, timelineId: string, resolution: number) {
  const timeline = await storedTabTimeline(ctx, project, timelineId);
  return timeline ? { durationSeconds: timelineDuration(timeline), ...dimensions(timeline.aspectRatio, resolution) } : null;
}

/**
 * Post the open timeline to connected accounts, now or at `scheduledAt`. Returns the pending post to follow.
 * The export always starts now, also for a scheduled post, so the file is the version that was current at the press.
 */
export const start = mutation({
  args: {
    projectId: v.id('projects'), caption: v.string(), title: v.optional(v.string()), scheduledAt: v.optional(v.number()), campaignId: v.optional(v.string()), accountIds: v.array(v.id('postingAccounts')),
    /** The timeline tab to post: the one on the user's screen, or a clip picked in the chat. Without it, the open tab. */
    timelineId: v.optional(v.string()),
  },
  returns: v.id('postingPending'),
  handler: async (ctx, args) => startPendingFor(ctx, await requireOwner(ctx), args),
});

/** Stop a post that is still waiting for its export. The export itself keeps going; it is the user's file either way. */
export const cancel = mutation({
  args: { pendingId: v.id('postingPending') }, returns: v.null(),
  handler: async (ctx, { pendingId }) => {
    const ownerId = await requireOwner(ctx), pending = await ctx.db.get(pendingId);
    if (!pending || pending.ownerId !== ownerId) throw new ConvexError('Post not found');
    if (pending.status !== 'waiting' && pending.status !== 'queued') throw new ConvexError('This post has already started.');
    await ctx.db.patch(pendingId, { status: 'cancelled', updatedAt: Date.now() });
    return null;
  },
});

/** Every post waiting on this export: a batch when the file exists, `failed` with the reason when it will not. */
async function settleJob(ctx: MutationCtx, jobId: Id<'renderJobs'>) {
  const waiting = (await ctx.db.query('postingPending').withIndex('by_job', q => q.eq('jobId', jobId)).collect()).filter(row => row.status === 'waiting');
  if (!waiting.length) return;
  const job = await ctx.db.get(jobId), now = Date.now();
  if (job && (job.status === 'queued' || job.status === 'rendering')) return;
  const fail = (pending: Doc<'postingPending'>, error: string) => ctx.db.patch(pending._id, { status: 'failed', error: error.slice(0, ERROR_LIMIT), updatedAt: now });
  for (const pending of waiting) {
    if (!job) { await fail(pending, 'The export was deleted before it could be posted.'); continue; }
    if (job.status === 'cancelled') { await fail(pending, 'The export was stopped, so nothing was posted.'); continue; }
    if (job.status !== 'completed' || !job.outputR2Key && !job.outputStorageId) { await fail(pending, `The export failed, so nothing was posted. ${job.error ?? ''}`.trim()); continue; }
    // Checked before the batch is written: a mutation that caught an error half way would keep the rows written so far.
    const reason = await targetsProblem(ctx, pending.ownerId, pending.accountIds);
    if (reason) { await fail(pending, `Nothing was posted. ${reason}`); continue; }
    const batchId = await createBatchFor(ctx, pending.ownerId, {
      jobId, caption: pending.caption, ...(pending.title ? { title: pending.title } : {}), ...(pending.campaignId ? { campaignId: pending.campaignId } : {}),
      // A time that passed while the export rendered posts now.
      ...(pending.scheduledAt !== undefined && pending.scheduledAt > now ? { scheduledAt: pending.scheduledAt } : {}),
      targets: pending.targets ?? pending.accountIds.map(accountId => ({ accountId })),
      ...(pending.createdBy ? { createdBy: pending.createdBy } : {}), ...(pending.agentName ? { agentName: pending.agentName } : {}),
    });
    await ctx.db.patch(pending._id, { status: 'created', batchId, updatedAt: now });
  }
}
/** Scheduled when an export completes, fails or is stopped, and by the posting tick as the safety net. */
export const settle = internalMutation({ args: { jobId: v.id('renderJobs') }, returns: v.null(), handler: async (ctx, { jobId }) => {
  await settleJob(ctx, jobId);
  // An export ended, so a queued post of this owner may be able to start its own.
  const job = await ctx.db.get(jobId);
  if (job) await ctx.scheduler.runAfter(0, internal.postExports.advance, { ownerId: job.ownerId });
  return null;
} });

/** Start the export of the owner's oldest queued post when one can run. One post per run, so a refusal fails only that post. */
export const advance = internalMutation({ args: { ownerId: v.string() }, returns: v.null(), handler: async (ctx, { ownerId }) => {
  const queued = (await ctx.db.query('postingPending').withIndex('by_status', q => q.eq('status', 'queued')).take(200)).filter(row => row.ownerId === ownerId);
  const pending = queued[0], now = Date.now();
  if (!pending) return null;
  const ultra = await hasUltraPlan(ctx, ownerId);
  if (await exportsFull(ctx, ownerId, ultra)) return null;
  const project = await ctx.db.get(pending.projectId);
  if (!project || project.ownerId !== ownerId) { await ctx.db.patch(pending._id, { status: 'failed', error: 'The project was deleted before this clip could be exported.', updatedAt: now }); }
  else {
    const jobs = await ctx.db.query('renderJobs').withIndex('by_ownerId_projectId', q => q.eq('ownerId', ownerId).eq('projectId', project._id)).order('desc').take(50);
    try {
      // Every refusal in startRenderFor comes before it writes anything, so catching one here leaves no half-made export.
      const jobId = await startRenderFor(ctx, ownerId, { projectId: project._id, ...exportSettings(jobs, project.timeline?.fps ?? 30, ultra), ...(pending.timelineId !== activeTabOf(project) ? { timelineId: pending.timelineId } : {}) });
      await ctx.db.patch(pending._id, { status: 'waiting', jobId, updatedAt: now });
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      await ctx.db.patch(pending._id, { status: 'failed', error: `The export could not start, so nothing was posted. ${String(error.data)}`.slice(0, ERROR_LIMIT), updatedAt: now });
    }
  }
  if (queued.length > 1) await ctx.scheduler.runAfter(0, internal.postExports.advance, { ownerId });
  return null;
} });

const pendingView = v.object({
  id: v.id('postingPending'), status: pendingPostStatus, error: v.union(v.string(), v.null()), createdAt: v.number(), scheduledAt: v.union(v.number(), v.null()),
  campaignId: v.union(v.string(), v.null()), accounts: v.number(),
  /** The export this post waits on. */
  exportStatus: v.union(v.literal('queued'), v.literal('rendering'), v.literal('completed'), v.literal('failed'), v.literal('cancelled'), v.null()), exportProgress: v.number(),
  /** Once the batch exists: how its posts are doing. */
  batchId: v.union(v.id('postingBatches'), v.null()), published: v.number(), failed: v.number(), sending: v.number(), scheduled: v.number(), postError: v.union(v.string(), v.null()),
});
async function view(ctx: QueryCtx, pending: Doc<'postingPending'>) {
  const job = pending.jobId ? await ctx.db.get(pending.jobId) : null;
  const posts = pending.batchId ? await ctx.db.query('postingPosts').withIndex('by_batch', q => q.eq('batchId', pending.batchId!)).collect() : [];
  const count = (...statuses: Doc<'postingPosts'>['status'][]) => posts.filter(post => statuses.includes(post.status)).length;
  const later = posts.filter(post => post.status === 'scheduled' && post.attempts === 0 && post.scheduledAt !== undefined).length;
  return {
    id: pending._id, status: pending.status, error: pending.error ?? null, createdAt: pending.createdAt, scheduledAt: pending.scheduledAt ?? null,
    campaignId: pending.campaignId ?? null, accounts: pending.accountIds.length,
    exportStatus: job?.status ?? null, exportProgress: job?.progress ?? 0,
    // A post whose time has come (or that waits for a retry) is on its way; only one with a later date counts as scheduled.
    batchId: pending.batchId ?? null, published: count('published'), failed: count('failed'), sending: count('posting', 'processing') + count('scheduled') - later,
    scheduled: later,
    postError: posts.find(post => post.status === 'failed')?.error ?? null,
  };
}
/** The project's latest post from the editor, for the state shown beside Export. Null when there is none. */
export const latest = query({
  args: { projectId: v.id('projects') }, returns: v.union(pendingView, v.null()),
  handler: async (ctx, { projectId }) => {
    const ownerId = await requireOwner(ctx);
    await projectIdentity(ctx, projectId, ownerId);
    // A cancelled post leaves the one before it in place.
    const pending = (await ctx.db.query('postingPending').withIndex('by_owner_project', q => q.eq('ownerId', ownerId).eq('projectId', projectId)).order('desc').take(10)).find(row => row.status !== 'cancelled');
    return pending ? view(ctx, pending) : null;
  },
});

/** How long a post whose export failed stays on the Posts page. */
const FAILED_SHOWN_MS = 24 * 3600_000;
/**
 * The owner's posts that have no batch yet, for the Posts page: clips still exporting (or queued behind the export
 * limit) and, for a day, clips whose export failed, with the reason. Once the export completes the post becomes a
 * batch and `posting.clipPosts` shows it.
 */
export const exporting = query({
  args: {},
  returns: v.array(v.object({
    id: v.id('postingPending'), label: v.string(), caption: v.string(), coverUrl: v.union(v.string(), v.null()), coverKind: v.union(v.literal('video'), v.literal('image'), v.null()),
    status: v.union(v.literal('exporting'), v.literal('failed')), error: v.union(v.string(), v.null()), progress: v.number(),
    scheduledAt: v.union(v.number(), v.null()), createdAt: v.number(), byAssistant: v.boolean(),
    accounts: v.array(v.object({ id: v.id('postingAccounts'), platform: postingPlatform, username: v.string(), avatarUrl: v.union(v.string(), v.null()) })),
  })),
  handler: async ctx => {
    const ownerId = await requireOwner(ctx), now = Date.now();
    const rows = (await ctx.db.query('postingPending').withIndex('by_owner_createdAt', q => q.eq('ownerId', ownerId)).order('desc').take(60))
      .filter(row => row.status === 'waiting' || row.status === 'queued' || row.status === 'failed' && now - row.updatedAt < FAILED_SHOWN_MS);
    const clips = [], projects = new Map<Id<'projects'>, { project: Doc<'projects'> | null; cover: Awaited<ReturnType<typeof projectCover>> }>();
    for (const row of rows) {
      if (!projects.has(row.projectId)) projects.set(row.projectId, { project: await ctx.db.get(row.projectId), cover: await projectCover(ctx, row.projectId) });
      const { project, cover: { title, coverUrl, coverKind } } = projects.get(row.projectId)!, job = row.jobId ? await ctx.db.get(row.jobId) : null;
      const tabs = project ? tabsOf(project) : [], tab = tabs.find(item => item.id === row.timelineId);
      const accounts = [];
      for (const accountId of row.accountIds) {
        const account = await ctx.db.get(accountId);
        if (account) accounts.push({ id: account._id, platform: account.platform, username: account.username, avatarUrl: await accountPicture(ctx, account) });
      }
      clips.push({
        id: row._id, label: `${title ?? project?.title ?? 'Video'}${tabs.length > 1 && tab ? ` · ${tab.name}` : ''}`, caption: row.caption, coverUrl, coverKind,
        status: row.status === 'failed' ? 'failed' as const : 'exporting' as const, error: row.error ?? null, progress: job?.status === 'rendering' ? job.progress ?? 0 : 0,
        scheduledAt: row.scheduledAt ?? null, createdAt: row.createdAt, byAssistant: row.createdBy === 'assistant', accounts,
      });
    }
    return clips;
  },
});
