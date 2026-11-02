import { normalizationRequestValidator, normalizationResultValidator } from './lib/normalization_validator';
import { initializeMediaCapacity, insertMediaTask, patchMediaTask, deleteMediaTask } from './lib/media_task_data';
import { activeTabOf, storedTabTimeline } from './timelineTabs';
import { loadSceneCode } from './lib/scene_code';
import { renderSnapshot as loadRenderSnapshot } from './lib/render_snapshots';
import { compositionReviewResult,effectPlanValidator } from './lib/effect_plan';
import { hydrateAsset } from './lib/asset_analysis';
import { createProject,readProject,projectIdentity,projectRun } from './lib/project_data';
import { requireEditorAccess } from './lib/billing_access';
import { ConvexError, v, type Infer, type ObjectType } from 'convex/values';
import { vResultValidator, vWorkflowId, type WorkflowId } from '@convex-dev/workflow';
import { internal } from './_generated/api';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { speakerRequestValidator, referenceBox, referenceReadResult, analysisValidator, assetWithUrl, frameInspectionValidator, frameRequestValidator, videoInspectionValidator, videoRequestValidator, mediaTaskKind, mediaTaskStatus, mediaTaskActivity, timelineValidator, waveformValidator, blueprintCheckResultValidator, blueprintLineValidator, blueprintPointValidator } from './schema';
import { validateFrameInspectionResult } from '../lib/media-analysis/frame-inspection';
import { validateVideoInspectionResult } from '../lib/media-analysis/video-inspection';
import { requireOwner, requireProject } from './lib/auth';
import { mediaTaskCredentials, requireMediaTask, requireMediaWorker } from './lib/media_task_auth';
import { mediaWorkflow } from './lib/workflows';
import { hasPreview, mediaUrl, previewUrl, PREVIEW_VERSION } from './lib/media_storage';
import { saveAssetAnalysis, validateWaveform } from './assets';
import { parseVideoLink } from '../lib/editor/video-link';
import { addMediaClip } from '../lib/editor/operations';
import { timelineDuration, type Timeline } from '../lib/editor/types';
import { timelineAtRevision } from './lib/revision_log';
import { commitTimeline, currentTimeline } from './lib/timeline';
import { BEAT_ANALYSIS_ENGINE } from '../lib/media-analysis/beat-map';
import { editingWorkflowActive } from './lib/assistant_workflow';
import { placeCutout } from './cutouts';
import { completeDerivation } from './derivations';
import { flyRendersEnabled, seatedRenders } from './lib/render_seats';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { brandFileUrl, fontUrl } from './brandKits';
import { MEDIA_TASK_LEASE_MS } from '../lib/media-analysis/errors';
import { pacingRequestValidator, pacingResultValidator } from './lib/pacing_validator';
import { soundRequestValidator, soundResultValidator } from './lib/sound_validator';
import { consumeVideoImport, requireMediaTaskCapacity } from './lib/account_limits';import { sceneMediaAssetIds } from '../lib/editor/scene-layers';


const LEASE_MS = MEDIA_TASK_LEASE_MS;
const MAX_ATTEMPTS = 3;
const IMPORT_PLACEMENT_DELAY_MS = 10_000, IMPORT_PLACEMENT_ATTEMPTS = 360;
// Fair claiming: an owner already running this many tasks yields to queued work
// from other owners among the oldest FAIR_CLAIM_SCAN claimable rows.
const FAIR_RUNNING_PER_OWNER = 1, FAIR_CLAIM_SCAN = 64;
const eventResult = v.object({ success: v.boolean(), retryable: v.boolean(), error: v.optional(v.string()) });
const taskState = v.object({ _id: v.id('mediaTasks'), kind: mediaTaskKind, status: mediaTaskStatus, progress: v.number(), attempt: v.number(), error: v.optional(v.string()), assetId: v.optional(v.id('assets')),activity:v.optional(mediaTaskActivity),activityStartedAt:v.optional(v.number()) });
const renderSnapshot = v.object({ timeline: timelineValidator, assets: v.array(assetWithUrl), resolution: v.number(), fps: v.number(), quality: v.string() });
const timelineFrames=v.object({normalization:v.optional(normalizationRequestValidator),comparison:v.optional(v.object({crop:v.optional(referenceBox)})),timeline:timelineValidator,baseline:v.optional(timelineValidator),assets:v.array(assetWithUrl),times:v.array(v.number()),card:v.optional(v.object({title:v.string()})),pacing:v.optional(pacingRequestValidator),motion:v.optional(v.object({start:v.number(),end:v.number()})),sound:v.optional(soundRequestValidator)});
const reviewSnapshot=v.object({timeline:timelineValidator,reference:timelineValidator,plans:v.array(effectPlanValidator),assets:v.array(assetWithUrl),revision:v.number(),start:v.number(),end:v.number()});
// A blueprint check: render scene code at an exact size, read pixels, or diff against a kit screen.
const blueprintWork = v.object({ mode: v.union(v.literal('measure'), v.literal('compare'), v.literal('render')), width: v.number(), height: v.number(), code: v.optional(v.string()), brand: v.any(), screenUrl: v.optional(v.string()), points: v.optional(v.array(blueprintPointValidator)), lines: v.optional(v.array(blueprintLineValidator)) });
// A reading of a source video: a labeled frame sheet (with how much each frame changed), a tracked box, or pixels measured.
const readWork = v.object({ mode: v.union(v.literal('sheet'), v.literal('track'), v.literal('measure'), v.literal('compare'), v.literal('trace'), v.literal('font'), v.literal('sounds'), v.literal('motion')), text: v.optional(v.string()), categories: v.optional(v.array(v.string())), color: v.optional(v.string()), tolerance: v.optional(v.number()), start: v.number(), end: v.number(), times: v.optional(v.array(v.number())), rendered: v.optional(v.array(v.object({ time: v.number(), image: v.string() }))), compareCrop: v.optional(referenceBox), count: v.optional(v.number()), fps: v.optional(v.number()), momentsOnly: v.optional(v.boolean()), crop: v.optional(referenceBox), box: v.optional(referenceBox), points: v.optional(v.array(blueprintPointValidator)), lines: v.optional(v.array(blueprintLineValidator)) });
const workItem = v.object({read:v.optional(readWork),review:v.optional(reviewSnapshot),snapshot:v.optional(timelineFrames),blueprint:v.optional(blueprintWork),cutout:v.optional(v.object({start:v.number(),end:v.number(),fps:v.optional(v.number()),subject:v.optional(v.string())})),derive:v.optional(v.object({op:v.union(v.literal('freeze'),v.literal('slowmo'),v.literal('upscale'),v.literal('stats')),start:v.number(),end:v.number(),time:v.optional(v.number()),times:v.optional(v.array(v.number())),factor:v.optional(v.number()),target:v.optional(v.number())})), ...mediaTaskCredentials, projectId: v.id('projects'), aiRunId:v.optional(v.string()), kind: mediaTaskKind, sourceUrl: v.optional(v.string()), importRange: v.optional(v.object({ start: v.number(), end: v.number() })), speakerRequest:v.optional(speakerRequestValidator), frameRequest: v.optional(frameRequestValidator), videoRequest: v.optional(videoRequestValidator), asset: v.optional(assetWithUrl), transcriptionAsset: v.optional(assetWithUrl), outputAssetId: v.optional(v.id('assets')), outputStored: v.optional(v.boolean()), render: v.optional(renderSnapshot), renderJobId: v.optional(v.id('renderJobs')) });
export type MediaWorkItem = Infer<typeof workItem>;
export const taskResult = v.object({read:v.optional(referenceReadResult),blueprint:v.optional(blueprintCheckResultValidator),colorStats:v.optional(v.array(v.any())),review:v.optional(compositionReviewResult),snapshot:v.optional(v.object({normalization:v.optional(normalizationResultValidator),frames:v.array(v.object({time:v.number(),image:v.string()})),differences:v.optional(v.array(v.number())),pacing:v.optional(pacingResultValidator),motion:v.optional(v.any()),sound:v.optional(soundResultValidator)})), analysis: v.optional(analysisValidator), frameInspection: v.optional(frameInspectionValidator), videoInspection: v.optional(videoInspectionValidator), audioAssetId: v.optional(v.id('assets')), waveform: v.optional(waveformValidator) });
export type MediaTaskResult = Infer<typeof taskResult>;

/** The oldest media processor that can run each kind; older processors leave these tasks queued. */
// 10: scenes are GSAP modules, so every task that renders a composition needs the new scene runtime.
const MIN_PROCESSOR_VERSION: Partial<Record<Doc<'mediaTasks'>['kind'], number>> = { facecam:24, speakers:24, transcribe: 3, frames: 4, preview: 5, cutout: 7, derive: 9, render: 10, review: 10, snapshot: 10, blueprint: 11, reference: 12, read: 13 };
/** Shape tracing (traceShape) came after plain frame reads. */
export const TRACE_PROCESSOR_VERSION = 14;
/** Font matching (matchFont) came after shape tracing. */
export const FONT_PROCESSOR_VERSION = 15;
/** Importing a start to end range of a long link came after font matching. */
const RANGE_IMPORT_PROCESSOR_VERSION = 16;
/** Pacing checks (checkPacing) came after range imports. */
export const PACING_PROCESSOR_VERSION = 17;
/** Listening to a range (getSound, checkSound) came after pacing checks. */
export const SOUND_PROCESSOR_VERSION = 18;
/** Listening to a reference video (listenReference) came after timeline listening. */
export const REFERENCE_SOUND_PROCESSOR_VERSION = 19;
/** The visual guard (a proposed scene change rendered beside the saved timeline) came after reference listening. */
export const GUARD_PROCESSOR_VERSION = 20;
/** Reading how a film moves (motionMap: camera, transitions, elements, content) came after the visual guard. */
export const MOTION_PROCESSOR_VERSION = 23;
/** Frozen comparison crops, displayed rotation and bounded sound capture. */
export const RECREATION_PROCESSOR_VERSION = 23;

export async function enqueueMediaTask(ctx: MutationCtx, input: Pick<Doc<'mediaTasks'>, 'ownerId' | 'projectId' | 'kind'> & Partial<Pick<Doc<'mediaTasks'>, 'assetId' | 'renderJobId' | 'analysisRequestId' | 'sourceUrl' | 'importRange' | 'sourcesOnly' | 'frameRequest' | 'videoRequest' | 'speakerRequest' | 'reviewId' | 'snapshotId' | 'readId' | 'blueprintCheckId' | 'cutoutId' | 'derivationId' | 'requiredProcessorVersion'|'previewVersion'|'lane'>>, beforeEnqueue?:()=>Promise<void>): Promise<Id<'mediaTasks'>> {
  const minimum = MIN_PROCESSOR_VERSION[input.kind];
  if (minimum) input = { ...input, requiredProcessorVersion: Math.max(minimum, input.requiredProcessorVersion ?? 0) };
  if(input.kind==='preview')input={...input,previewVersion:PREVIEW_VERSION};
  if(input.assetId&&input.kind==='preview'){const asset=await ctx.db.get(input.assetId);// A cut-out plays its own VP9 alpha file; an H.264 proxy would drop the transparency.
  if(asset?.ownerId===input.ownerId&&asset.projectId===input.projectId&&(hasPreview(asset)||asset.cutoutOf||asset.derivedOf)){const now=Date.now();return insertMediaTask(ctx,{...input,status:'completed',attempt:0,progress:100,createdAt:now,updatedAt:now});}}
  if (input.assetId && input.kind === 'beats') {
    const asset = await ctx.db.get(input.assetId);
    const beats=asset?(await hydrateAsset(ctx,asset)).analysis?.beats:undefined;
    if (asset?.ownerId === input.ownerId && asset.projectId === input.projectId && beats?.engine === BEAT_ANALYSIS_ENGINE && beats.downbeats !== undefined && beats.accents !== undefined && beats.dropCandidates !== undefined) {
      const now = Date.now();
      const taskId = await insertMediaTask(ctx, { ...input, status: 'completed', attempt: 0, progress: 100, createdAt: now, updatedAt: now });
      if (input.analysisRequestId) await ctx.db.patch(input.analysisRequestId, { status: 'completed', error: undefined });
      return taskId;
    }
  }
  // Each frame read, cut-out and derivation is its own request with its own result row: parallel ones on one asset each get a task.
  if (input.assetId && input.kind !== 'speakers' && input.kind !== 'frames' && input.kind !== 'video' && input.kind !== 'cutout' && input.kind !== 'derive' && input.kind !== 'read') {
    const existing = await ctx.db.query('mediaTasks').withIndex('by_asset_kind', q => q.eq('assetId', input.assetId).eq('kind', input.kind)).order('desc').take(10);
    const active = existing.find(task => (input.kind!=='preview'||task.previewVersion===input.previewVersion)&&['queued','running','retrying'].includes(task.status));
    if (active) { if (input.analysisRequestId) await ctx.db.patch(active._id, { analysisRequestId: input.analysisRequestId }); return active._id; }
  }
  const requested = input.kind === 'video' ? input.videoRequest : input.kind === 'frames' ? input.frameRequest : undefined;
  if(input.assetId&&requested){
    const existing=await ctx.db.query('mediaTasks').withIndex('by_asset_kind',q=>q.eq('assetId',input.assetId).eq('kind',input.kind)).order('desc').take(20);
    const reusable=existing.find(task=>{
      const inspection = input.kind === 'video' ? task.videoRequest : task.frameRequest;
      const evidence = input.kind === 'video' ? task.videoInspection : task.frameInspection;
      // Older frame workers returned prose only, which cannot position a camera.
      if (input.kind === 'frames' && ((task.requiredProcessorVersion ?? 1) < 4 || task.status === 'completed' && !task.frameInspection?.geometry)) return false;
      return task.ownerId===input.ownerId&&task.projectId===input.projectId&&inspection?.question===requested.question&&inspection.start===requested.start&&inspection.end===requested.end&&((task.status==='completed'&&!!evidence)||['queued','running','retrying'].includes(task.status));
    });
    if(reusable){
      if(input.analysisRequestId){
        if(reusable.status==='completed')await ctx.db.patch(input.analysisRequestId,{status:'completed',...(input.kind==='video'?{videoInspection:reusable.videoInspection}:{frameInspection:reusable.frameInspection}),error:undefined});
        else {
          await ctx.db.patch(reusable._id,{analysisRequestId:input.analysisRequestId});
          if(reusable.status==='running')await ctx.db.patch(input.analysisRequestId,{status:'running'});
        }
      }
      return reusable._id;
    }
  }
  // Reused evidence and active tasks need no new provider capacity. Reserve
  // only when a fresh task will actually be inserted, in this transaction.
  await beforeEnqueue?.();
  const now = Date.now();
  const taskId = await insertMediaTask(ctx, { ...input, status: 'queued', claimable:false, attempt: 0, progress: 0, createdAt: now, updatedAt: now });
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
/** How long an Ultra export waits for the 4-vCPU slot before any slot may take it. */
const ULTRA_FALLBACK_MS = 120_000;
export const prepareAttempt = internalMutation({ args: { taskId: v.id('mediaTasks'), attempt: v.number() }, returns: v.boolean(), handler: async (ctx, args) => {
  const task = await ctx.db.get(args.taskId);
  if (!task || ['completed', 'cancelled', 'failed'].includes(task.status)) return false;
  await patchMediaTask(ctx, task, { status: 'queued', claimable:true, attempt: args.attempt, progress:0,activity:undefined,activityStartedAt:undefined,leaseToken: undefined, leaseExpiresAt: undefined, attemptStartedAt: undefined, updatedAt: Date.now() });
  // Wake only after this attempt is claimable, including retries after backoff.
  if (task.kind === 'render' && flyRendersEnabled()) { await ctx.scheduler.runAfter(0, internal.flyRender.dispatch, {}); return true; }
  if (globalThis.process.env.MEDIA_PROCESSOR_WAKE_URL) await ctx.scheduler.runAfter(0, internal.mediaProcessor.wake, {});
  // Each Ultra attempt gets the 4-vCPU slot first, then any slot.
  if (task.lane === 'ultra') await ctx.scheduler.runAfter(ULTRA_FALLBACK_MS, internal.mediaTasks.releaseUltraLane, { taskId: task._id, attempt: args.attempt });
  return true;
}});
/** An Ultra export still waiting after its head start leaves the Ultra lane, so a
 * regular slot takes it if the 4-vCPU container cannot start. Changing the row
 * re-runs every ready subscription; a clock check inside the query would not. */
export const releaseUltraLane = internalMutation({ args: { taskId: v.id('mediaTasks'), attempt: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.lane !== 'ultra' || task.status !== 'queued' || task.attempt !== args.attempt) return null;
  await patchMediaTask(ctx, task, { lane: undefined, updatedAt: Date.now() });
  if (globalThis.process.env.MEDIA_PROCESSOR_WAKE_URL) await ctx.scheduler.runAfter(0, internal.mediaProcessor.wake, {});
  return null;
}});
async function signalResult(ctx: MutationCtx, task: Doc<'mediaTasks'>, value: Infer<typeof eventResult>) {
  if (task.workflowId) await mediaWorkflow.sendEvent(ctx, { workflowId: task.workflowId as WorkflowId, name: `attempt-${task.attempt}`, validator: eventResult, value });
}
/** A finished or failed export frees one of its owner's seats; let a waiting export take it. */
async function releaseRenderSeat(ctx: MutationCtx, task: Doc<'mediaTasks'>) {
  if (task.kind === 'render' && flyRendersEnabled()) await ctx.scheduler.runAfter(0, internal.flyRender.dispatch, {});
}
async function failTask(ctx: MutationCtx, task: Doc<'mediaTasks'>, error: string, retryable: boolean) {
  await patchMediaTask(ctx, task, { status: retryable ? 'retrying' : 'failed', error: error.slice(0, 1000), leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
  await releaseRenderSeat(ctx, task);
  await signalResult(ctx, task, { success: false, retryable, error: error.slice(0, 1000) });
}
async function markTerminal(ctx: MutationCtx, taskId: Id<'mediaTasks'>, status: 'failed' | 'cancelled', error: string) {
  const task = await ctx.db.get(taskId);
  // A workflow cancelled after a permanent failure must not hide its reason.
  if (!task || task.status === 'completed' || task.status === 'cancelled' || (status === 'cancelled' && task.status === 'failed')) return;
  await patchMediaTask(ctx, task, { status, error: error.slice(0, 1000), leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
  await releaseRenderSeat(ctx, task);
  if (task.renderJobId) {
    const job = await ctx.db.get(task.renderJobId);
    if (job && job.status !== 'completed' && job.status !== 'cancelled') await ctx.db.patch(job._id, { status: status==='cancelled'?'cancelled':'failed', error: status==='cancelled'?undefined:error.slice(0, 1000), updatedAt: Date.now() });
  }
  if(task.reviewId){const review=await ctx.db.get(task.reviewId);if(review)await ctx.db.patch(review._id,{status:'failed',error:error.slice(0,1000)});}
  if(task.snapshotId){const thumb=await ctx.db.query('sceneThumbnails').withIndex('by_snapshot',q=>q.eq('snapshotId',task.snapshotId!)).unique();if(thumb&&thumb.status==='queued')await ctx.db.patch(thumb._id,{status:'failed'});const snapshot=await ctx.db.get(task.snapshotId);if(snapshot&&snapshot.status==='queued')await ctx.db.patch(snapshot._id,{status:'failed',error:error.slice(0,1000)});}
  if(task.readId){const read=await ctx.db.get(task.readId);if(read&&read.status==='queued')await ctx.db.patch(read._id,{status:'failed',error:error.slice(0,1000)});}
  if(task.blueprintCheckId){const check=await ctx.db.get(task.blueprintCheckId);if(check&&check.status==='queued')await ctx.db.patch(check._id,{status:'failed',error:error.slice(0,1000)});}
  if(task.cutoutId){const cutout=await ctx.db.get(task.cutoutId);if(cutout&&cutout.status==='queued')await ctx.db.patch(cutout._id,{status:'failed',error:error.slice(0,1000)});}
  if(task.derivationId){const row=await ctx.db.get(task.derivationId);if(row&&row.status==='queued')await ctx.db.patch(row._id,{status:'failed',error:error.slice(0,1000)});}
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
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId || asset.kind === 'image' || args.kind === 'render' || args.kind === 'import' || args.kind === 'review') throw new ConvexError('Choose media from this project.');
  if (args.kind === 'frames') throw new ConvexError('Frame inspection requires a scoped AI question and source window.');
  if (args.kind === 'video') throw new ConvexError('Native video inspection requires a scoped AI question and source window.');
  if (['extract', 'preview', 'shots', 'understand', 'track', 'reference', 'read', 'facecam', 'speakers'].includes(args.kind) && asset.kind !== 'video') throw new ConvexError('This operation requires a video.');
  if(args.kind==='speakers'&&(asset.duration??0)>120)throw new ConvexError('Use followSubject or analyzeMedia with a bounded speaker source window.');
  if (args.kind === 'waveform' && asset.kind !== 'audio') throw new ConvexError('Waveforms require an audio source.');
  // Reused or already-active work needs no new capacity.
  return enqueueMediaTask(ctx, { ...args, ownerId }, () => requireMediaTaskCapacity(ctx, ownerId, 1));
}});
const importVideoForArgs = { sourcesOnly: v.optional(v.boolean()), projectId: v.optional(v.id('projects')), url: v.string(), start: v.optional(v.number()), end: v.optional(v.number()) };
export async function importVideoFor(ctx: MutationCtx, ownerId: string, args: ObjectType<typeof importVideoForArgs>) {
  await requireEditorAccess(ctx, ownerId);
  let sourceUrl: string;
  try { sourceUrl = parseVideoLink(args.url).url; } catch (error) { throw new ConvexError((error as Error).message); }
  let importRange: { start: number; end: number } | undefined;
  if (args.start !== undefined || args.end !== undefined) {
    const start = args.start ?? 0, end = args.end;
    if (end === undefined) throw new ConvexError('Give both start and end to import part of a video.');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new ConvexError('The import range needs 0 <= start < end, in source seconds.');
    importRange = { start, end };
  }
  // A new edit and its durable import are created atomically.
  const now = Date.now();
  const projectId = args.projectId ?? await createProject(ctx, { ownerId, title: 'Video import', aspectRatio: 'vertical', timeline: { fps: 60, aspectRatio: 'vertical', clips: [], tracks: { visual: 1, overlay: 0, audio: 1 } }, revision: 0, history: [], createdAt: now, updatedAt: now });
  await requireProject(ctx, projectId, ownerId);
  await initializeMediaCapacity(ctx, ownerId);
  const existing = await ctx.db.query('mediaTaskSlots').withIndex('by_import', q => q.eq('projectId', projectId).eq('kind', 'import').eq('sourceUrl', sourceUrl).eq('importRange.start', importRange?.start).eq('importRange.end', importRange?.end)).collect();
  const matching = existing.find(task => !!task.sourcesOnly === !!args.sourcesOnly);
  if (matching) return { projectId, taskId: matching.taskId };
  const pending = await ctx.db.query('mediaTaskSlots').withIndex('by_project_kind', q => q.eq('projectId', projectId).eq('kind', 'import')).take(3);
  if (pending.length >= 3) throw new ConvexError('Wait for the current video imports to finish.');
  // Counted only once a fresh import is accepted; a refusal rolls back a new edit with it.
  await consumeVideoImport(ctx, ownerId, !args.projectId); await requireMediaTaskCapacity(ctx, ownerId, 1);
  const taskId = await enqueueMediaTask(ctx, { ownerId, projectId, kind: 'import', sourceUrl, ...(args.sourcesOnly ? { sourcesOnly: true } : {}), ...(importRange ? { importRange, requiredProcessorVersion: RANGE_IMPORT_PROCESSOR_VERSION } : {}) });
  return { projectId, taskId };
}
export const importVideo = mutation({ args: importVideoForArgs, returns: v.object({ projectId: v.id('projects'), taskId: v.id('mediaTasks') }), handler: async (ctx, args) => importVideoFor(ctx, await requireOwner(ctx), args) });
export const get = query({ args: { taskId: v.id('mediaTasks') }, returns: taskState, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  const view = await ctx.db.query('mediaTaskViews').withIndex('by_task', q => q.eq('taskId', args.taskId)).unique();
  const task = view ?? await ctx.db.get(args.taskId);
  if (!task || task.ownerId !== ownerId) throw new ConvexError('Media task not found.');
  await projectIdentity(ctx, task.projectId, ownerId);
  const { kind, status, progress, attempt, error, assetId,activity,activityStartedAt } = task;
  return { _id: args.taskId, kind, status, progress, attempt, error, assetId,activity,activityStartedAt };
}});
export const list = query({ args: { projectId: v.id('projects') }, returns: v.array(taskState), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await projectIdentity(ctx,args.projectId,ownerId);
  const migration = await ctx.db.query('projectDataMigration').withIndex('by_key', q => q.eq('key', 'io-tasks-v1')).unique();
  if (!migration?.completed) {
    const tasks = await ctx.db.query('mediaTasks').withIndex('by_project_createdAt', q => q.eq('projectId', args.projectId)).order('desc').take(40);
    return tasks.map(({ _id, kind, status, progress, attempt, error, assetId, activity, activityStartedAt }) => ({ _id, kind, status, progress, attempt, error, assetId, activity, activityStartedAt }));
  }
  const tasks = await ctx.db.query('mediaTaskViews').withIndex('by_project_createdAt', q => q.eq('projectId', args.projectId)).order('desc').take(40);
  return tasks.map(({ taskId: _id, kind, status, progress, attempt, error, assetId,activity,activityStartedAt }) => ({ _id, kind, status, progress, attempt, error, assetId,activity,activityStartedAt }));
}});
/** Fails an unfinished task permanently and stops its workflow. */
export async function failMediaTask(ctx: MutationCtx, taskId: Id<'mediaTasks'>, error: string) {
  const task = await ctx.db.get(taskId);
  if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return;
  await markTerminal(ctx, taskId, 'failed', error);
  if (task.workflowId) await mediaWorkflow.cancel(ctx, task.workflowId as WorkflowId);
}
export async function cancelMediaTask(ctx: MutationCtx, taskId: Id<'mediaTasks'>) {
  const task = await ctx.db.get(taskId);
  if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return;
  await markTerminal(ctx, taskId, 'cancelled', 'Processing cancelled.');
  if (task.workflowId) await mediaWorkflow.cancel(ctx, task.workflowId as WorkflowId);
}
/** A bounded action wait ending must not discard already-running analysis. Stop
 * cancels its tasks separately before deleting their requests. */
export async function detachAnalysisRequest(ctx:MutationCtx,request:Doc<'analysisRequests'>){
  const task=request.taskId?await ctx.db.get(request.taskId):null;
  if(task?.analysisRequestId===request._id&&task.ownerId===request.ownerId&&task.projectId===request.projectId&&task.assetId===request.assetId&&['queued','running','retrying'].includes(task.status))await patchMediaTask(ctx, task,{analysisRequestId:undefined});
  await ctx.db.delete(request._id);
}
/** Oldest first, except an owner already running FAIR_RUNNING_PER_OWNER tasks
 * yields to another owner's queued work. Bounded: one scan plus one small
 * indexed read per distinct owner; with no other owner waiting, the oldest
 * task is claimed so a lone account still uses every free slot. */
async function fairest(ctx:MutationCtx|QueryCtx,candidates:Doc<'mediaTasks'>[]) {
  if(new Set(candidates.map(task=>task.ownerId)).size<2)return candidates[0]??null;
  const busy=new Map<string,boolean>();
  for(const task of candidates){
    if(!busy.has(task.ownerId))busy.set(task.ownerId,(await ctx.db.query('mediaTasks').withIndex('by_owner_status',q=>q.eq('ownerId',task.ownerId).eq('status','running')).take(FAIR_RUNNING_PER_OWNER)).length>=FAIR_RUNNING_PER_OWNER);
    if(!busy.get(task.ownerId))return task;
  }
  return candidates[0];
}
async function firstClaimable(ctx:MutationCtx|QueryCtx,processorVersion=1,lane?:'ultra'|'any',rendersOnly=false) {
  const versioned=(q:import('convex/server').FilterBuilder<import('convex/server').GenericTableInfo>)=>q.or(q.eq(q.field('requiredProcessorVersion'),undefined),q.lte(q.field('requiredProcessorVersion'),processorVersion));
  // Fly export machines take only their lane's exports, within each owner's seats.
  if(rendersOnly)return (await seatedRenders(ctx,lane==='ultra'?'ultra':undefined,versioned))[0]??null;
  // With Fly exports, the regular processors leave every export to Fly.
  const fly=flyRendersEnabled();
  // The Ultra slot only runs Ultra exports; regular slots leave them to it unless they wait too long.
  if(lane==='ultra')return fly?null:fairest(ctx,await ctx.db.query('mediaTasks').withIndex('by_status_claimable_kind_created',q=>q.eq('status','queued').eq('claimable',true).eq('kind','render')).filter(q=>q.and(q.eq(q.field('lane'),'ultra'),versioned(q))).take(FAIR_CLAIM_SCAN));
  // Regular slots leave Ultra exports to the Ultra slot until releaseUltraLane
  // clears the lane. A local development worker has no Ultra slot and runs every lane.
  const laneOk=(q:import('convex/server').FilterBuilder<import('convex/server').GenericTableInfo>)=>{const base=lane==='any'?versioned(q):q.and(versioned(q),q.eq(q.field('lane'),undefined));return fly?q.and(base,q.neq(q.field('kind'),'render')):base;};
  // Frame readings, timeline frames and blueprint checks take seconds and an agent waits on each: they go before
  // exports and long analysis, so a turn never stalls behind a minutes-long job.
  for(const kind of ['read','snapshot','blueprint'] as const){
    let rows=await ctx.db.query('mediaTasks').withIndex('by_status_claimable_kind_created',q=>q.eq('status','queued').eq('claimable',true).eq('kind',kind)).filter(laneOk).take(FAIR_CLAIM_SCAN);
    // A frame check an agent waits on goes before scene thumbnails and share covers, which nobody is waiting for.
    if(kind==='snapshot'){const asked=[];for(const row of rows){const snapshot=row.snapshotId?await ctx.db.get(row.snapshotId):null;if(snapshot&&!snapshot.clipId&&!snapshot.shareId)asked.push(row);}if(asked.length)rows=asked;}
    const quick=await fairest(ctx,rows);if(quick)return quick;
  }
  // Exports are interactive; claim them before long queued analysis work.
  const renders=fly?[]:await ctx.db.query('mediaTasks').withIndex('by_status_claimable_kind_created',q=>q.eq('status','queued').eq('claimable',true).eq('kind','render')).filter(laneOk).take(FAIR_CLAIM_SCAN);
  if(renders.length)return fairest(ctx,renders);
  const indexed=await fairest(ctx,await ctx.db.query('mediaTasks').withIndex('by_status_claimable_created',q=>q.eq('status','queued').eq('claimable',true)).filter(laneOk).take(FAIR_CLAIM_SCAN));
  // Legacy prepared tasks remain claimable during rollout, without a ten-row cap.
  return indexed??await ctx.db.query('mediaTasks').withIndex('by_status_createdAt',q=>q.eq('status','queued')).filter(q=>q.and(q.eq(q.field('claimable'),undefined),q.gt(q.field('attempt'),0),q.neq(q.field('workflowId'),undefined),...(fly?[q.neq(q.field('kind'),'render')]:[]),q.or(q.eq(q.field('requiredProcessorVersion'),undefined),q.lte(q.field('requiredProcessorVersion'),processorVersion)))).first();
}
export const cancel=mutation({args:{taskId:v.id('mediaTasks')},returns:v.null(),handler:async(ctx,args)=>{
  const task=await ctx.db.get(args.taskId);if(!task||task.ownerId!==await requireOwner(ctx))throw new ConvexError('Media task not found.');
  await cancelMediaTask(ctx,task._id);return null;
}});
export const pruneFinished=internalMutation({args:{},returns:v.null(),handler:async ctx=>{
  const cutoff=Date.now()-7*86400_000;
  for(const status of ['completed','failed','cancelled'] as const){
    const rows=await ctx.db.query('mediaTasks').withIndex('by_status_updated',q=>q.eq('status',status).lt('updatedAt',cutoff)).take(100);
    for(const task of rows){if(task.workflowId)await mediaWorkflow.cleanup(ctx,task.workflowId as WorkflowId);await deleteMediaTask(ctx, task._id);}
    if(rows.length===100)await ctx.scheduler.runAfter(0,internal.mediaTasks.pruneFinished,{});
  }
  return null;
}});
export const processorContract = query({ args: { workerSecret: v.string() }, returns: v.object({ processorVersion: v.number() }), handler: (_ctx, args) => {
  requireMediaWorker(args.workerSecret);
  return { processorVersion: MEDIA_PROCESSOR_VERSION };
} });

export const ready = query({ args: { workerSecret: v.string(),processorVersion:v.optional(v.number()),lane:v.optional(v.union(v.literal('ultra'),v.literal('any'))),rendersOnly:v.optional(v.boolean()) }, returns: v.string(), handler: async (ctx, args) => {
  const role=requireMediaWorker(args.workerSecret);
  const task=await firstClaimable(ctx,args.processorVersion,args.lane,args.rendersOnly||role==='exports');return task?`${task._id}:${task.attempt}`:'';
}});

async function analysisStillActive(ctx:import('./_generated/server').QueryCtx|MutationCtx,task:Doc<'mediaTasks'>) {
  if(task.cutoutId){const cutout=await ctx.db.get(task.cutoutId);return !!cutout&&cutout.ownerId===task.ownerId&&cutout.projectId===task.projectId&&cutout.status==='queued';}
  if(task.derivationId){const row=await ctx.db.get(task.derivationId);return !!row&&row.ownerId===task.ownerId&&row.projectId===task.projectId&&row.status==='queued';}
  if(task.readId){const read=await ctx.db.get(task.readId);return !!read&&read.ownerId===task.ownerId&&read.projectId===task.projectId&&read.status==='queued'&&read.createdAt+300000>Date.now();}
  if(task.snapshotId){const snapshot=await ctx.db.get(task.snapshotId);return !!snapshot&&snapshot.ownerId===task.ownerId&&snapshot.projectId===task.projectId&&snapshot.status==='queued'&&snapshot.createdAt+(snapshot.pacing||snapshot.sound||snapshot.guard?600000:300000)>Date.now();}
  if(task.blueprintCheckId){const check=await ctx.db.get(task.blueprintCheckId);return !!check&&check.ownerId===task.ownerId&&check.projectId===task.projectId&&check.status==='queued'&&check.createdAt+180000>Date.now();}
  if(task.reviewId){const review=await ctx.db.get(task.reviewId);if(!review||review.ownerId!==task.ownerId||review.projectId!==task.projectId||review.status!=='queued'||review.createdAt+180000<=Date.now())return false;const run=await projectRun(ctx,task.projectId,task.ownerId);return !!run.aiRunning&&run.aiRunId===review.runId;}
  if(!task.analysisRequestId)return true;
  const request=await ctx.db.get(task.analysisRequestId);
  if(!request||request.ownerId!==task.ownerId||request.projectId!==task.projectId||request.assetId!==task.assetId||request.expiresAt<=Date.now()||!['pending','running'].includes(request.status))return false;
  const run=await projectRun(ctx,task.projectId,task.ownerId);
  return !!run.aiRunning&&run.aiRunId===request.aiRunId;
}
async function loadWork(ctx:import('./_generated/server').QueryCtx|MutationCtx,task:Doc<'mediaTasks'>):Promise<MediaWorkItem> {
  const asset=task.assetId?await ctx.db.get(task.assetId):null;
  if(task.assetId&&(!asset||asset.ownerId!==task.ownerId||asset.projectId!==task.projectId))throw new ConvexError('The source media was removed.');
  const audio=task.kind==='transcribe'&&asset?.kind==='video'&&asset.audioAssetId?await ctx.db.get(asset.audioAssetId):null;
  if(audio&&(audio.kind!=='audio'||audio.ownerId!==task.ownerId||audio.projectId!==task.projectId))throw new ConvexError('The prepared audio does not belong to this source project.');
  const transcriptionAsset=audio?{...audio,url:await mediaUrl(ctx,audio)}:undefined;
  let review:Infer<typeof reviewSnapshot>|undefined;
  if(task.reviewId){
    const saved=await ctx.db.get(task.reviewId);if(!saved||saved.ownerId!==task.ownerId||saved.projectId!==task.projectId)throw new ConvexError('Composition review is unavailable.');
    const assets=await Promise.all(saved.assetIds.map(async id=>{const asset=await ctx.db.get(id);if(!asset||asset.ownerId!==task.ownerId||asset.projectId!==task.projectId)throw new ConvexError('Review source is unavailable.');return {...asset,url:await mediaUrl(ctx,asset)};}));
    review={timeline:saved.timeline,reference:saved.reference,plans:saved.plans,assets,revision:saved.revision,start:saved.start,end:saved.end};
  }
  let snapshot:Infer<typeof timelineFrames>|undefined;
  if(task.snapshotId){
    const saved=await ctx.db.get(task.snapshotId);if(!saved||saved.ownerId!==task.ownerId||saved.projectId!==task.projectId)throw new ConvexError('The frame request is unavailable.');
    const project=await requireProject(ctx,task.projectId,task.ownerId,false);let timeline=currentTimeline(project);
    // Frames of a tab that is not open come from its stored timeline.
    if(!saved.sourceTimeline&&saved.timelineId&&saved.timelineId!==activeTabOf(project)){const stored=await storedTabTimeline(ctx,project,saved.timelineId);if(!stored)throw new ConvexError('That timeline no longer exists.');timeline=stored;}
    if(saved.sourceTimeline)timeline=await loadSceneCode(ctx,saved.sourceTimeline);
    // A turn's staged draft, when the frames were asked for while its changes wait to be saved.
    // An earlier revision of the tab, rebuilt from the revision log (getFrames revision).
    if(!saved.sourceTimeline&&saved.atRevision!==undefined){const past=await timelineAtRevision(ctx,project._id,saved.timelineId??activeTabOf(project),await loadSceneCode(ctx,timeline),saved.atRevision);if(!past)throw new ConvexError('That revision can no longer be rebuilt.');timeline=past;}
    if(!saved.sourceTimeline&&saved.runId){const draft=await ctx.db.query('aiTimelinePreviews').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();if(!draft||draft.runId!==saved.runId)throw new ConvexError('The draft these frames were for is no longer pending.');timeline=await loadSceneCode(ctx,draft.timeline);}
    // A share card: the published timeline, as people who open the link will see it.
    let card:{title:string}|undefined;
    if(saved.shareId){const share=await ctx.db.get(saved.shareId);if(!share?.published)throw new ConvexError('The share is no longer published.');timeline=share.timeline;card={title:share.cardTitle??share.title};}
    // A scene clip's own filmstrip: that clip alone, from its first frame.
    // The visual guard: a proposed change beside the timeline it would replace.
    let baseline:Timeline|undefined;
    if(saved.guard){timeline=await loadSceneCode(ctx,saved.guard.candidate);baseline=await loadSceneCode(ctx,saved.guard.baseline);}
    if(saved.clipId){const clip=timeline.clips.find(item=>item.id===saved.clipId);if(!clip)throw new ConvexError('The clip for these frames is gone.');timeline={...timeline,clips:[{...clip,start:0}],markers:[]};}
    const ids=[...new Set([...timeline.clips,...baseline?.clips??[]].flatMap(clip=>[...clip.assetId?[clip.assetId]:[],...clip.normalizedAudio?[clip.normalizedAudio.assetId]:[]]).concat(sceneMediaAssetIds(timeline),baseline?sceneMediaAssetIds(baseline):[],timeline.audioNormalization?[timeline.audioNormalization.assetId]:[],baseline?.audioNormalization?[baseline.audioNormalization.assetId]:[]))];
    const assets=await Promise.all(ids.map(async raw=>{const id=ctx.db.normalizeId('assets',raw),asset=id?await ctx.db.get(id):null;if(!asset||asset.ownerId!==task.ownerId||asset.projectId!==task.projectId)throw new ConvexError('Frame source media is unavailable.');return {...asset,url:await mediaUrl(ctx,asset)};}));
    snapshot={timeline,...(saved.normalization?{normalization:saved.normalization}:{}),...(saved.comparison?{comparison:saved.comparison}:{}),...(baseline?{baseline}:{}),assets,times:saved.times,...(card?{card}:{}),...(saved.pacing?{pacing:saved.pacing}:{}),...(saved.motion?{motion:saved.motion}:{}),...(saved.sound?{sound:saved.sound}:{})};
  }
  let blueprint:Infer<typeof blueprintWork>|undefined;
  if(task.blueprintCheckId){
    const check=await ctx.db.get(task.blueprintCheckId),kit=check&&await ctx.db.get(check.kitId);
    if(!check||!kit||check.ownerId!==task.ownerId||kit.ownerId!==task.ownerId)throw new ConvexError('The blueprint check is unavailable.');
    const screens=(kit.screens??[]).map(screen=>({name:screen.name,url:brandFileUrl(screen.storageId)}));
    // The same brand snapshot a scene gets: fonts, colors, logo and the kit's screens as media.
    const brand={kitId:kit._id,name:kit.name,colors:kit.colors,fonts:kit.fonts.map(font=>({family:font.family,weight:font.weight,role:font.role,url:fontUrl(font.storageId)})),...(kit.logo?{logo:kit.logo}:{}),...(screens.length?{screens}:{})};
    const screenUrl=check.screen?screens.find(screen=>screen.name===check.screen)?.url:undefined;
    blueprint={mode:check.mode,width:check.width,height:check.height,brand,...(check.code?{code:check.code}:{}),...(screenUrl?{screenUrl}:{}),...(check.points?{points:check.points}:{}),...(check.lines?{lines:check.lines}:{})};
  }
  const readRow=task.readId?await ctx.db.get(task.readId):null;
  if(task.readId&&(!readRow||readRow.ownerId!==task.ownerId||readRow.projectId!==task.projectId))throw new ConvexError('The frame reading is unavailable.');
  // A comparison carries the timeline frames rendered for it, to set beside the reference's.
  const rendered=readRow?.snapshotId?(await ctx.db.get(readRow.snapshotId))?.frames:undefined;
  const read=readRow?{mode:readRow.mode,start:readRow.start,end:readRow.end,...(readRow.times?{times:readRow.times}:{}),...(rendered?{rendered}:{}),...(readRow.compareCrop?{compareCrop:readRow.compareCrop}:{}),...(readRow.count?{count:readRow.count}:{}),...(readRow.fps?{fps:readRow.fps}:{}),...(readRow.momentsOnly?{momentsOnly:true}:{}),...(readRow.crop?{crop:readRow.crop}:{}),...(readRow.box?{box:readRow.box}:{}),...(readRow.points?{points:readRow.points}:{}),...(readRow.lines?{lines:readRow.lines}:{}),...(readRow.color?{color:readRow.color}:{}),...(readRow.tolerance?{tolerance:readRow.tolerance}:{}),...(readRow.text?{text:readRow.text}:{}),...(readRow.categories?{categories:readRow.categories}:{})}:undefined;
  const cutoutRow=task.cutoutId?await ctx.db.get(task.cutoutId):null;
  if(task.cutoutId&&(!cutoutRow||cutoutRow.ownerId!==task.ownerId||cutoutRow.projectId!==task.projectId))throw new ConvexError('The background removal request is unavailable.');
  const deriveRow=task.derivationId?await ctx.db.get(task.derivationId):null;
  if(task.derivationId&&(!deriveRow||deriveRow.ownerId!==task.ownerId||deriveRow.projectId!==task.projectId))throw new ConvexError('The processing request is unavailable.');
  let render: Infer<typeof renderSnapshot> | undefined, outputStored = false;
  if (task.renderJobId) {
    const job = await ctx.db.get(task.renderJobId);
    const snapshot = job ? await loadRenderSnapshot(ctx, job) : undefined;
    if (!job || !snapshot || job.ownerId !== task.ownerId || job.projectId !== task.projectId) { throw new ConvexError('The export snapshot is unavailable.'); }
    outputStored = !!job.outputR2Key;
    const assets = await Promise.all((job.assetIds ?? []).map(async id => {
      const item = await ctx.db.get(id);
      return item && item.ownerId === task.ownerId && item.projectId === task.projectId ? { ...item, url: await mediaUrl(ctx, item) } : null;
    }));
    if (assets.some(item => !item?.url)) { throw new ConvexError('Export source media is unavailable.'); }
    render = { timeline: snapshot, assets: assets as Infer<typeof assetWithUrl>[], resolution: job.resolution ?? 1080, fps: job.fps ?? snapshot.fps, quality: job.quality ?? 'high' };
  }
  const analysisRun=task.analysisRequestId?await ctx.db.get(task.analysisRequestId):null;
  return { ...(analysisRun?{aiRunId:analysisRun.aiRunId}:{}),...(read?{read}:{}),...(review?{review}:{}),...(snapshot?{snapshot}:{}),...(blueprint?{blueprint}:{}),...(cutoutRow?{cutout:{start:cutoutRow.start,end:cutoutRow.end,...(cutoutRow.fps?{fps:cutoutRow.fps}:{}),...(cutoutRow.subject?{subject:cutoutRow.subject}:{})}}:{}),...(deriveRow?{derive:{op:deriveRow.op,start:deriveRow.start,end:deriveRow.end,...(deriveRow.time!==undefined?{time:deriveRow.time}:{}),...(deriveRow.times?{times:deriveRow.times}:{}),...(deriveRow.factor?{factor:deriveRow.factor}:{}),...(deriveRow.target?{target:deriveRow.target}:{})}}:{}),taskId: task._id, leaseToken: task.leaseToken!, projectId: task.projectId, kind: task.kind, ...(task.sourceUrl ? { sourceUrl: task.sourceUrl } : {}), ...(task.importRange ? { importRange: task.importRange } : {}), ...(task.speakerRequest?{speakerRequest:task.speakerRequest}:{}), ...(task.frameRequest ? { frameRequest: task.frameRequest } : {}), ...(task.videoRequest ? { videoRequest: task.videoRequest } : {}), ...(asset ? { asset: { ...await hydrateAsset(ctx,asset), url: await mediaUrl(ctx, asset), ...await previewUrl(ctx, asset) } } : {}), ...(transcriptionAsset?{transcriptionAsset}:{}), ...(render ? { render, outputStored } : {}), ...(task.renderJobId ? { renderJobId: task.renderJobId } : {}), ...(task.outputAssetId ? { outputAssetId: task.outputAssetId } : {}) };
}
export const claim = mutation({ args: { workerSecret: v.string(),compact:v.optional(v.boolean()),processorVersion:v.optional(v.number()),lane:v.optional(v.union(v.literal('ultra'),v.literal('any'))),rendersOnly:v.optional(v.boolean()) }, returns: v.union(workItem, v.null()), handler: async (ctx, args): Promise<MediaWorkItem | null> => {
  const role=requireMediaWorker(args.workerSecret);
  const task=await firstClaimable(ctx,args.processorVersion,args.lane,args.rendersOnly||role==='exports');if(!task)return null;
  try {await projectIdentity(ctx,task.projectId,task.ownerId);}catch{await failTask(ctx,task,'The project was removed.',false);return null;}
  if(!await analysisStillActive(ctx,task)){await markTerminal(ctx,task._id,'cancelled','The AI analysis request is no longer active.');await signalResult(ctx,task,{success:false,retryable:false,error:'The AI run stopped.'});return null;}
  const leaseToken=crypto.randomUUID(),now=Date.now();
  await patchMediaTask(ctx, task,{status:'running',claimable:false,leaseToken,leaseExpiresAt:now+LEASE_MS,attemptStartedAt:now,updatedAt:now});
  if(task.analysisRequestId)await ctx.db.patch(task.analysisRequestId,{status:'running'});
  if(task.renderJobId){const job=await ctx.db.get(task.renderJobId);if(job)await ctx.db.patch(job._id,{status:'rendering',error:undefined,updatedAt:now});}
  await ctx.scheduler.runAfter(LEASE_MS,internal.mediaTasks.expire,{taskId:task._id,leaseToken});
  if(args.compact)return {taskId:task._id,leaseToken,projectId:task.projectId,kind:task.kind};
  // Older consumers keep working while the new image rolls out.
  try{return await loadWork(ctx,{...task,leaseToken});}catch{await failTask(ctx,task,'Source media or the export snapshot is unavailable.',false);return null;}
}});
export const work=query({args:mediaTaskCredentials,returns:workItem,handler:async(ctx,args)=>{
  const task=await requireMediaTask(ctx,args.taskId,args.leaseToken);
  if(!await analysisStillActive(ctx,task))throw new ConvexError('The AI analysis request is no longer active.');
  return loadWork(ctx,task);
}});
/** Workers poll this between heartbeats so Stop and cancellation end work within seconds. */
export const leaseActive = query({ args: mediaTaskCredentials, returns: v.boolean(), handler: async (ctx, args) => {
  const task = await ctx.db.get(args.taskId);
  return !!task && task.status === 'running' && task.leaseToken === args.leaseToken;
}});
export const heartbeat = mutation({ args: { ...mediaTaskCredentials, progress: v.optional(v.number()),activity:v.optional(mediaTaskActivity) }, returns: v.null(), handler: async (ctx, args) => {
  const task = await requireMediaTask(ctx, args.taskId, args.leaseToken);
  if (args.progress !== undefined && (!Number.isFinite(args.progress) || args.progress < 0 || args.progress > 99)) throw new ConvexError('Invalid processing progress.');
  const progress = Math.max(task.progress, args.progress ?? task.progress);
  const now=Date.now();
  await patchMediaTask(ctx, task, { leaseExpiresAt: now + LEASE_MS, progress, updatedAt: now,...(args.activity&&args.activity!==task.activity?{activity:args.activity,activityStartedAt:now}:{}) });
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
async function placeImportedVideo(ctx: MutationCtx, project: Doc<'projects'>, taskId: Id<'mediaTasks'>, output: Doc<'assets'> & { duration: number }) {
  const timeline = currentTimeline(project), clipId = `import-${taskId}`;
  if (timeline.clips.some(clip => clip.id === clipId)) return;
  const next = addMediaClip(timeline, output, clipId, timelineDuration(timeline));
  await commitTimeline(ctx, project, next, project.revision ?? 0);
}
export const placeImport = internalMutation({ args: { taskId: v.id('mediaTasks'), attempt: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const task = await ctx.db.get(args.taskId);
  const output = task?.status === 'completed' && task.outputAssetId ? await ctx.db.get(task.outputAssetId) : null;
  if (!task || task.sourcesOnly || !output?.duration || output.ownerId !== task.ownerId || output.projectId !== task.projectId) return null;
  const project = await readProject(ctx, task.projectId);
  if (!project || project.deleting || project.ownerId !== task.ownerId) return null;
  if (await editingWorkflowActive(ctx, project)) {
    // After an hour the video simply stays in Sources.
    if (args.attempt < IMPORT_PLACEMENT_ATTEMPTS) await ctx.scheduler.runAfter(IMPORT_PLACEMENT_DELAY_MS, internal.mediaTasks.placeImport, { taskId: task._id, attempt: args.attempt + 1 });
    return null;
  }
  // The run may already have placed the waiting import from Sources, or changed
  // the frame rate so the video is now shorter than one frame.
  const timeline = currentTimeline(project);
  if (output.kind !== 'video' || output.duration < 1 / timeline.fps || timeline.clips.some(clip => clip.assetId === output._id)) return null;
  await placeImportedVideo(ctx, project, task._id, { ...output, duration: output.duration });
  return null;
}});
type TaskResult = Infer<typeof taskResult>;
type ResultHandler = (ctx: MutationCtx, task: Doc<'mediaTasks'>, result: TaskResult) => Promise<void>;

/** The task's source must still belong to its project. */
async function ownedSource(ctx: MutationCtx, task: Doc<'mediaTasks'>) {
  const asset = task.assetId ? await ctx.db.get(task.assetId) : null;
  if (!asset || asset.ownerId !== task.ownerId || asset.projectId !== task.projectId) throw new ConvexError('Source media was removed.');
  return asset;
}

/** Saved analysis (transcript, scenes, shots, beats, tracking) lands on the source asset. */
const saveAnalysisResult: ResultHandler = async (ctx, task, result) => {
  const asset = await ownedSource(ctx, task);
  const key = task.kind === 'transcribe' ? 'transcript' : task.kind === 'understand' ? 'understanding' : task.kind === 'track' ? 'focus' : task.kind;
  if (!result.analysis?.[key as keyof typeof result.analysis]) throw new ConvexError('The requested analysis result is missing.');
  if (task.kind === 'transcribe' && (task.requiredProcessorVersion ?? 1) >= 3 && !result.analysis.audioActivity) throw new ConvexError('The requested audio activity measurements are missing.');
  if (task.kind === 'beats' && result.analysis.beats?.engine !== BEAT_ANALYSIS_ENGINE) throw new ConvexError('The requested result must use dedicated beat tracking. Analyze this source again with the updated media worker.');
  await saveAssetAnalysis(ctx, asset, result.analysis);
  if(task.kind==='speakers'&&task.analysisRequestId&&await ctx.db.get(task.analysisRequestId))await ctx.db.patch(task.analysisRequestId,{speakerInspection:result.analysis.speakers});
};

/** What finishing each kind of task means. Record keeps this exhaustive: a new kind needs a handler. */
const RESULT_HANDLERS: Record<Doc<'mediaTasks'>['kind'], ResultHandler> = {
  review: async (ctx, task, result) => {
    if (!result.review) throw new ConvexError('Review completed without rendered evidence.');
    if (!task.reviewId || !await analysisStillActive(ctx, task)) throw new ConvexError('The composition review is no longer active.');
    const review = (await ctx.db.get(task.reviewId))!, evidence = result.review, ids = new Set(review.plans.map(plan => plan.id));
    if (evidence.revision !== review.revision || evidence.sampleTimes.length < 1 || evidence.sampleTimes.length > 12 || evidence.sampleTimes.some(time => !Number.isFinite(time) || time < review.start - 1 / review.timeline.fps || time > review.end) || evidence.checks.length !== ids.size || evidence.observations.length !== ids.size || new Set(evidence.checks.map(check => check.planId)).size !== ids.size || new Set(evidence.observations.map(check => check.planId)).size !== ids.size || evidence.checks.some(check => !ids.has(check.planId) || !Number.isFinite(check.peakPixelChange) || check.peakPixelChange < 0 || check.peakPixelChange > 1) || evidence.observations.some(check => !ids.has(check.planId) || check.evidence.length > 2000) || evidence.uncertainty.length > 2000) throw new ConvexError('Review evidence does not match this rendered snapshot.');
    await ctx.db.patch(review._id, { status: 'completed', result: evidence });
  },
  blueprint: async (ctx, task, result) => {
    if (!result.blueprint) throw new ConvexError('The blueprint check completed without a result.');
    if (!task.blueprintCheckId || !await analysisStillActive(ctx, task)) throw new ConvexError('The blueprint check is no longer active.');
    const images = [result.blueprint.image, result.blueprint.diff].filter(Boolean) as string[];
    if (images.some(image => !/^[A-Za-z0-9+/]+=*$/.test(image)) || images.reduce((sum, image) => sum + image.length, 0) > 800_000) throw new ConvexError('The blueprint images are too large to return.');
    await ctx.db.patch(task.blueprintCheckId, { status: 'completed', result: result.blueprint });
  },
  read: async (ctx, task, result) => {
    if (!result.read) throw new ConvexError('The frame reading completed without a result.');
    if (!task.readId || !await analysisStillActive(ctx, task)) throw new ConvexError('The frame reading is no longer active.');
    const images = [result.read.image, ...(result.read.extraImages ?? [])].filter((image): image is string => !!image);
    if (images.some(image => !/^[A-Za-z0-9+/]+=*$/.test(image)) || images.reduce((sum, image) => sum + image.length, 0) > 900_000) throw new ConvexError('The frame sheet is too large to return.');
    await ctx.db.patch(task.readId, { status: 'completed', result: result.read });
  },
  snapshot: async (ctx, task, result) => {
    if (!result.snapshot) throw new ConvexError('Frame capture completed without images.');
    if (!task.snapshotId || !await analysisStillActive(ctx, task)) throw new ConvexError('The frame request is no longer active.');
    const snapshot = (await ctx.db.get(task.snapshotId))!, frames = result.snapshot.frames;
    if(snapshot.normalization){
      const normalized=result.snapshot.normalization,output=task.outputAssetId?await ctx.db.get(task.outputAssetId):null;
      if(!normalized||!output||output._id!==normalized.assetId||output.kind!=='audio'||output.ownerId!==task.ownerId||output.projectId!==task.projectId||!Number.isFinite(normalized.outputLufs)||Math.abs(normalized.outputLufs-snapshot.normalization.targetLufs)>.7||!Number.isFinite(normalized.truePeak)||normalized.truePeak>snapshot.normalization.truePeak)throw new ConvexError('Normalized audio failed its loudness or true-peak check.');
      await ctx.db.patch(snapshot._id,{status:'completed',normalizationResult:normalized});return;
    }
    if (snapshot.sound) { if (!result.snapshot.sound) throw new ConvexError('The sound check completed without measurements.'); await ctx.db.patch(snapshot._id, { status: 'completed', soundResult: result.snapshot.sound }); return; }
    if (snapshot.motion) { if (!result.snapshot.motion) throw new ConvexError('The motion map completed without a reading.'); await ctx.db.patch(snapshot._id, { status: 'completed', motionResult: result.snapshot.motion }); return; }
    if (snapshot.pacing) { if (!result.snapshot.pacing) throw new ConvexError('The pacing check completed without measurements.'); await ctx.db.patch(snapshot._id, { status: 'completed', pacingResult: result.snapshot.pacing }); return; }
    if (snapshot.guard) {
      const differences = result.snapshot.differences;
      if (!differences || differences.length !== snapshot.times.length || differences.some(value => !Number.isFinite(value) || value < 0 || value > 1) || frames.length > 3 || frames.some(frame => !snapshot.times.some(time => Math.abs(time - frame.time) <= 1) || !/^[A-Za-z0-9+/]+=*$/.test(frame.image)) || frames.reduce((sum, frame) => sum + frame.image.length, 0) > 900_000) throw new ConvexError('The guard render does not match the request.');
      await ctx.db.patch(snapshot._id, { status: 'completed', frames, differences }); return;
    }
    if (frames.length !== snapshot.times.length || frames.some((frame, index) => !Number.isFinite(frame.time) || Math.abs(frame.time - snapshot.times[index]) > 1 || !/^[A-Za-z0-9+/]+=*$/.test(frame.image)) || frames.reduce((sum, frame) => sum + frame.image.length, 0) > 900_000) throw new ConvexError('Rendered frames do not match the request.');
    await ctx.db.patch(snapshot._id, { status: 'completed', frames });
    if (snapshot.clipId && snapshot.key) await ctx.scheduler.runAfter(0, internal.sceneThumbs.storeImages, { snapshotId: snapshot._id });
    // A share card goes onto its share; the request itself is not kept.
    if (snapshot.shareId && frames[0]) { const share = await ctx.db.get(snapshot.shareId); if (share?.published) await ctx.db.patch(share._id, { cardImage: frames[0].image, cardUpdatedAt: Date.now() }); await ctx.db.delete(snapshot._id); }
  },
  render: async (ctx, task) => {
    const job = task.renderJobId ? await ctx.db.get(task.renderJobId) : null;
    if (!job?.outputR2Key) throw new ConvexError('Export has not stored its MP4 yet.');
    await ctx.db.patch(job._id, { status: 'completed', progress: 100, error: undefined, updatedAt: Date.now() });
  },
  import: async (ctx, task) => {
    const output = task.outputAssetId ? await ctx.db.get(task.outputAssetId) : null;
    if (!output || output.ownerId !== task.ownerId || output.projectId !== task.projectId || output.kind !== 'video' || !output.duration) throw new ConvexError('The imported video has not been stored yet.');
    const project = await requireProject(ctx, task.projectId, task.ownerId, false);
    if (output.duration < 1 / currentTimeline(project).fps) throw new ConvexError('The imported video is shorter than one timeline frame. It remains saved in Sources.');
    // A new revision would fail an AI edit's staged draft as "changed
    // elsewhere". The import is saved in Sources; place it once the run settles.
    if (!task.sourcesOnly) {
      if (await editingWorkflowActive(ctx, project)) await ctx.scheduler.runAfter(IMPORT_PLACEMENT_DELAY_MS, internal.mediaTasks.placeImport, { taskId: task._id, attempt: 1 });
      else await placeImportedVideo(ctx, project, task._id, { ...output, duration: output.duration });
    }
    await enqueueMediaTask(ctx, { ownerId: task.ownerId, projectId: task.projectId, assetId: output._id, kind: 'extract' });
    await enqueueMediaTask(ctx, { ownerId: task.ownerId, projectId: task.projectId, assetId: output._id, kind: 'preview' });
    await enqueueMediaTask(ctx, { ownerId: task.ownerId, projectId: task.projectId, assetId: output._id, kind: 'understand' });
  },
  cutout: async (ctx, task) => {
    const cutout = task.cutoutId ? await ctx.db.get(task.cutoutId) : null;
    const output = task.outputAssetId ? await ctx.db.get(task.outputAssetId) : null;
    if (!cutout || cutout.status !== 'queued') throw new ConvexError('The background removal request is no longer active.');
    if (!output || output.ownerId !== task.ownerId || output.projectId !== task.projectId || output.kind !== 'video' || !output.duration) throw new ConvexError('The background-removed video has not been stored yet.');
    // Picture only, on the original's source timeline: it shares the original's
    // extracted audio, so the clip's linked audio stays valid.
    const source = await ctx.db.get(cutout.sourceAssetId);
    await ctx.db.patch(output._id, { cutoutOf: cutout.sourceAssetId, cutoutStart: cutout.start, audioExtracted: true, ...(source?.audioAssetId ? { audioAssetId: source.audioAssetId } : {}) });
    await ctx.db.patch(cutout._id, { status: 'completed', outputAssetId: output._id });
    await placeCutout(ctx, { ...cutout, status: 'completed', outputAssetId: output._id }, { ...output, cutoutOf: cutout.sourceAssetId, cutoutStart: cutout.start });
  },
  derive: async (ctx, task, result) => completeDerivation(ctx, task, result.colorStats),
  video: async (ctx, task, result) => {
    const asset = await ownedSource(ctx, task);
    if (!task.videoRequest || !result.videoInspection || asset.kind !== 'video' || !asset.duration) throw new ConvexError('Native video evidence is missing.');
    if (result.analysis || result.frameInspection || result.audioAssetId || result.waveform) throw new ConvexError('Video question tasks return video evidence only.');
    const request = task.analysisRequestId ? await ctx.db.get(task.analysisRequestId) : null;
    const project = await readProject(ctx, task.projectId);
    // Older timeout handlers deleted the request without detaching the task.
    // A valid, uncancelled lease may still save evidence; it cannot edit a timeline.
    if (request && (request.ownerId !== task.ownerId || request.projectId !== task.projectId || request.assetId !== asset._id || request.mode !== 'video' || !project?.aiRunning || project.aiRunId !== request.aiRunId)) throw new ConvexError('AI video request is no longer active.');
    try { validateVideoInspectionResult(result.videoInspection, task.videoRequest, asset.duration); } catch (error) { throw new ConvexError((error as Error).message); }
    await patchMediaTask(ctx, task, { videoInspection: result.videoInspection });
    if (request) await ctx.db.patch(request._id, { videoInspection: result.videoInspection });
  },
  frames: async (ctx, task, result) => {
    const asset = await ownedSource(ctx, task);
    if (!task.frameRequest || !result.frameInspection || asset.kind !== 'video') throw new ConvexError('Frame inspection evidence is missing.');
    if ((task.requiredProcessorVersion ?? 1) >= 4 && (!result.frameInspection.geometry || !Array.isArray(result.frameInspection.targets))) throw new ConvexError('The frame worker must return source geometry and localized targets. Update the media worker before retrying.');
    if (result.analysis || result.audioAssetId || result.waveform) throw new ConvexError('Frame inspections return visual evidence only.');
    const request = task.analysisRequestId ? await ctx.db.get(task.analysisRequestId) : null;
    const project = request ? await readProject(ctx, task.projectId) : null;
    if (request && (request.ownerId !== task.ownerId || request.projectId !== task.projectId || request.assetId !== asset._id || request.mode !== 'frames' || !project?.aiRunning || project.aiRunId !== request.aiRunId)) throw new ConvexError('AI frame request is no longer active.');
    try { validateFrameInspectionResult(result.frameInspection, task.frameRequest); } catch (error) { throw new ConvexError((error as Error).message); }
    await patchMediaTask(ctx, task, { frameInspection: result.frameInspection });
    if (request) await ctx.db.patch(request._id, { frameInspection: result.frameInspection });
  },
  preview: async (ctx, task, result) => {
    const asset = await ownedSource(ctx, task);
    if (asset.kind !== 'video' || !hasPreview(asset) || result.audioAssetId || result.analysis || result.waveform || result.frameInspection || result.videoInspection) throw new ConvexError('The playback preview has not been stored for this source.');
  },
  extract: async (ctx, task, result) => {
    const asset = await ownedSource(ctx, task);
    if (asset.audioExtracted) {
      if (result.audioAssetId !== asset.audioAssetId) throw new ConvexError('Audio output does not match the prepared source.');
    } else if (result.audioAssetId !== task.outputAssetId) throw new ConvexError('Extracted audio must be the output of this task.');
    const audioId = task.outputAssetId ?? asset.audioAssetId;
    const audio = audioId ? await ctx.db.get(audioId) : null;
    if (audio && (audio.kind !== 'audio' || audio.projectId !== task.projectId || audio.ownerId !== task.ownerId)) throw new ConvexError('Invalid extracted audio.');
    if (result.waveform) { validateWaveform(result.waveform); if (!audio) throw new ConvexError('Audio is required for a waveform.'); await ctx.db.patch(audio._id, { waveform: result.waveform }); }
    await ctx.db.patch(asset._id, { audioExtracted: true, ...(audio ? { audioAssetId: audio._id } : {}) });
    // Listening follows verified extraction; silent footage never queues a
    // doomed transcription, and evidence remains attached to the video.
    if (audio) await enqueueMediaTask(ctx, { ownerId: task.ownerId, projectId: task.projectId, assetId: asset._id, kind: 'transcribe' });
  },
  waveform: async (ctx, task, result) => {
    const asset = await ownedSource(ctx, task);
    if (!result.waveform) throw new ConvexError('No waveform was returned.');
    validateWaveform(result.waveform); await ctx.db.patch(asset._id, { waveform: result.waveform });
  },
  facecam: saveAnalysisResult, speakers: saveAnalysisResult, transcribe: saveAnalysisResult, understand: saveAnalysisResult, shots: saveAnalysisResult, beats: saveAnalysisResult, track: saveAnalysisResult, reference: saveAnalysisResult,
};

export const complete = mutation({ args: { ...mediaTaskCredentials, result: taskResult }, returns: v.null(), handler: async (ctx, args) => {
  const saved = await ctx.db.get(args.taskId);
  if (saved?.status === 'completed' && saved.leaseToken === args.leaseToken) return null;
  const task = await requireMediaTask(ctx, args.taskId, args.leaseToken);
  // Evidence only counts for the task kind that asked for it.
  if (args.result.review && task.kind !== 'review') throw new ConvexError('The composition review is no longer active.');
  if (args.result.snapshot && task.kind !== 'snapshot') throw new ConvexError('The frame request is no longer active.');
  if (args.result.read && task.kind !== 'read') throw new ConvexError('The frame reading is no longer active.');
  if (args.result.frameInspection && task.kind !== 'frames') throw new ConvexError('Frame evidence belongs to a frame inspection task.');
  if (args.result.videoInspection && task.kind !== 'video') throw new ConvexError('Native video evidence belongs to its question task.');
  await RESULT_HANDLERS[task.kind](ctx, task, args.result);
  if (task.analysisRequestId && await ctx.db.get(task.analysisRequestId)) await ctx.db.patch(task.analysisRequestId, { status: 'completed', error: undefined });
  await patchMediaTask(ctx, task, { status: 'completed', progress: 100, error: undefined, leaseExpiresAt: undefined, updatedAt: Date.now() });
  await signalResult(ctx, task, { success: true, retryable: false });
  await releaseRenderSeat(ctx, task);
  return null;
}});
