import { ConvexError, v, type Infer } from 'convex/values';
import { vResultValidator, vWorkflowId, type WorkflowId } from '@convex-dev/workflow';
import { internal } from './_generated/api';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { analysisValidator, assetWithUrl, mediaTaskKind, mediaTaskStatus, timelineValidator, waveformValidator } from './schema';
import { requireOwner, requireProject } from './lib/auth';
import { mediaTaskCredentials, requireMediaTask, requireMediaWorker } from './lib/media_task_auth';
import { mediaWorkflow } from './lib/workflows';
import { mediaUrl } from './lib/media_storage';
import { saveAssetAnalysis, validateWaveform } from './assets';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;
const eventResult = v.object({ success: v.boolean(), retryable: v.boolean(), error: v.optional(v.string()) });
const taskState = v.object({ _id: v.id('mediaTasks'), kind: mediaTaskKind, status: mediaTaskStatus, progress: v.number(), attempt: v.number(), error: v.optional(v.string()), assetId: v.optional(v.id('assets')) });
const renderSnapshot = v.object({ timeline: timelineValidator, assets: v.array(assetWithUrl), resolution: v.number(), fps: v.number(), quality: v.string() });
const workItem = v.object({ ...mediaTaskCredentials, projectId: v.id('projects'), kind: mediaTaskKind, asset: v.optional(assetWithUrl), outputAssetId: v.optional(v.id('assets')), outputStored: v.optional(v.boolean()), render: v.optional(renderSnapshot), renderJobId: v.optional(v.id('renderJobs')) });
export type MediaWorkItem = Infer<typeof workItem>;
export const taskResult = v.object({ analysis: v.optional(analysisValidator), audioAssetId: v.optional(v.id('assets')), waveform: v.optional(waveformValidator) });
export type MediaTaskResult = Infer<typeof taskResult>;

export async function enqueueMediaTask(ctx: MutationCtx, input: Pick<Doc<'mediaTasks'>, 'ownerId' | 'projectId' | 'kind'> & Partial<Pick<Doc<'mediaTasks'>, 'assetId' | 'renderJobId' | 'analysisRequestId'>>): Promise<Id<'mediaTasks'>> {
  if (input.assetId) {
    const existing = await ctx.db.query('mediaTasks').withIndex('by_asset_kind', q => q.eq('assetId', input.assetId).eq('kind', input.kind)).order('desc').take(10);
    const active = existing.find(task => task.status === 'queued' || task.status === 'running' || task.status === 'retrying');
    if (active) { if (input.analysisRequestId) await ctx.db.patch(active._id, { analysisRequestId: input.analysisRequestId }); return active._id; }
  }
  const now = Date.now();
  const taskId = await ctx.db.insert('mediaTasks', { ...input, status: 'queued', attempt: 0, progress: 0, createdAt: now, updatedAt: now });
  const workflowId = await mediaWorkflow.start(ctx, internal.mediaTasks.process, { taskId }, { startAsync: true, onComplete: internal.mediaTasks.settle, context: { taskId } });
  await ctx.db.patch(taskId, { workflowId });
  return taskId;
}

export const process = mediaWorkflow.define({
  args: { taskId: v.id('mediaTasks') }, returns: v.null(),
  handler: async (step, { taskId }): Promise<null> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ready: boolean = await step.runMutation(internal.mediaTasks.prepareAttempt, { taskId, attempt });
      if (!ready) return null;
      const result = await step.awaitEvent({ name: `attempt-${attempt}`, validator: eventResult });
      if (result.success) return null;
      if (!result.retryable || attempt === MAX_ATTEMPTS) {
        await step.runMutation(internal.mediaTasks.markFailed, { taskId, error: result.error ?? 'Media processing failed.' });
        return null;
      }
      await step.sleep(2_000 * 2 ** (attempt - 1));
    }
    return null;
  },
});
export const prepareAttempt = internalMutation({ args: { taskId: v.id('mediaTasks'), attempt: v.number() }, returns: v.boolean(), handler: async (ctx, args) => {
  const task = await ctx.db.get(args.taskId);
  if (!task || ['completed', 'cancelled', 'failed'].includes(task.status)) return false;
  await ctx.db.patch(task._id, { status: 'queued', attempt: args.attempt, leaseToken: undefined, leaseExpiresAt: undefined, attemptStartedAt: undefined, updatedAt: Date.now() });
  return true;
}});
async function signalResult(ctx: MutationCtx, task: Doc<'mediaTasks'>, value: Infer<typeof eventResult>) {
  if (task.workflowId) await mediaWorkflow.sendEvent(ctx, { workflowId: task.workflowId as WorkflowId, name: `attempt-${task.attempt}`, validator: eventResult, value });
}
async function failTask(ctx: MutationCtx, task: Doc<'mediaTasks'>, error: string, retryable: boolean) {
  await ctx.db.patch(task._id, { status: retryable ? 'retrying' : 'failed', error: error.slice(0, 1000), leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
  await signalResult(ctx, task, { success: false, retryable, error: error.slice(0, 1000) });
}
async function markTerminal(ctx: MutationCtx, taskId: Id<'mediaTasks'>, status: 'failed' | 'cancelled', error: string) {
  const task = await ctx.db.get(taskId);
  if (!task || task.status === 'completed' || task.status === 'cancelled') return;
  await ctx.db.patch(taskId, { status, error: error.slice(0, 1000), leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
  if (task.renderJobId) {
    const job = await ctx.db.get(task.renderJobId);
    if (job && job.status !== 'completed') await ctx.db.patch(job._id, { status: 'failed', error: error.slice(0, 1000), updatedAt: Date.now() });
  }
  if (task.analysisRequestId) {
    const request = await ctx.db.get(task.analysisRequestId);
    if (request) await ctx.db.patch(request._id, { status: 'failed', error: error.slice(0, 1000) });
  }
}
export const markFailed = internalMutation({ args: { taskId: v.id('mediaTasks'), error: v.string() }, returns: v.null(), handler: async (ctx, args) => { await markTerminal(ctx, args.taskId, 'failed', args.error); return null; } });
export const settle = internalMutation({ args: { workflowId: vWorkflowId, result: vResultValidator, context: v.object({ taskId: v.id('mediaTasks') }) }, returns: v.null(), handler: async (ctx, args) => {
  if (args.result.kind !== 'success') await markTerminal(ctx, args.context.taskId, args.result.kind === 'canceled' ? 'cancelled' : 'failed', args.result.kind === 'failed' ? args.result.error : 'Processing cancelled.');
  await ctx.scheduler.runAfter(24 * 3600_000, internal.mediaTasks.cleanup, { workflowId: args.workflowId });
  return null;
}});
export const cleanup = internalMutation({ args: { workflowId: vWorkflowId }, returns: v.null(), handler: async (ctx, args) => { await mediaWorkflow.cleanup(ctx, args.workflowId); return null; } });

export const start = mutation({ args: { projectId: v.id('projects'), assetId: v.id('assets'), kind: mediaTaskKind }, returns: v.id('mediaTasks'), handler: async (ctx, args): Promise<Id<'mediaTasks'>> => {
  const ownerId = await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId);
  const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId || asset.kind === 'image' || args.kind === 'render') throw new ConvexError('Choose media from this project.');
  if (['extract', 'shots', 'understand', 'track'].includes(args.kind) && asset.kind !== 'video') throw new ConvexError('This operation requires a video.');
  if (args.kind === 'waveform' && asset.kind !== 'audio') throw new ConvexError('Waveforms require an audio source.');
  return enqueueMediaTask(ctx, { ...args, ownerId });
}});
export const get = query({ args: { taskId: v.id('mediaTasks') }, returns: taskState, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), task = await ctx.db.get(args.taskId);
  if (!task || task.ownerId !== ownerId) throw new ConvexError('Media task not found.');
  await requireProject(ctx, task.projectId, ownerId);
  const { _id, kind, status, progress, attempt, error, assetId } = task;
  return { _id, kind, status, progress, attempt, error, assetId };
}});
export const list = query({ args: { projectId: v.id('projects') }, returns: v.array(taskState), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId);
  const tasks = await ctx.db.query('mediaTasks').withIndex('by_project_createdAt', q => q.eq('projectId', args.projectId)).order('desc').take(40);
  return tasks.map(({ _id, kind, status, progress, attempt, error, assetId }) => ({ _id, kind, status, progress, attempt, error, assetId }));
}});
export async function cancelMediaTask(ctx: MutationCtx, taskId: Id<'mediaTasks'>) {
  const task = await ctx.db.get(taskId);
  if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return;
  await markTerminal(ctx, taskId, 'cancelled', 'Processing cancelled.');
  if (task.workflowId) await mediaWorkflow.cancel(ctx, task.workflowId as WorkflowId);
}
export const ready = query({ args: { workerSecret: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  requireMediaWorker(args.workerSecret);
  const tasks = await ctx.db.query('mediaTasks').withIndex('by_status_createdAt', q => q.eq('status', 'queued')).take(10);
  return tasks.filter(task => task.attempt > 0 && task.workflowId).map(task => `${task._id}:${task.attempt}`).join(',');
}});

export const claim = mutation({ args: { workerSecret: v.string() }, returns: v.union(workItem, v.null()), handler: async (ctx, args): Promise<MediaWorkItem | null> => {
  requireMediaWorker(args.workerSecret);
  const tasks = await ctx.db.query('mediaTasks').withIndex('by_status_createdAt', q => q.eq('status', 'queued')).take(10);
  const task = tasks.find(task => task.workflowId && task.attempt > 0);
  if (!task) return null;
  const project = await ctx.db.get(task.projectId), asset = task.assetId ? await ctx.db.get(task.assetId) : null;
  if (!project || project.ownerId !== task.ownerId || (task.assetId && (!asset || asset.ownerId !== task.ownerId || asset.projectId !== project._id))) {
    await failTask(ctx, task, 'The project or source media was removed.', false); return null;
  }
  let render: Infer<typeof renderSnapshot> | undefined, outputStored = false;
  if (task.renderJobId) {
    const job = await ctx.db.get(task.renderJobId);
    if (!job?.timeline || job.ownerId !== task.ownerId || job.projectId !== task.projectId) { await failTask(ctx, task, 'The export snapshot is unavailable.', false); return null; }
    outputStored = !!job.outputR2Key;
    const assets = await Promise.all((job.assetIds ?? []).map(async id => {
      const item = await ctx.db.get(id);
      return item && item.ownerId === task.ownerId && item.projectId === task.projectId ? { ...item, url: await mediaUrl(ctx, item) } : null;
    }));
    if (assets.some(item => !item?.url)) { await failTask(ctx, task, 'Export source media is unavailable.', false); return null; }
    render = { timeline: job.timeline, assets: assets as Infer<typeof assetWithUrl>[], resolution: job.resolution ?? 1080, fps: job.fps ?? job.timeline.fps, quality: job.quality ?? 'high' };
    await ctx.db.patch(job._id, { status: 'rendering', error: undefined, updatedAt: Date.now() });
  }
  const leaseToken = crypto.randomUUID(), now = Date.now();
  await ctx.db.patch(task._id, { status: 'running', leaseToken, leaseExpiresAt: now + LEASE_MS, attemptStartedAt: now, updatedAt: now });
  if (task.analysisRequestId && await ctx.db.get(task.analysisRequestId)) await ctx.db.patch(task.analysisRequestId, { status: 'running' });
  await ctx.scheduler.runAfter(LEASE_MS, internal.mediaTasks.expire, { taskId: task._id, leaseToken });
  return { taskId: task._id, leaseToken, projectId: task.projectId, kind: task.kind, ...(asset ? { asset: { ...asset, url: await mediaUrl(ctx, asset) } } : {}), ...(render ? { render, outputStored } : {}), ...(task.renderJobId ? { renderJobId: task.renderJobId } : {}), ...(task.outputAssetId ? { outputAssetId: task.outputAssetId } : {}) };
}});
export const heartbeat = mutation({ args: { ...mediaTaskCredentials, progress: v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  const task = await requireMediaTask(ctx, args.taskId, args.leaseToken);
  if (args.progress !== undefined && (!Number.isFinite(args.progress) || args.progress < 0 || args.progress > 99)) throw new ConvexError('Invalid processing progress.');
  const progress = Math.max(task.progress, args.progress ?? task.progress);
  await ctx.db.patch(task._id, { leaseExpiresAt: Date.now() + LEASE_MS, progress, updatedAt: Date.now() });
  if (task.renderJobId) await ctx.db.patch(task.renderJobId, { progress, updatedAt: Date.now() });
  return null;
}});
export const expire = internalMutation({ args: mediaTaskCredentials, returns: v.null(), handler: async (ctx, args) => {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.status !== 'running' || task.leaseToken !== args.leaseToken) return null;
  const remaining = (task.leaseExpiresAt ?? 0) - Date.now();
  if (remaining > 0) await ctx.scheduler.runAfter(remaining, internal.mediaTasks.expire, args);
  else await failTask(ctx, task, 'The media worker disconnected. Retrying from saved progress.', true);
  return null;
}});
export const fail = mutation({ args: { ...mediaTaskCredentials, error: v.string(), retryable: v.boolean() }, returns: v.null(), handler: async (ctx, args) => {
  const task = await requireMediaTask(ctx, args.taskId, args.leaseToken);
  await failTask(ctx, task, args.error, args.retryable); return null;
}});
export const complete = mutation({ args: { ...mediaTaskCredentials, result: taskResult }, returns: v.null(), handler: async (ctx, args) => {
  const saved = await ctx.db.get(args.taskId);
  if (saved?.status === 'completed' && saved.leaseToken === args.leaseToken) return null;
  const task = await requireMediaTask(ctx, args.taskId, args.leaseToken);
  const asset = task.assetId ? await ctx.db.get(task.assetId) : null;
  if (task.kind === 'render') {
    const job = task.renderJobId ? await ctx.db.get(task.renderJobId) : null;
    if (!job?.outputR2Key) throw new ConvexError('Export has not stored its MP4 yet.');
    await ctx.db.patch(job._id, { status: 'completed', progress: 100, error: undefined, updatedAt: Date.now() });
  } else {
    if (!asset || asset.ownerId !== task.ownerId || asset.projectId !== task.projectId) throw new ConvexError('Source media was removed.');
    if (task.kind === 'extract') {
      if (asset.audioExtracted) {
        if (args.result.audioAssetId !== asset.audioAssetId) throw new ConvexError('Audio output does not match the prepared source.');
      } else if (args.result.audioAssetId !== task.outputAssetId) throw new ConvexError('Extracted audio must be the output of this task.');
      const audio = task.outputAssetId ? await ctx.db.get(task.outputAssetId) : null;
      if (audio && (audio.kind !== 'audio' || audio.projectId !== task.projectId || audio.ownerId !== task.ownerId)) throw new ConvexError('Invalid extracted audio.');
      if (args.result.waveform) { validateWaveform(args.result.waveform); if (!audio) throw new ConvexError('Audio is required for a waveform.'); await ctx.db.patch(audio._id, { waveform: args.result.waveform }); }
      await ctx.db.patch(asset._id, { audioExtracted: true, ...(audio ? { audioAssetId: audio._id } : {}) });
    } else if (task.kind === 'waveform') {
      if (!args.result.waveform) throw new ConvexError('No waveform was returned.');
      validateWaveform(args.result.waveform); await ctx.db.patch(asset._id, { waveform: args.result.waveform });
    } else {
      const key = task.kind === 'transcribe' ? 'transcript' : task.kind === 'understand' ? 'understanding' : task.kind === 'track' ? 'focus' : task.kind;
      if (!args.result.analysis?.[key]) throw new ConvexError('The requested analysis result is missing.');
      await saveAssetAnalysis(ctx, asset, args.result.analysis);
    }
  }
  if (task.analysisRequestId && await ctx.db.get(task.analysisRequestId)) await ctx.db.patch(task.analysisRequestId, { status: 'completed', error: undefined });
  await ctx.db.patch(task._id, { status: 'completed', progress: 100, error: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
  await signalResult(ctx, task, { success: true, retryable: false });
  return null;
}});
