import { requireEditorAccess } from './lib/billing_access';
import { mediaUrl } from './lib/media_storage';
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { listLimit, requireOwner, requireProject } from "./lib/auth";
import { commitTimeline, currentTimeline, serializedBytes, validateTimeline } from "./lib/timeline";
import { removeMediaAttachment } from './lib/shared_media';
import { addMediaClip, patchClip } from '../lib/editor/operations';
import { applyTimelineEdit } from '../lib/editor/timeline-sync';
import { layerGroup, normalizeTimeline, timelineDuration, type Timeline } from '../lib/editor/types';
import { aspectRatio, projectDocument, timelineValidator } from "./schema";
import { cancelMediaTask } from './mediaTasks';
function projectTitle(value: string) { const title = value.trim(); if (!title || title.length > 120) throw new ConvexError("Title must contain between 1 and 120 characters"); return title; }
export const create = mutation({ args: { title: v.string(), aspectRatio, assetIds: v.optional(v.array(v.id('assets'))) }, returns: v.id("projects"), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); const now = Date.now();
  if ((args.assetIds?.length ?? 0) > 200) throw new ConvexError('Choose up to 200 uploads');
  const sources = await Promise.all([...new Set(args.assetIds ?? [])].map(id => ctx.db.get(id)));
  if (sources.some(asset => !asset || asset.ownerId !== ownerId || (!asset.r2Key && !asset.storageId))) throw new ConvexError('Saved footage is unavailable or belongs to another account');
  let timeline: Timeline = normalizeTimeline({ clips: [], fps: 30, aspectRatio: args.aspectRatio });
  const projectId = await ctx.db.insert("projects", { title: projectTitle(args.title), aspectRatio: args.aspectRatio, ownerId, createdAt: now, updatedAt: now, timeline, revision: 0, history: [] });
  const used = new Set<string>();
  const copies = new Map<string, import('./_generated/dataModel').Id<'assets'>>();
  const stored = new Map<string, import('./_generated/dataModel').Id<'assets'>>();
  for (const source of sources) {
    if (!source) continue;
    const { _id, _creationTime, audioAssetId, ...metadata } = source;
    const key = source.r2Key ?? source.storageId!;
    const copy = stored.get(key) ?? await ctx.db.insert('assets', { ...metadata, projectId, createdAt: now });
    stored.set(key, copy); copies.set(_id, copy);
  }
  for (const source of sources) {
    if (source?.kind !== 'video' || !source.audioAssetId) continue;
    let audioId = copies.get(source.audioAssetId);
    if (!audioId) {
      const audio = await ctx.db.get(source.audioAssetId);
      if (!audio || audio.ownerId !== ownerId || audio.kind !== 'audio') throw new ConvexError('Saved audio is unavailable');
      const { _id, _creationTime, ...metadata } = audio;
      const key = audio.r2Key ?? audio.storageId!;
      audioId = stored.get(key) ?? await ctx.db.insert('assets', { ...metadata, projectId, createdAt: now });
      stored.set(key, audioId);
      copies.set(_id, audioId);
    }
    await ctx.db.patch(copies.get(source._id)!, { audioAssetId: audioId });
  }
  if (stored.size > 200) throw new ConvexError('Choose fewer sources: a project supports 200 video and audio files');
  for (const source of sources) {
    if (!source) continue;
    const key = source.r2Key ?? source.storageId!;
    if (used.has(key)) continue;
    used.add(key);
    if (sources.some(video => video?.kind === 'video' && video.audioAssetId === source._id)) continue;
    const assetId = copies.get(source._id)!;
    const group = layerGroup(source.kind);
    const end = timelineDuration({ ...timeline, clips: timeline.clips.filter(clip => layerGroup(clip.kind) === group) });
    const duration = source.kind === 'image' ? 5 : source.duration ?? 5;
    if (duration >= 1 / timeline.fps) {
      const clipId = crypto.randomUUID();
      timeline = patchClip(addMediaClip(timeline, { _id: assetId, kind: source.kind, duration, ...(source.audioAssetId ? { audioAssetId: copies.get(source.audioAssetId) } : {}) }, clipId), clipId, { duration });
    }
  }
  if (timeline.clips.length) {
    const project = (await ctx.db.get(projectId))!;
    timeline = await validateTimeline(ctx, project, timeline);
    await ctx.db.patch(projectId, { timeline });
  }
  return projectId;
}});
export const get = query({ args: { projectId: v.id("projects") }, returns: projectDocument, handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); return { ...project, timeline: currentTimeline(project), ...(project.history ? { history: project.history.map(normalizeTimeline) } : {}), revision: project.revision ?? 0 };
}});
export const list = query({ args: { limit: v.optional(v.number()) }, returns: v.array(v.object({ _id: v.id('projects'), title: v.string(), createdAt: v.number(), updatedAt: v.number(), aspectRatio, clipCount: v.number(), aiRunning: v.boolean(), coverUrl: v.union(v.string(), v.null()), coverKind: v.union(v.literal("video"), v.literal("image"), v.null()) })), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); const projects = await ctx.db.query("projects").withIndex("by_ownerId_updatedAt", q => q.eq("ownerId", ownerId)).order("desc").take(listLimit(args.limit));
  return await Promise.all(projects.map(async project => {
    const media = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", project._id)).order("desc").take(5);
    const cover = media.find(asset => asset.kind === "video" || asset.kind === "image");
    return { _id: project._id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, aspectRatio: project.aspectRatio, clipCount: project.timeline?.clips.length ?? 0, aiRunning: !!project.aiRunning, coverUrl: cover ? await mediaUrl(ctx, cover) : null, coverKind: cover ? cover.kind as "video" | "image" : null };
  }));
}});
export const update = mutation({ args: { projectId: v.id("projects"), title: v.optional(v.string()), aspectRatio: v.optional(aspectRatio) }, returns: v.null(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); await requireEditorAccess(ctx, project.ownerId);
  if (args.aspectRatio !== undefined) await commitTimeline(ctx, project, { ...currentTimeline(project), aspectRatio: args.aspectRatio }, project.revision ?? 0);
  if (args.title !== undefined) await ctx.db.patch(project._id, { title: projectTitle(args.title), updatedAt: Date.now() });
  return null;
}});
export const saveTimeline = mutation({ args: { projectId: v.id("projects"), timeline: timelineValidator, baseTimeline: v.optional(timelineValidator), expectedRevision: v.number() }, returns: v.object({ revision: v.number(), timeline: timelineValidator }), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); await requireEditorAccess(ctx, project.ownerId);
  let timeline = await validateTimeline(ctx, project, args.timeline);
  let expectedRevision = args.expectedRevision;
  if (args.baseTimeline) {
    if (serializedBytes(args.baseTimeline) > 150_000) throw new ConvexError('Timeline is too large');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > (project.revision ?? 0)) throw new ConvexError('Invalid timeline revision');
    timeline = applyTimelineEdit(args.baseTimeline, timeline, currentTimeline(project));
    expectedRevision = project.revision ?? 0;
  }
  const revision = await commitTimeline(ctx, project, timeline, expectedRevision);
  return { revision, timeline: normalizeTimeline(timeline) };
}});
export const undo = mutation({ args: { projectId: v.id("projects") }, returns: v.number(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); await requireEditorAccess(ctx, project.ownerId); const history = (project.history ?? []).map(normalizeTimeline); const previous = history.pop();
  if (!previous) throw new ConvexError("No edits to undo"); const revision = (project.revision ?? 0) + 1;
  await ctx.db.patch(project._id, { timeline: previous, aspectRatio: previous.aspectRatio, history, revision, updatedAt: Date.now() }); return revision;
}});
export const remove = mutation({ args: { projectId: v.id("projects") }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); const project = await requireProject(ctx, args.projectId, ownerId);
  const assets = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", project._id)).take(201);
  const jobs = await ctx.db.query("renderJobs").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", project._id)).take(501);
  const tickets = await ctx.db.query("uploadTickets").withIndex("by_projectId", q => q.eq("projectId", project._id)).take(1001);
  const analysisRequests = await ctx.db.query("analysisRequests").withIndex("by_projectId", q => q.eq("projectId", project._id)).take(201);
  const pendingUploads = await ctx.db.query("r2Uploads").withIndex("by_projectId_completed", q => q.eq("projectId", project._id).eq("completed", false)).take(201);
  const mediaTasks = await ctx.db.query('mediaTasks').withIndex('by_project_createdAt', q => q.eq('projectId', project._id)).take(1001);
  if (assets.length > 200 || jobs.length > 500 || tickets.length > 1000 || analysisRequests.length > 200 || pendingUploads.length > 200 || mediaTasks.length > 1000) throw new ConvexError("Project has too many records to delete at once");
  if (jobs.some(job => job.status === "rendering") || project.aiRunning) throw new ConvexError("Wait for the active render or AI edit before deleting the project");
  for (const task of mediaTasks) { await cancelMediaTask(ctx, task._id); await ctx.db.delete(task._id); }
  for (const asset of assets) await removeMediaAttachment(ctx, asset);
  for (const job of jobs) { if (job.outputStorageId) await ctx.storage.delete(job.outputStorageId); if (job.outputR2Key) await ctx.scheduler.runAfter(0, internal.r2.deleteObject, { key: job.outputR2Key }); await ctx.db.delete(job._id); }
  for (const ticket of tickets) { if (ticket.storageId && !ticket.consumed) await ctx.storage.delete(ticket.storageId); await ctx.db.delete(ticket._id); }
  for (const request of analysisRequests) await ctx.db.delete(request._id);
  for (const upload of pendingUploads) await ctx.scheduler.runAfter(0, internal.r2.cleanupLease, { uploadId: upload._id });
  if (project.threadId) await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: project.threadId });
  await ctx.db.delete(project._id); return null;
}});
