import { hydrateAsset } from './lib/asset_analysis';
import { writeProject,createProject,readProject,projectIdentity,projectRun } from './lib/project_data';
import { requireEditorAccess } from './lib/billing_access';
import { ConvexError, v, type Infer } from 'convex/values';
import { vResultValidator, vWorkflowId, type WorkflowId } from '@convex-dev/workflow';
import { internal } from './_generated/api';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { analysisValidator, assetWithUrl, frameInspectionValidator, frameRequestValidator, videoInspectionValidator, videoRequestValidator, mediaTaskKind, mediaTaskStatus, timelineValidator, waveformValidator } from './schema';
import { validateFrameInspectionResult } from '../lib/media-analysis/frame-inspection';
import { validateVideoInspectionResult } from '../lib/media-analysis/video-inspection';
import { requireOwner, requireProject } from './lib/auth';
import { mediaTaskCredentials, requireMediaTask, requireMediaWorker } from './lib/media_task_auth';
import { mediaWorkflow } from './lib/workflows';
import { mediaUrl } from './lib/media_storage';
import { saveAssetAnalysis, validateWaveform } from './assets';
import { parseVideoLink } from '../lib/editor/video-link';
import { addMediaClip } from '../lib/editor/operations';
import { timelineDuration } from '../lib/editor/types';
import { commitTimeline, currentTimeline } from './lib/timeline';
import { BEAT_ANALYSIS_ENGINE } from '../lib/media-analysis/beat-map';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;
const eventResult = v.object({ success: v.boolean(), retryable: v.boolean(), error: v.optional(v.string()) });
const taskState = v.object({ _id: v.id('mediaTasks'), kind: mediaTaskKind, status: mediaTaskStatus, progress: v.number(), attempt: v.number(), error: v.optional(v.string()), assetId: v.optional(v.id('assets')) });
const renderSnapshot = v.object({ timeline: timelineValidator, assets: v.array(assetWithUrl), resolution: v.number(), fps: v.number(), quality: v.string() });
const workItem = v.object({ ...mediaTaskCredentials, projectId: v.id('projects'), kind: mediaTaskKind, sourceUrl: v.optional(v.string()), frameRequest: v.optional(frameRequestValidator), videoRequest: v.optional(videoRequestValidator), asset: v.optional(assetWithUrl), outputAssetId: v.optional(v.id('assets')), outputStored: v.optional(v.boolean()), render: v.optional(renderSnapshot), renderJobId: v.optional(v.id('renderJobs')) });
export type MediaWorkItem = Infer<typeof workItem>;
export const taskResult = v.object({ analysis: v.optional(analysisValidator), frameInspection: v.optional(frameInspectionValidator), videoInspection: v.optional(videoInspectionValidator), audioAssetId: v.optional(v.id('assets')), waveform: v.optional(waveformValidator) });
export type MediaTaskResult = Infer<typeof taskResult>;

export async function enqueueMediaTask(ctx: MutationCtx, input: Pick<Doc<'mediaTasks'>, 'ownerId' | 'projectId' | 'kind'> & Partial<Pick<Doc<'mediaTasks'>, 'assetId' | 'renderJobId' | 'analysisRequestId' | 'sourceUrl' | 'frameRequest' | 'videoRequest'>>): Promise<Id<'mediaTasks'>> {
  if (input.assetId && input.kind === 'beats') {
    const asset = await ctx.db.get(input.assetId);
    const beats=asset?(await hydrateAsset(ctx,asset)).analysis?.beats:undefined;
    if (asset?.ownerId === input.ownerId && asset.projectId === input.projectId && beats?.engine === BEAT_ANALYSIS_ENGINE && beats.downbeats !== undefined && beats.accents !== undefined && beats.dropCandidates !== undefined) {
      const now = Date.now();
      const taskId = await ctx.db.insert('mediaTasks', { ...input, status: 'completed', attempt: 0, progress: 100, createdAt: now, updatedAt: now });
      if (input.analysisRequestId) await ctx.db.patch(input.analysisRequestId, { status: 'completed', error: undefined });
      return taskId;
    }
  }
  if (input.assetId && input.kind !== 'frames' && input.kind !== 'video') {
    const existing = await ctx.db.query('mediaTasks').withIndex('by_asset_kind', q => q.eq('assetId', input.assetId).eq('kind', input.kind)).order('desc').take(10);
    const active = existing.find(task => task.status === 'queued' || task.status === 'running' || task.status === 'retrying');
    if (active) { if (input.analysisRequestId) await ctx.db.patch(active._id, { analysisRequestId: input.analysisRequestId }); return active._id; }
  }
  const now = Date.now();
  const taskId = await ctx.db.insert('mediaTasks', { ...input, status: 'queued', claimable:false, attempt: 0, progress: 0, createdAt: now, updatedAt: now });
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
  await ctx.db.patch(task._id, { status: 'queued', claimable:true, attempt: args.attempt, leaseToken: undefined, leaseExpiresAt: undefined, attemptStartedAt: undefined, updatedAt: Date.now() });
  // Wake only after this attempt is claimable, including retries after backoff.
  if (globalThis.process.env.MEDIA_PROCESSOR_WAKE_URL) await ctx.scheduler.runAfter(0, internal.mediaProcessor.wake, {});
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
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); await requireProject(ctx, args.projectId, ownerId);
  const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId || asset.kind === 'image' || args.kind === 'render' || args.kind === 'import') throw new ConvexError('Choose media from this project.');
  if (args.kind === 'frames') throw new ConvexError('Frame inspection requires a scoped AI question and source window.');
  if (args.kind === 'video') throw new ConvexError('Native video inspection requires a scoped AI question and source window.');
  if (['extract', 'shots', 'understand', 'track'].includes(args.kind) && asset.kind !== 'video') throw new ConvexError('This operation requires a video.');
  if (args.kind === 'waveform' && asset.kind !== 'audio') throw new ConvexError('Waveforms require an audio source.');
  return enqueueMediaTask(ctx, { ...args, ownerId });
}});
export const importVideo = mutation({ args: { projectId: v.optional(v.id('projects')), url: v.string() }, returns: v.object({ projectId: v.id('projects'), taskId: v.id('mediaTasks') }), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId);
  let sourceUrl: string;
  try { sourceUrl = parseVideoLink(args.url).url; } catch (error) { throw new ConvexError((error as Error).message); }
  // A new edit and its durable import are created atomically.
  const now = Date.now();
  const projectId = args.projectId ?? await createProject(ctx, { ownerId, title: 'Video import', aspectRatio: 'vertical', timeline: { fps: 30, aspectRatio: 'vertical', clips: [], tracks: { visual: 1, overlay: 0, audio: 1 } }, revision: 0, history: [], createdAt: now, updatedAt: now });
  await requireProject(ctx, projectId, ownerId);
  const recent = await ctx.db.query('mediaTasks').withIndex('by_project_createdAt', q => q.eq('projectId', projectId)).order('desc').take(40);
  const pending = recent.filter(task => ['queued', 'running', 'retrying'].includes(task.status) && task.kind === 'import');
  const existing = pending.find(task => task.sourceUrl === sourceUrl);
  if (existing) return { projectId, taskId: existing._id };
  if (pending.length >= 3) throw new ConvexError('Wait for the current video imports to finish.');
  const taskId = await enqueueMediaTask(ctx, { ownerId, projectId, kind: 'import', sourceUrl });
  return { projectId, taskId };
}});
export const get = query({ args: { taskId: v.id('mediaTasks') }, returns: taskState, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), task = await ctx.db.get(args.taskId);
  if (!task || task.ownerId !== ownerId) throw new ConvexError('Media task not found.');
  await requireProject(ctx, task.projectId, ownerId);
  const { _id, kind, status, progress, attempt, error, assetId } = task;
  return { _id, kind, status, progress, attempt, error, assetId };
}});
export const list = query({ args: { projectId: v.id('projects') }, returns: v.array(taskState), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await projectIdentity(ctx,args.projectId,ownerId);
  const tasks = await ctx.db.query('mediaTasks').withIndex('by_project_createdAt', q => q.eq('projectId', args.projectId)).order('desc').take(40);
  return tasks.map(({ _id, kind, status, progress, attempt, error, assetId }) => ({ _id, kind, status, progress, attempt, error, assetId }));
}});
export async function cancelMediaTask(ctx: MutationCtx, taskId: Id<'mediaTasks'>) {
  const task = await ctx.db.get(taskId);
  if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return;
  await markTerminal(ctx, taskId, 'cancelled', 'Processing cancelled.');
  if (task.workflowId) await mediaWorkflow.cancel(ctx, task.workflowId as WorkflowId);
}
async function firstClaimable(ctx:MutationCtx|import('./_generated/server').QueryCtx) {
  const indexed=await ctx.db.query('mediaTasks').withIndex('by_status_claimable_created',q=>q.eq('status','queued').eq('claimable',true)).first();
  // Legacy prepared tasks remain claimable during rollout, without a ten-row cap.
  return indexed??await ctx.db.query('mediaTasks').withIndex('by_status_createdAt',q=>q.eq('status','queued')).filter(q=>q.and(q.eq(q.field('claimable'),undefined),q.gt(q.field('attempt'),0),q.neq(q.field('workflowId'),undefined))).first();
}
export const cancel=mutation({args:{taskId:v.id('mediaTasks')},returns:v.null(),handler:async(ctx,args)=>{
  const task=await ctx.db.get(args.taskId);if(!task||task.ownerId!==await requireOwner(ctx))throw new ConvexError('Media task not found.');
  await cancelMediaTask(ctx,task._id);return null;
}});
export const pruneFinished=internalMutation({args:{},returns:v.null(),handler:async ctx=>{
  const cutoff=Date.now()-7*86400_000;
  for(const status of ['completed','failed','cancelled'] as const){
    const rows=await ctx.db.query('mediaTasks').withIndex('by_status_updated',q=>q.eq('status',status).lt('updatedAt',cutoff)).take(100);
    for(const task of rows){if(task.workflowId)await mediaWorkflow.cleanup(ctx,task.workflowId as WorkflowId);await ctx.db.delete(task._id);}
    if(rows.length===100)await ctx.scheduler.runAfter(0,internal.mediaTasks.pruneFinished,{});
  }
  return null;
}});
export const ready = query({ args: { workerSecret: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  requireMediaWorker(args.workerSecret);
  const task=await firstClaimable(ctx);return task?`${task._id}:${task.attempt}`:'';
}});

export const claim = mutation({ args: { workerSecret: v.string() }, returns: v.union(workItem, v.null()), handler: async (ctx, args): Promise<MediaWorkItem | null> => {
  requireMediaWorker(args.workerSecret);
  const task=await firstClaimable(ctx);
  if (!task) return null;
  const project = await readProject(ctx,task.projectId), asset = task.assetId ? await ctx.db.get(task.assetId) : null;
  if (!project || project.deleting || project.ownerId !== task.ownerId || (task.assetId && (!asset || asset.ownerId !== task.ownerId || asset.projectId !== project._id))) {
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
  await ctx.db.patch(task._id, { status: 'running', claimable:false, leaseToken, leaseExpiresAt: now + LEASE_MS, attemptStartedAt: now, updatedAt: now });
  if (task.analysisRequestId && await ctx.db.get(task.analysisRequestId)) await ctx.db.patch(task.analysisRequestId, { status: 'running' });
  await ctx.scheduler.runAfter(LEASE_MS, internal.mediaTasks.expire, { taskId: task._id, leaseToken });
  return { taskId: task._id, leaseToken, projectId: task.projectId, kind: task.kind, ...(task.sourceUrl ? { sourceUrl: task.sourceUrl } : {}), ...(task.frameRequest ? { frameRequest: task.frameRequest } : {}), ...(task.videoRequest ? { videoRequest: task.videoRequest } : {}), ...(asset ? { asset: { ...await hydrateAsset(ctx,asset), url: await mediaUrl(ctx, asset) } } : {}), ...(render ? { render, outputStored } : {}), ...(task.renderJobId ? { renderJobId: task.renderJobId } : {}), ...(task.outputAssetId ? { outputAssetId: task.outputAssetId } : {}) };
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
  if (args.result.frameInspection && task.kind !== 'frames') throw new ConvexError('Frame evidence belongs to a frame inspection task.');
  if (args.result.videoInspection && task.kind !== 'video') throw new ConvexError('Native video evidence belongs to its question task.');
  if (task.kind === 'render') {
    const job = task.renderJobId ? await ctx.db.get(task.renderJobId) : null;
    if (!job?.outputR2Key) throw new ConvexError('Export has not stored its MP4 yet.');
    await ctx.db.patch(job._id, { status: 'completed', progress: 100, error: undefined, updatedAt: Date.now() });
  } else if (task.kind === 'import') {
    const output = task.outputAssetId ? await ctx.db.get(task.outputAssetId) : null;
    if (!output || output.ownerId !== task.ownerId || output.projectId !== task.projectId || output.kind !== 'video' || !output.duration) throw new ConvexError('The imported video has not been stored yet.');
    const project = await requireProject(ctx, task.projectId, task.ownerId);
    const timeline = currentTimeline(project);
    const at = timelineDuration(timeline), duration = output.duration;
    if (duration < 1 / timeline.fps) throw new ConvexError('The imported video is shorter than one timeline frame. It remains saved in Sources.');
    const next = addMediaClip(timeline, { ...output, duration }, `import-${task._id}`, at);
    await commitTimeline(ctx, project, next, project.revision ?? 0);
    await enqueueMediaTask(ctx, { ownerId: task.ownerId, projectId: task.projectId, assetId: output._id, kind: 'extract' });
    await enqueueMediaTask(ctx, { ownerId: task.ownerId, projectId: task.projectId, assetId: output._id, kind: 'understand' });
  } else {
    if (!asset || asset.ownerId !== task.ownerId || asset.projectId !== task.projectId) throw new ConvexError('Source media was removed.');
    if (task.kind === 'video') {
      if (!task.videoRequest || !args.result.videoInspection || asset.kind !== 'video' || !asset.duration) throw new ConvexError('Native video evidence is missing.');
      if (args.result.analysis || args.result.frameInspection || args.result.audioAssetId || args.result.waveform) throw new ConvexError('Video question tasks return video evidence only.');
      const request = task.analysisRequestId ? await ctx.db.get(task.analysisRequestId) : null;
      const project = await readProject(ctx,task.projectId);
      if (!request || request.ownerId !== task.ownerId || request.projectId !== task.projectId || request.assetId !== asset._id || request.mode !== 'video' || !project?.aiRunning || project.aiRunId !== request.aiRunId) throw new ConvexError('AI video request is no longer active.');
      try { validateVideoInspectionResult(args.result.videoInspection, task.videoRequest, asset.duration); } catch (error) { throw new ConvexError((error as Error).message); }
      await ctx.db.patch(task._id, { videoInspection: args.result.videoInspection });
      await ctx.db.patch(request._id, { videoInspection: args.result.videoInspection });
    } else if (task.kind === 'frames') {
      if (!task.frameRequest || !args.result.frameInspection || asset.kind !== 'video') throw new ConvexError('Frame inspection evidence is missing.');
      if (args.result.analysis || args.result.audioAssetId || args.result.waveform) throw new ConvexError('Frame inspections return visual evidence only.');
      try { validateFrameInspectionResult(args.result.frameInspection, task.frameRequest); } catch (error) { throw new ConvexError((error as Error).message); }
      await ctx.db.patch(task._id, { frameInspection: args.result.frameInspection });
      if (task.analysisRequestId && await ctx.db.get(task.analysisRequestId)) await ctx.db.patch(task.analysisRequestId, { frameInspection: args.result.frameInspection });
    } else if (task.kind === 'extract') {
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
      if (task.kind === 'beats' && args.result.analysis.beats?.engine !== BEAT_ANALYSIS_ENGINE) throw new ConvexError('The requested result must use dedicated beat tracking. Analyze this source again with the updated media worker.');
      await saveAssetAnalysis(ctx, asset, args.result.analysis);
    }
  }
  if (task.analysisRequestId && await ctx.db.get(task.analysisRequestId)) await ctx.db.patch(task.analysisRequestId, { status: 'completed', error: undefined });
  await ctx.db.patch(task._id, { status: 'completed', progress: 100, error: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
  await signalResult(ctx, task, { success: true, retryable: false });
  return null;
}});
