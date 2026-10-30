import { memoriesFor } from './memories';
import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { projectIdentity, writeProject } from './lib/project_data';
import { currentTimeline } from './lib/timeline';
import { timelineDuration } from '../lib/editor/types';
import { aspectRatio } from './schema';
import { beginProjectDeletion, createProjectFor, duplicateProjectFor, listProjectsFor, renameProjectFor } from './projects';
import { importVideoFor } from './mediaTasks';
import { exportFileName, startRenderFor } from './renders';
import { activeTabOf, createTabFor, listTabsFor, openTabFor, removeTabFor, renameTabFor, storedTabTimeline } from './timelineTabs';
import { loadSceneCode } from './lib/scene_code';
import { enqueueMediaTask } from './mediaTasks';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { internal } from './_generated/api';

// Project-level work for the MCP server. Every function receives the owner the
// bearer token resolved to; nothing here trusts a client-supplied identity.

function projectIdOf(ctx: QueryCtx, projectId: string) {
  const id = ctx.db.normalizeId('projects', projectId);
  if (!id) throw new ConvexError('Project not found. Call listProjects for valid project IDs.');
  return id;
}

const editorUrl = (projectId: string) => `${process.env.APP_ORIGIN ?? ''}/editor/${projectId}`;

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
 * think between calls; per-call status would flicker on and off during one request. */
export const AGENT_ACTIVE_MS = 60_000;
/** Runs on every MCP tool call, so it reads only the small access and run rows, never the project document,
 * and rewrites the marker only once it is half spent. */
export const touchAgent = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), agentName: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const id = ctx.db.normalizeId('projects', args.projectId);
  if (!id) return null;
  try { await projectIdentity(ctx, id, args.ownerId); } catch { return null; }
  const name = args.agentName?.slice(0, 60) || 'AI agent', now = Date.now();
  const run = await ctx.db.query('aiRuns').withIndex('by_project', q => q.eq('projectId', id)).unique();
  if (run && run.aiAgentName === name && (run.aiAgentActiveUntil ?? 0) > now + AGENT_ACTIVE_MS / 2) return null;
  if (run) await ctx.db.patch(run._id, { aiAgentName: name, aiAgentActiveUntil: now + AGENT_ACTIVE_MS });
  else await writeProject(ctx, id, { aiAgentName: name, aiAgentActiveUntil: now + AGENT_ACTIVE_MS });
  return null;
}});

export const beginRun = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), agentName: v.optional(v.string()), timelineId: v.optional(v.string()) }, returns: v.object({ projectId: v.id('projects'), runId: v.string() }), handler: async (ctx, args) => {
  await requireEditorAccess(ctx, args.ownerId);
  const project = await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false);
  // An MCP call outlives its 10-minute action limit only if its action died; take its lock over.
  const started = mcpRunStarted(project.aiRunId), stale = started !== undefined && Date.now() - started > MCP_RUN_LIMIT;
  if (project.aiRunning && !stale) throw new ConvexError(project.aiRunId?.startsWith('mcp-') ? 'Another MCP edit is still running on this project. Wait for it to finish.' : 'The in-app AI is editing this project. Wait for it to finish, or stop it in the editor.');
  // Work on the requested tab: switched here, in the same transaction that takes the lock.
  if (args.timelineId && args.timelineId !== activeTabOf(project)) await openTabFor(ctx, args.ownerId, { projectId: project._id, timelineId: args.timelineId });
  const runId = `mcp-${Date.now()}-${crypto.randomUUID()}`;
  await clearLivePreview(ctx, project._id);
  await writeProject(ctx, project._id, { aiRunning: true, aiEditing: false, aiRunId: runId, aiAgentName: args.agentName?.slice(0, 60) || 'AI agent', aiAnalysisUsage: { runId, enqueued: 0 }, aiUndoRecorded: false, aiCheckpointRevision: undefined });
  // Releases the lock even if the action is killed; finish ignores a run that already ended.
  await ctx.scheduler.runAfter(MCP_RUN_LIMIT, internal.assistant.finish, { projectId: project._id, ownerId: args.ownerId, runId });
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
    // Lasting preferences the user saved with the editing AI; follow them, and use remember/forget to change them.
    memories: await memoriesFor(ctx, args.ownerId, project._id),
    media: assets.map(asset => ({ assetId: asset._id, fileName: asset.fileName, kind: asset.kind, duration: asset.duration, width: asset.width, height: asset.height, analysis: asset.analysisKinds ?? [], ...(asset.audioAssetId ? { audioAssetId: asset.audioAssetId } : {}) })),
  };
}});

export const createProject = internalMutation({ args: { ownerId: v.string(), title: v.string(), aspectRatio }, returns: v.any(), handler: async (ctx, args) => {
  const projectId = await createProjectFor(ctx, args.ownerId, { title: args.title, aspectRatio: args.aspectRatio });
  return { projectId, editorUrl: editorUrl(projectId) };
}});

export const importVideo = internalMutation({ args: { ownerId: v.string(), projectId: v.optional(v.string()), url: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const { projectId, taskId } = await importVideoFor(ctx, args.ownerId, { url: args.url, ...(args.projectId ? { projectId: projectIdOf(ctx, args.projectId) } : {}) });
  return { projectId, taskId, editorUrl: editorUrl(projectId), note: 'Poll getMediaTask with taskId until it completes; the media then appears in getProject.' };
}});

/** Timeline tabs: separate videos in one project. Editing tools act on the open one. */
export const listTimelines = internalQuery({ args: { ownerId: v.string(), projectId: v.string() }, returns: v.any(), handler: async (ctx, args) => listTabsFor(ctx, args.ownerId, projectIdOf(ctx, args.projectId)) });
export const openTimeline = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), timelineId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  await openTabFor(ctx, args.ownerId, { projectId: projectIdOf(ctx, args.projectId), timelineId: args.timelineId });
  return { opened: args.timelineId, note: 'Editing tools now act on this timeline; call inspectTimeline before editing.' };
}});
export const createTimeline = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), name: v.optional(v.string()), from: v.union(v.literal('blank'), v.literal('duplicate')), aspectRatio: v.optional(v.union(v.literal('landscape'), v.literal('vertical'), v.literal('square'))) }, returns: v.any(), handler: async (ctx, { ownerId, projectId, ...rest }) => {
  const timelineId = await createTabFor(ctx, ownerId, { projectId: projectIdOf(ctx, projectId), ...rest });
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
  const project = await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false);
  await beginProjectDeletion(ctx, args.ownerId, project);
  return { deleted: true, title: project.title };
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

/** Render up to six timeline frames as export would; the worker answers within seconds. */
export const requestFrames = internalMutation({ args: { ownerId: v.string(), projectId: v.string(), times: v.array(v.number()), timelineId: v.optional(v.string()) }, returns: v.id('frameSnapshots'), handler: async (ctx, args) => {
  await requireEditorAccess(ctx, args.ownerId);
  const project = await requireProject(ctx, projectIdOf(ctx, args.projectId), args.ownerId, false);
  const other = args.timelineId && args.timelineId !== activeTabOf(project) ? args.timelineId : undefined;
  const stored = other ? await storedTabTimeline(ctx, project, other) : null;
  if (other && !stored) throw new ConvexError('That timeline no longer exists.');
  const timeline = stored ?? currentTimeline(project), duration = timelineDuration(timeline);
  if (!timeline.clips.length) throw new ConvexError('The timeline is empty; there is nothing to look at yet.');
  if (!args.times.length || args.times.length > 6 || args.times.some(time => !Number.isFinite(time) || time < 0 || time > duration)) throw new ConvexError(`Choose 1 to 6 times between 0 and ${Math.round(duration * 100) / 100} seconds.`);
  await requireMediaTaskCapacity(ctx, args.ownerId, 1);
  // The worker renders the project's saved timeline; only the request is stored here.
  const snapshotId = await ctx.db.insert('frameSnapshots', { projectId: project._id, ownerId: args.ownerId, revision: project.revision ?? 0, times: args.times, status: 'queued', createdAt: Date.now(), ...(other ? { timelineId: other } : {}) });
  const taskId = await enqueueMediaTask(ctx, { ownerId: args.ownerId, projectId: project._id, kind: 'snapshot', snapshotId });
  await ctx.db.patch(snapshotId, { taskId });
  // Frames are read once; anything unread is removed shortly after.
  await ctx.scheduler.runAfter(10 * 60_000, internal.mcp.discardFrames, { snapshotId });
  return snapshotId;
}});

export const frames = internalQuery({ args: { ownerId: v.string(), snapshotId: v.id('frameSnapshots') }, returns: v.any(), handler: async (ctx, args) => {
  const snapshot = await ctx.db.get(args.snapshotId);
  if (!snapshot || snapshot.ownerId !== args.ownerId) throw new ConvexError('Frame request not found.');
  return { status: snapshot.status, revision: snapshot.revision, ...(snapshot.error ? { error: snapshot.error } : {}), ...(snapshot.frames ? { frames: snapshot.frames } : {}) };
}});

export const discardFrames = internalMutation({ args: { snapshotId: v.id('frameSnapshots') }, returns: v.null(), handler: async (ctx, args) => {
  const snapshot = await ctx.db.get(args.snapshotId);
  if (snapshot) await ctx.db.delete(snapshot._id);
  return null;
}});
