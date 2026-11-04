import { clipCheckRequestValidator } from './lib/clipping_validator';
import { motionTimelineKey } from '../lib/ai/motion-coverage';
import { cacheHash, frameCacheKey, snapshotResultDescriptor } from '../lib/media-analysis/frame-cache';
import { mediaUrl } from './lib/media_storage';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { generatedImageSummary } from './lib/generated_image_summary';
import { normalizationRequestValidator } from './lib/normalization_validator';
import { memoriesFor } from './memories';
import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { syncProjectAgent, projectIdentity, projectRun, projectRunContext, writeRunState, writeProject } from './lib/project_data';
import { currentTimeline } from './lib/timeline';
import { timelineDuration, type Timeline } from '../lib/editor/types';
import { aspectRatio } from './schema';
import { beginProjectDeletion, createProjectFor, duplicateProjectFor, listProjectsFor, renameProjectFor } from './projects';
import { cancelMediaTask, importVideoFor } from './mediaTasks';
import { exportFileName, startRenderFor } from './renders';
import { activeTabOf, createTabFor, listTabsFor, openTabFor, removeTabFor, renameTabFor, storedTabTimeline } from './timelineTabs';
import { loadSceneCode, storeSceneCode } from './lib/scene_code';
import { historyStart, timelineAtRevision } from './lib/revision_log';
import { briefFor } from './briefs';
import { enqueueMediaTask, GUARD_PROCESSOR_VERSION, MOTION_PROCESSOR_VERSION, PACING_PROCESSOR_VERSION, SOUND_PROCESSOR_VERSION, RECREATION_PROCESSOR_VERSION } from './mediaTasks';
import { referenceBox } from './schema';
import { comparisonCrop } from '../lib/ai/reference-comparison';
import { soundRequestValidator } from './lib/sound_validator';
import { pacingRequestValidator } from './lib/pacing_validator';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { internal } from './_generated/api';
import { touchTaskAgent } from './mcpConnections';
import { MCP_AGENT_IDLE_MS } from '../lib/mcp/agent-identity';

// Project-level work for the MCP server. Every function receives the owner the
// bearer token resolved to; nothing here trusts a client-supplied identity.

function projectIdOf(ctx: QueryCtx, projectId: string) {
  const id = ctx.db.normalizeId('projects', projectId);
  if (!id) throw new ConvexError('Project not found. Call listProjects for valid project IDs.');
  return id;
}

const editorUrl = (projectId: string) => `${process.env.APP_ORIGIN ?? ''}/editor/${projectId}`;

export const normalizeSnapshotId = internalQuery({ args:{snapshotId:v.string(),ownerId:v.string(),projectId:v.id('projects'),kind:v.union(v.literal('pacing'),v.literal('sound')),timelineId:v.optional(v.string()),check:v.optional(v.boolean())},returns:v.id('frameSnapshots'),handler:async(ctx,args)=>{
  const id=ctx.db.normalizeId('frameSnapshots',args.snapshotId),snapshot=id?await ctx.db.get(id):null;
  if(!snapshot||snapshot.ownerId!==args.ownerId||snapshot.projectId!==args.projectId||!snapshot[args.kind])throw new ConvexError('This saved check is unavailable for this project.');
  if(args.timelineId&&snapshot.timelineId&&args.timelineId!==snapshot.timelineId)throw new ConvexError('This saved check belongs to another timeline tab.');
  if(args.check!==undefined&&snapshot.sound?.check!==args.check)throw new ConvexError('Resume this saved check with the tool that started it (checkSound or getSound).');
  return snapshot._id;
}});

async function clearLivePreview(ctx: MutationCtx, projectId: Id<'projects'>) {
  const preview = await ctx.db.query('aiTimelinePreviews').withIndex('by_project', q => q.eq('projectId', projectId)).unique();
  if (preview) await ctx.db.delete(preview._id);
}

/** One MCP tool call is one AI run: the same lock, live preview and undo group as an in-app edit. */
const MCP_RUN_LIMIT = 11 * 60_000;
const mcpRunStarted = (runId?: string) => runId?.startsWith('mcp-') ? Number(runId.split('-')[1]) : undefined;

/** Access check for read-only tools, which run alongside edits instead of taking the project lock. */
/** A tab's saved timeline with its scene code, for reading a tab without opening it. */
export const tabTimeline = internalQuery({ args: { ownerId: v.string(), projectId: v.string(), timelineId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false);
  const timeline = args.timelineId === activeTabOf(project) ? currentTimeline(project) : await storedTabTimeline(ctx, project, args.timelineId);
  if (!timeline) throw new ConvexError('That timeline no longer exists.');
  return loadSceneCode(ctx, timeline);
}});

export const readRun = internalQuery({ args: { ownerId: v.string(), projectId: v.string() }, returns: v.id('projects'), handler: async (ctx, args) => {
  await requireEditorAccess(ctx, args.ownerId);
  return (await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false))._id;
}});

/** How long the editor keeps showing an MCP agent as working after its last call. Agents
 * think between calls, and writing a film part for patchScene or addFilm can take several
 * minutes, so a short window drops the status mid-request and invites the user to edit over it. */
export const AGENT_ACTIVE_MS = MCP_AGENT_IDLE_MS;
/** Runs on every MCP tool call, so it reads only the small access and run rows, never the project document,
 * and rewrites the marker only once it is half spent. */
export const touchAgent = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), agentName: v.optional(v.string()), taskId: v.optional(v.string()), agentClientId: v.optional(v.id('mcpConnections')), startedAt: v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  const id = ctx.db.normalizeId('projects', args.projectId);
  if (!id) return null;
  try { await projectIdentity(ctx, id, args.ownerId); } catch { return null; }
  const name = args.agentName?.slice(0, 60) || 'AI agent', now = Date.now();
  if(args.taskId)await touchTaskAgent(ctx,args.ownerId,args.taskId,name,args.agentClientId,args.startedAt);
  const run = await ctx.db.query('aiRuns').withIndex('by_project', q => q.eq('projectId', id)).unique();
  if (run && run.aiAgentName === name && (run.aiAgentActiveUntil ?? 0) > now + AGENT_ACTIVE_MS / 2) return null;
  if (run) {
    await ctx.db.patch(run._id, { aiAgentName: name, aiAgentActiveUntil: now + AGENT_ACTIVE_MS });
    await syncProjectAgent(ctx,id,{...run,aiAgentName:name,aiAgentActiveUntil:now+AGENT_ACTIVE_MS});
  }
  else await writeProject(ctx, id, { aiAgentName: name, aiAgentActiveUntil: now + AGENT_ACTIVE_MS });
  return null;
}});

export const beginRun = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), agentName: v.optional(v.string()), timelineId: v.optional(v.string()) }, returns: v.object({ projectId: v.id('projects'), runId: v.string() }), handler: async (ctx, args) => {
  await requireEditorAccess(ctx, args.ownerId);
  const project = await projectRunContext(ctx, projectIdOf(ctx, args.projectId), args.ownerId);
  // An MCP call outlives its 10-minute action limit only if its action died; take its lock over.
  const started = mcpRunStarted(project.aiRunId), stale = started !== undefined && Date.now() - started > MCP_RUN_LIMIT;
  if (project.aiRunning && !stale) throw new ConvexError(project.aiRunId?.startsWith('mcp-') ? 'Another MCP edit is still running on this project. Wait for it to finish.' : 'The in-app AI is editing this project. Wait for it to finish, or stop it in the editor.');
  // Work on the requested tab: switched here, in the same transaction that takes the lock, and only for this
  // call. The tab open before it (kept across a stale takeover) reopens when the run ends, so a timelineId
  // edit never moves the user's tab; openTimeline is the call that switches it for good.
  const returnTo = stale && project.aiReturnTimelineId ? project.aiReturnTimelineId : activeTabOf(project);
  const borrowing = !!args.timelineId && args.timelineId !== activeTabOf(project);
  if (borrowing) await openTabFor(ctx, args.ownerId, { projectId: project._id, timelineId: args.timelineId! });
  const runId = `mcp-${Date.now()}-${crypto.randomUUID()}`;
  await clearLivePreview(ctx, project._id);
  await writeRunState(ctx, project._id, { aiReturnTimelineId: borrowing || (stale && project.aiReturnTimelineId) ? returnTo : undefined, aiRunning: true, aiEditing: false, aiRunId: runId, aiAgentName: args.agentName?.slice(0, 60) || 'AI agent', aiAnalysisUsage: { runId, enqueued: 0 }, aiUndoRecorded: false, aiCheckpointRevision: undefined });
  // Releases the lock even if the action is killed; finish ignores a run that already ended.
  const scheduledId=await ctx.scheduler.runAfter(MCP_RUN_LIMIT, internal.assistant.finish, { projectId: project._id, ownerId: args.ownerId, runId });
  await ctx.db.insert('mcpRunTimeouts',{projectId:project._id,ownerId:args.ownerId,runId,scheduledId});
  return { projectId: project._id, runId };
}});

export const listProjects = internalQuery({ args: { ownerId: v.string(), limit: v.optional(v.number()) }, returns: v.any(), handler: async (ctx, args) => {
  const rows = await listProjectsFor(ctx, args.ownerId, { limit: args.limit ?? 20 });
  return rows.map(row => ({ projectId: row._id, title: row.title, aspectRatio: row.aspectRatio, clipCount: row.clipCount, updatedAt: new Date(row.updatedAt).toISOString(), aiRunning: row.aiRunning, editorUrl: editorUrl(row._id) }));
}});

export const projectOverview = internalQuery({ args: { ownerId: v.string(), projectId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false);
  const timeline = currentTimeline(project);
  const assets = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', args.ownerId).eq('projectId', project._id)).take(200);
  return {
    projectId: project._id, title: project.title, aspectRatio: project.aspectRatio, revision: project.revision ?? 0,
    duration: Math.round(timelineDuration(timeline) * 1000) / 1000, clipCount: timeline.clips.length, aiRunning: !!project.aiRunning, editorUrl: editorUrl(project._id),
    // Every timeline tab; duration, clipCount and editing tools refer to the open one.
    timelines: (await listTabsFor(ctx, args.ownerId, project._id)).map(tab => ({ timelineId: tab.id, name: tab.name, open: tab.active, aspectRatio: tab.aspectRatio, duration: Math.round(tab.duration * 1000) / 1000, clipCount: tab.clipCount })),
    // The user's direction for this project, in their own words: read it before editing; keep it current with updateBrief.
    brief: await briefFor(ctx, project._id),
    // Lasting preferences the user saved with the editing AI; follow them, and use remember/forget to change them.
    memories: await memoriesFor(ctx, args.ownerId, project._id),
    media: assets.map(asset => ({ assetId: asset._id, fileName: asset.fileName, kind: asset.kind, duration: asset.duration, width: asset.width, height: asset.height, analysis: asset.analysisKinds ?? [], ...(asset.audioAssetId ? { audioAssetId: asset.audioAssetId } : {}), ...generatedImageSummary(asset) })),
  };
}});

export const createProject = internalMutation({ args: { ownerId: v.string(), title: v.string(), aspectRatio }, returns: v.any(), handler: async (ctx, args) => {
  const projectId = await createProjectFor(ctx, args.ownerId, { title: args.title, aspectRatio: args.aspectRatio });
  return { projectId, editorUrl: editorUrl(projectId) };
}});

export const importVideo = internalMutation({ args: { ownerId: v.string(), projectId: v.optional(v.string()), url: v.string(), start: v.optional(v.number()), end: v.optional(v.number()) }, returns: v.any(), handler: async (ctx, args) => {
  const { projectId, taskId } = await importVideoFor(ctx, args.ownerId, { url: args.url, ...(args.start !== undefined ? { start: args.start } : {}), ...(args.end !== undefined ? { end: args.end } : {}), ...(args.projectId ? { projectId: projectIdOf(ctx, args.projectId) } : {}) });
  return { projectId, taskId, editorUrl: editorUrl(projectId), note: 'Poll getMediaTask with taskId until it completes; the media then appears in getProject.' };
}});

/** Timeline tabs: separate videos in one project. Editing tools act on the open one. */
export const listTimelines = internalQuery({ args: { ownerId: v.string(), projectId: v.string() }, returns: v.any(), handler: async (ctx, args) => listTabsFor(ctx, args.ownerId, projectIdOf(ctx, args.projectId)) });
export const openTimeline = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), timelineId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  await openTabFor(ctx, args.ownerId, { projectId: projectIdOf(ctx, args.projectId), timelineId: args.timelineId });
  return { opened: args.timelineId, note: 'Editing tools now act on this timeline; call inspectTimeline before editing.' };
}});
export const createTimeline = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), timelineId: v.optional(v.string()), name: v.optional(v.string()), from: v.union(v.literal('blank'), v.literal('duplicate')), aspectRatio: v.optional(v.union(v.literal('landscape'), v.literal('vertical'), v.literal('square'))) }, returns: v.any(), handler: async (ctx, { ownerId, projectId, timelineId: sourceTimelineId, ...rest }) => {
  const id=projectIdOf(ctx,projectId);
  if(sourceTimelineId) await openTabFor(ctx,ownerId,{projectId:id,timelineId:sourceTimelineId});
  const timelineId = await createTabFor(ctx, ownerId, { projectId: id, ...rest });
  return { timelineId, opened: true, note: 'The new timeline is open; editing tools act on it.' };
}});

export const renameProject = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), title: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  await renameProjectFor(ctx, args.ownerId, projectIdOf(ctx, args.projectId), args.title);
  return { renamed: true, title: args.title.trim() };
}});
export const duplicateProject = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), title: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => {
  const projectId = await duplicateProjectFor(ctx, args.ownerId, projectIdOf(ctx, args.projectId), args.title);
  return { projectId, editorUrl: editorUrl(projectId), note: 'A full copy with every timeline tab and its media. Edits to it never change the original.' };
}});
export const deleteProject = internalMutation({ args: { ownerId: v.string(), projectId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const project = await ctx.db.get(projectIdOf(ctx, args.projectId));
  if(project)await beginProjectDeletion(ctx, args.ownerId, project);
  return { deleted: true, ...(project?{title:project.title}:{}) };
}});
export const renameTimeline = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), timelineId: v.string(), name: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  await renameTabFor(ctx, args.ownerId, { projectId: projectIdOf(ctx, args.projectId), timelineId: args.timelineId, name: args.name });
  return { renamed: true, name: args.name.trim() };
}});
export const deleteTimeline = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), timelineId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  await removeTabFor(ctx, args.ownerId, { projectId: projectIdOf(ctx, args.projectId), timelineId: args.timelineId });
  return { deleted: true, note: 'If it was open, the neighbouring timeline is now open.' };
}});

export const mediaTask = internalQuery({ args: { ownerId: v.string(), taskId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const id = ctx.db.normalizeId('mediaTasks', args.taskId), task = id ? await ctx.db.get(id) : null;
  if (!task || task.ownerId !== args.ownerId) throw new ConvexError('Media task not found.');
  await requireProject(ctx, task.projectId, args.ownerId, false);
  return { taskId: task._id, kind: task.kind, status: task.status, progress: task.progress, ...(task.error ? { error: task.error } : {}), ...(task.assetId ? { assetId: task.assetId } : {}) };
}});

export const startExport = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), resolution: v.number(), fps: v.number(), quality: v.string(), timelineId: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => {
  const jobId = await startRenderFor(ctx, args.ownerId, { projectId: projectIdOf(ctx, args.projectId), resolution: args.resolution, fps: args.fps, quality: args.quality, ...(args.timelineId ? { timelineId: args.timelineId } : {}) });
  return { jobId, note: 'Poll getExport with jobId; a completed export returns a download link.' };
}});

/** The project's recent exports, newest first: the queue plus finished files. */
export const listExports = internalQuery({ args: { ownerId: v.string(), projectId: v.string(), limit: v.number() }, returns: v.any(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false);
  const jobs = await ctx.db.query('renderJobs').withIndex('by_ownerId_projectId', q => q.eq('ownerId', args.ownerId).eq('projectId', project._id)).order('desc').take(args.limit);
  return jobs.map(job => ({ jobId: job._id, status: job.status, progress: job.progress, resolution: job.resolution, fps: job.fps, createdAt: new Date(job.createdAt).toISOString(), current: job.sourceRevision === (project.revision ?? 0), ...(job.label ? { timeline: job.label } : {}), ...(job.sourceClipId ? { clipId: job.sourceClipId } : {}), ...(job.error ? { error: job.error } : {}), output: job.status === 'completed' ? { storageId: job.outputStorageId, r2Key: job.outputR2Key, fileName: exportFileName(project.title, job.label) } : null }));
}});

export const exportJob = internalQuery({ args: { ownerId: v.string(), jobId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const id = ctx.db.normalizeId('renderJobs', args.jobId), job = id ? await ctx.db.get(id) : null;
  if (!job || job.ownerId !== args.ownerId) throw new ConvexError('Export not found.');
  const project = await requireProject(ctx, job.projectId, args.ownerId, false);
  return { jobId: job._id, status: job.status, progress: job.progress, resolution: job.resolution, fps: job.fps, ...(job.label ? { timeline: job.label } : {}), ...(job.error ? { error: job.error } : {}), output: job.status === 'completed' ? { storageId: job.outputStorageId, r2Key: job.outputR2Key, fileName: exportFileName(project.title, job.label) } : null };
}});

/** Render up to six timeline frames as export would; the worker answers within seconds. With pacing, it instead
 * samples the range at pacing.fps and returns measurements of its motion (checkPacing), not images; with sound, it
 * decodes the range's mix (getSound) and, for a check, matches its sound effects to picture changes (checkSound). */
export const requestFrames = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), recreation:v.optional(v.boolean()), times: v.array(v.number()), clipCheck:v.optional(clipCheckRequestValidator), normalization:v.optional(normalizationRequestValidator), sourceSnapshotId: v.optional(v.id('frameSnapshots')), comparison: v.optional(v.object({ crop: v.optional(referenceBox), aspectRatio: v.optional(v.number()) })), timelineId: v.optional(v.string()), runId: v.optional(v.string()), pacing: v.optional(pacingRequestValidator), motion: v.optional(v.object({ start: v.number(), end: v.number() })), sound: v.optional(soundRequestValidator), revision: v.optional(v.number()) }, returns: v.id('frameSnapshots'), handler: async (ctx, args) => {
  await requireEditorAccess(ctx, args.ownerId);
  const project = await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false);
  const other = args.timelineId && args.timelineId !== activeTabOf(project) ? args.timelineId : undefined;
  const stored = other ? await storedTabTimeline(ctx, project, other) : null;
  if (other && !stored) throw new ConvexError('That timeline no longer exists.');
  // A turn with staged changes (after a delete, every later edit waits until the turn ends) looks at its draft, not the saved timeline.
  const draft = args.runId ? await ctx.db.query('aiTimelinePreviews').withIndex('by_project', q => q.eq('projectId', project._id)).unique() : null;
  const drafted = draft && draft.runId === args.runId && !other ? draft.timeline : null;
  const now = drafted ?? stored ?? currentTimeline(project), revision = args.revision;
  const source = args.sourceSnapshotId ? await ctx.db.get(args.sourceSnapshotId) : null;
  const sourceTimeline = source?.cacheIdentity ? (await ctx.db.query('frameSnapshotPayloads').withIndex('by_snapshot',q=>q.eq('snapshotId',source._id)).unique())?.timeline : source?.sourceTimeline;
  if (args.sourceSnapshotId && (!source || source.ownerId !== args.ownerId || source.projectId !== project._id || !sourceTimeline)) throw new ConvexError('The comparison snapshot is unavailable.');
  // A continued check uses its frozen source even after revision history has moved on.
  const past = revision === undefined || source ? null : await pastTimeline(ctx, project, other ?? activeTabOf(project), stored ?? currentTimeline(project), revision);
  if (args.comparison?.aspectRatio !== undefined && (!Number.isFinite(args.comparison.aspectRatio) || args.comparison.aspectRatio <= 0)) throw new ConvexError('Use a positive comparison aspect ratio.');
  if (args.comparison?.crop && !comparisonCrop.safeParse(args.comparison.crop).success) throw new ConvexError('Keep the normalized comparison crop inside the frame.');
  const timeline = sourceTimeline ?? past ?? now, duration = timelineDuration(timeline);
  if (!timeline.clips.length) throw new ConvexError('The timeline is empty; there is nothing to look at yet.');
  const normalization=args.normalization;
  if(normalization){
    if(args.sound||args.motion||args.pacing||args.comparison||args.times.length||args.revision!==undefined)throw new ConvexError('Normalize one current audio mix at a time.');
    if(!Number.isFinite(normalization.targetLufs)||normalization.targetLufs< -24||normalization.targetLufs> -9||!Number.isFinite(normalization.truePeak)||normalization.truePeak< -6||normalization.truePeak> -1)throw new ConvexError('Choose -24 to -9 LUFS and a true peak between -6 and -1 dBTP.');
    const clip=normalization.clipId?timeline.clips.find(c=>c.id===normalization.clipId):null;
    if(normalization.clipId&&(!clip||!['audio','video'].includes(clip.kind)))throw new ConvexError('Choose a sounding audio or video clip.');
    if((clip?.duration??duration)>600)throw new ConvexError('Normalize up to ten minutes at a time.');
    if(timeline.clips.some(c=>c.kind==='scene'&&c.scene?.media?.length))throw new ConvexError('Normalize uploaded timeline audio. Scene-embedded sound must be placed on audio tracks first.');
  }
  const pacing = args.pacing && { ...args.pacing, end: Math.min(args.pacing.end, duration) };
  if (pacing && (!Number.isFinite(pacing.start) || pacing.start < 0 || pacing.end - pacing.start < .3 || !(pacing.fps >= 2 && pacing.fps <= timeline.fps))) throw new ConvexError(`Check pacing over at least 0.3 s between 0 and ${Math.round(duration * 100) / 100} seconds, at 2 to ${timeline.fps} samples a second.`);
  const sound = args.sound && { ...args.sound, end: Math.min(args.sound.end, duration) };
  const motion = args.motion && { start: args.motion.start, end: Math.min(args.motion.end, duration, args.motion.start + 12) };
  if (motion && (!Number.isFinite(motion.start) || motion.start < 0 || motion.end - motion.start < .3)) throw new ConvexError(`Map at least 0.3 s between 0 and ${Math.round(duration * 100) / 100} seconds, up to 12 s at a time.`);
  if (sound && (!Number.isFinite(sound.start) || sound.start < 0 || sound.end - sound.start < .3 || sound.fps !== undefined && !(sound.fps >= 10 && sound.fps <= timeline.fps))) throw new ConvexError(`Listen to at least 0.3 s between 0 and ${Math.round(duration * 100) / 100} seconds${sound.check ? `, sampling the picture at 10 to ${timeline.fps} frames a second` : ''}.`);
  if (!args.clipCheck && !normalization && !pacing && !sound && !motion && (!args.times.length || args.times.length > 6 || args.times.some(time => !Number.isFinite(time) || time < 0 || time > duration))) throw new ConvexError(`Choose 1 to 6 times between 0 and ${Math.round(duration * 100) / 100} seconds.`);
  const frozen = await storeSceneCode(ctx, timeline);
  const snapshotRevision = source?.atRevision ?? source?.revision ?? (pacing || sound ? revision : undefined) ?? project.revision ?? 0;
  const tab = source?.timelineId ?? other ?? activeTabOf(project);
  const cacheIdentity = !normalization && !pacing && !sound && !motion ? await cacheHash({ timelineId: tab, revision: source?.atRevision ?? source?.revision ?? revision ?? snapshotRevision, timeline: frozen, comparison: args.comparison, resolution: args.comparison ? 1080 : 720, format: 'jpeg', quality: 'bounded-frame-budget' }) : undefined;
  const key = cacheIdentity && !args.clipCheck ? await frameCacheKey({ownerId:args.ownerId,projectId:project._id},snapshotResultDescriptor(cacheIdentity,args.times)) : undefined;
  const cached = key ? await ctx.db.query('mediaFrameCache').withIndex('by_key',q=>q.eq('key',key)).unique() : null;
  const hit = cached?.ready && (cached.expiresAt ?? 0) > Date.now() ? cached : null;
  const recreation = args.recreation === true;
  if (!hit && !recreation) await requireMediaTaskCapacity(ctx, args.ownerId, 1);
  // Comparisons keep one immutable source across batches, drafts and concurrent edits. Scene code stays stored by hash.
  const snapshotId = await ctx.db.insert('frameSnapshots', { ...(cacheIdentity ? {cacheIdentity,...(args.clipCheck?{sourceTimeline:frozen}:{})} : {sourceTimeline:frozen}), ...(hit ? {resultR2Key:hit.r2Key} : {}), ...(args.comparison ? { comparison: args.comparison } : {}), projectId: project._id, ownerId: args.ownerId, revision: snapshotRevision, times: args.clipCheck || normalization || pacing || sound || motion ? [] : args.times, status: hit ? 'completed' : 'queued', createdAt: Date.now(), timelineId: tab, ...(drafted && !past && !source ? { runId: args.runId } : {}), ...(pacing ? { pacing } : {}), ...(motion ? { motion, motionKey: await motionTimelineKey(timeline) } : {}), ...(sound ? { sound } : {}), ...(normalization ? {normalization} : {}), ...(args.clipCheck?{clipCheck:args.clipCheck}:{}), ...(past ? { atRevision: revision } : {}) });
  if (cacheIdentity) await ctx.db.insert('frameSnapshotPayloads',{snapshotId,projectId:project._id,timeline:frozen});
  const requiredProcessorVersion=Math.max(MEDIA_PROCESSOR_VERSION,normalization||timeline.audioNormalization||timeline.clips.some(c=>c.normalizedAudio)?MEDIA_PROCESSOR_VERSION:0,pacing?PACING_PROCESSOR_VERSION:0,motion?MOTION_PROCESSOR_VERSION:0,sound?Math.max(SOUND_PROCESSOR_VERSION,RECREATION_PROCESSOR_VERSION):0,args.comparison?RECREATION_PROCESSOR_VERSION:0);
  const taskId = hit ? undefined : await enqueueMediaTask(ctx, { ownerId: args.ownerId, projectId: project._id, kind: 'snapshot', snapshotId, requiredProcessorVersion }, undefined, recreation);
  if (taskId) await ctx.db.patch(snapshotId, { taskId });
  await ctx.db.insert('frameSnapshotControls',{snapshotId,projectId:project._id,preserve:!!(pacing||sound),...(args.comparison&&taskId?{cancelTaskId:taskId}:{})});
  // Measurements are saved verification records, kept until the project is deleted.
  if (!pacing && !sound) await ctx.scheduler.runAfter(10 * 60_000, internal.mcp.expireFrames, { snapshotId });
  return snapshotId;
}});

async function pastTimeline(ctx: MutationCtx, project: Doc<'projects'>, timelineId: string, current: Timeline, revision: number) {
  const latest = project.revision ?? 0, start = await historyStart(ctx, project._id, latest);
  if (!Number.isInteger(revision) || revision > latest) throw new ConvexError(`Revision ${revision} does not exist yet; the project is at revision ${latest}. Call listRevisions for revision numbers.`);
  if (revision < start) throw new ConvexError(`Revision history for this project starts at revision ${start}; revision ${revision} is older and cannot be shown.`);
  const past = await timelineAtRevision(ctx, project._id, timelineId, await loadSceneCode(ctx, current), revision);
  if (!past) throw new ConvexError(`Too much changed since revision ${revision} to rebuild that timeline in one read.`);
  return past;
}

/** The visual guard: render times of a proposed timeline beside the one it would replace, both kept by scene-code hash. */
export const requestGuard = internalMutation({ args: { ownerId: v.string(), projectId: v.id('projects'), runId: v.string(), baseline: v.any(), candidate: v.any(), times: v.array(v.number()) }, returns: v.id('frameSnapshots'), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId, false), run = await projectRun(ctx, project._id, args.ownerId);
  if (run.aiRunId !== args.runId || !run.aiRunning) throw new ConvexError('AI run is no longer active');
  if (!args.times.length || args.times.length > 24 || args.times.some(time => !Number.isFinite(time) || time < 0)) throw new ConvexError('The guard renders 1 to 24 times.');
  const baseline = await storeSceneCode(ctx, args.baseline as Timeline), candidate = await storeSceneCode(ctx, args.candidate as Timeline);
  const snapshotId = await ctx.db.insert('frameSnapshots', { projectId: project._id, ownerId: args.ownerId, revision: project.revision ?? 0, times: args.times, status: 'queued', createdAt: Date.now(), guard: { baseline, candidate } });
  const taskId = await enqueueMediaTask(ctx, { ownerId: args.ownerId, projectId: project._id, kind: 'snapshot', snapshotId, requiredProcessorVersion: GUARD_PROCESSOR_VERSION });
  await ctx.db.patch(snapshotId, { taskId });
  await ctx.db.insert('frameSnapshotControls',{snapshotId,projectId:project._id,preserve:false});
  await ctx.scheduler.runAfter(15 * 60_000, internal.mcp.expireFrames, { snapshotId });
  return snapshotId;
}});

export const frames = internalQuery({ args: { ownerId: v.string(), snapshotId: v.id('frameSnapshots') }, returns: v.any(), handler: async (ctx, args) => {
  const snapshot = await ctx.db.get(args.snapshotId);
  if (!snapshot || snapshot.ownerId !== args.ownerId) throw new ConvexError('Frame request not found.');
  const task = snapshot.status === 'queued' && snapshot.taskId ? await ctx.db.get(snapshot.taskId) : null;
  return { status: snapshot.status, started: snapshot.status !== 'queued' || (!!task && task.status !== 'queued'), revision: snapshot.revision, ...(snapshot.timelineId ? { timelineId: snapshot.timelineId } : {}), ...(snapshot.sound || snapshot.pacing ? { requestedRange: snapshot.sound ?? snapshot.pacing } : {}), ...(snapshot.error ? { error: snapshot.error } : {}), ...(snapshot.frames ? { frames: snapshot.frames } : {}), ...(snapshot.resultR2Key ? {framesUrl: await mediaUrl(ctx,{r2Key:snapshot.resultR2Key})} : {}), ...(snapshot.differences ? { differences: snapshot.differences, times: snapshot.times } : {}), ...(snapshot.atRevision !== undefined ? { atRevision: snapshot.atRevision } : {}), ...(snapshot.pacingResult ? { pacing: snapshot.pacingResult } : {}), ...(snapshot.motionResult ? { motion: snapshot.motionResult } : {}), ...(snapshot.soundResult ? { sound: snapshot.soundResult } : {}), ...(snapshot.clipCheckResult?{clipCheck:snapshot.clipCheckResult}:{}), ...(snapshot.normalizationResult?{normalization:snapshot.normalizationResult}:{}) };
}});

async function removeFrameControl(ctx:MutationCtx,snapshotId:Id<'frameSnapshots'>){
  const control=await ctx.db.query('frameSnapshotControls').withIndex('by_snapshot',q=>q.eq('snapshotId',snapshotId)).unique();
  if(control)await ctx.db.delete(control._id);
  const payload=await ctx.db.query('frameSnapshotPayloads').withIndex('by_snapshot',q=>q.eq('snapshotId',snapshotId)).unique();
  if(payload)await ctx.db.delete(payload._id);
}

/** Consume ephemeral images once; saved sound and pacing measurements remain retrievable. */
export const takeFrames = internalMutation({ args: { ownerId: v.string(), snapshotId: v.id('frameSnapshots') }, returns: v.any(), handler: async (ctx, args) => {
  const snapshot = await ctx.db.get(args.snapshotId);
  if (!snapshot || snapshot.ownerId !== args.ownerId) throw new ConvexError('Frame request not found.');
  const task = snapshot.status === 'queued' && snapshot.taskId ? await ctx.db.get(snapshot.taskId) : null;
  if (snapshot.status !== 'queued' && !snapshot.sound && !snapshot.pacing) { await removeFrameControl(ctx,snapshot._id);await ctx.db.delete(snapshot._id); }
  return { status: snapshot.status, started: snapshot.status !== 'queued' || (!!task && task.status !== 'queued'), revision: snapshot.revision, ...(snapshot.error ? { error: snapshot.error } : {}), ...(snapshot.frames ? { frames: snapshot.frames } : {}), ...(snapshot.resultR2Key ? {framesUrl: await mediaUrl(ctx,{r2Key:snapshot.resultR2Key})} : {}), ...(snapshot.differences ? { differences: snapshot.differences, times: snapshot.times } : {}), ...(snapshot.atRevision !== undefined ? { atRevision: snapshot.atRevision } : {}), ...(snapshot.pacingResult ? { pacing: snapshot.pacingResult } : {}), ...(snapshot.motionResult ? { motion: snapshot.motionResult } : {}), ...(snapshot.soundResult ? { sound: snapshot.soundResult } : {}), ...(snapshot.clipCheckResult?{clipCheck:snapshot.clipCheckResult}:{}), ...(snapshot.normalizationResult?{normalization:snapshot.normalizationResult}:{}) };
}});

export const discardFrames = internalMutation({ args: { snapshotId: v.id('frameSnapshots') }, returns: v.null(), handler: async (ctx, args) => {
  const control=await ctx.db.query('frameSnapshotControls').withIndex('by_snapshot',q=>q.eq('snapshotId',args.snapshotId)).unique();
  if(control){
    if(!control.preserve){
      if(control.cancelTaskId)await cancelMediaTask(ctx,control.cancelTaskId);
      await ctx.db.delete(args.snapshotId);await removeFrameControl(ctx,args.snapshotId);
    }
    return null;
  }
  // Requests created before the projection keep the legacy cleanup path.
  const snapshot = await ctx.db.get(args.snapshotId);
  if (snapshot && !snapshot.sound && !snapshot.pacing) {
    if (snapshot.comparison && snapshot.status === 'queued' && snapshot.taskId) await cancelMediaTask(ctx, snapshot.taskId);
    await ctx.db.delete(snapshot._id);
  }
  return null;
}});

export const expireFrames = internalMutation({args:{snapshotId:v.id('frameSnapshots')},returns:v.null(),handler:async(ctx,args)=>{
  const snapshot=await ctx.db.get(args.snapshotId);
  if(!snapshot||snapshot.sound||snapshot.pacing)return null;
  const task=snapshot.taskId?await ctx.db.get(snapshot.taskId):null;
  if(snapshot.status==='queued'&&task&&(task.status==='queued'||task.status==='running'||task.status==='retrying')){
    await ctx.scheduler.runAfter(15*60_000,internal.mcp.expireFrames,args);
  }else {await removeFrameControl(ctx,snapshot._id);await ctx.db.delete(snapshot._id);}
  return null;
}});
