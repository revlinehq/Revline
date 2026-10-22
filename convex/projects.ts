import { shareAnalysis } from './lib/asset_analysis';
import { writeProject,createProject,readProject,projectIdentity } from './lib/project_data';
import { recordAssetStorage } from './lib/storage_accounting';
import { requireEditorAccess } from './lib/billing_access';
import { mediaUrl } from './lib/media_storage';
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { listLimit, requireOwner, requireProject } from "./lib/auth";
import { commitTimeline, currentTimeline, serializedBytes, validateTimeline } from "./lib/timeline";
import { addMediaClip, patchClip } from '../lib/editor/operations';
import { applyTimelineEdit } from '../lib/editor/timeline-sync';
import { normalizeTimeline, type Timeline } from '../lib/editor/types';
import { aspectRatio, projectDocument, timelineValidator } from "./schema";
import { editingWorkflowActive } from './lib/assistant_workflow';
import { equalTimelineValue } from '../lib/editor/timeline-equality';
import { timelineHistoryKey } from '../lib/editor/timeline-history-key';
const workflowLocked = 'Revline is editing your timeline. Wait for it to finish or stop the edit before making changes.';
function projectTitle(value: string) { const title = value.trim(); if (!title || title.length > 120) throw new ConvexError("Title must contain between 1 and 120 characters"); return title; }
export const create = mutation({ args: { title: v.string(), aspectRatio, assetIds: v.optional(v.array(v.id('assets'))) }, returns: v.id("projects"), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); const now = Date.now();
  if ((args.assetIds?.length ?? 0) > 200) throw new ConvexError('Choose up to 200 uploads');
  const sources = await Promise.all([...new Set(args.assetIds ?? [])].map(id => ctx.db.get(id)));
  if (sources.some(asset => !asset || asset.ownerId !== ownerId || (!asset.r2Key && !asset.storageId))) throw new ConvexError('Saved footage is unavailable or belongs to another account');
  let timeline: Timeline = normalizeTimeline({ clips: [], fps: 30, aspectRatio: args.aspectRatio });
  const projectId = await createProject(ctx, { title: projectTitle(args.title), aspectRatio: args.aspectRatio, ownerId, createdAt: now, updatedAt: now, timeline, revision: 0, history: [] });
  const used = new Set<string>();
  const copies = new Map<string, import('./_generated/dataModel').Id<'assets'>>();
  const stored = new Map<string, import('./_generated/dataModel').Id<'assets'>>();
  for (const source of sources) {
    if (!source) continue;
    const { _id, _creationTime, audioAssetId, ...metadata } = await shareAnalysis(ctx,source);
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
      const { _id, _creationTime, ...metadata } = await shareAnalysis(ctx,audio);
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
    const duration = source.kind === 'image' ? 5 : source.duration ?? 5;
    if (duration >= 1 / timeline.fps) {
      const clipId = crypto.randomUUID();
      timeline = patchClip(addMediaClip(timeline, { _id: assetId, kind: source.kind, duration, ...(source.audioAssetId ? { audioAssetId: copies.get(source.audioAssetId) } : {}) }, clipId), clipId, { duration });
    }
  }
  for(const assetId of stored.values())await recordAssetStorage(ctx,(await ctx.db.get(assetId))!);
  if (timeline.clips.length) {
    const project = (await ctx.db.get(projectId))!;
    timeline = await validateTimeline(ctx, project, timeline);
    await writeProject(ctx,projectId, { timeline });
  }
  return projectId;
}});
// Editor URLs are user input: a malformed id is the same typed not-found as a
// deleted or foreign project, never a redacted argument validation error.
function routeProjectId(ctx:QueryCtx,projectId:string){const id=ctx.db.normalizeId('projects',projectId);if(!id)throw new ConvexError('Project not found');return id;}
export const get = query({ args: { projectId: v.string(),includeHistory:v.optional(v.boolean()) }, returns: projectDocument, handler: async (ctx, args) => {
  const projectId=routeProjectId(ctx,args.projectId);
  await projectIdentity(ctx,projectId,await requireOwner(ctx));const project=(await readProject(ctx,projectId,args.includeHistory!==false))!; return { ...project, timeline: currentTimeline(project), ...(project.history ? { history: project.history.map(normalizeTimeline) } : {}), revision: project.revision ?? 0 };
}});
export const history=query({args:{projectId:v.string()},returns:v.array(timelineValidator),handler:async(ctx,args)=>{
  const projectId=routeProjectId(ctx,args.projectId);
  await projectIdentity(ctx,projectId,await requireOwner(ctx));
  const rows=await ctx.db.query('timelineRevisions').withIndex('by_project_sequence',q=>q.eq('projectId',projectId)).order('desc').take(10);
  if(rows.length)return rows.reverse().map(row=>normalizeTimeline(row.timeline));
  const access=await ctx.db.query('projectAccess').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();if(access?.historyStored)return [];
  // Old projects are readable before the bounded migration reaches them.
  const legacy=await ctx.db.get(projectId);return legacy?.history?.map(normalizeTimeline)??[];
}});
export const list = query({ args: { limit: v.optional(v.number()) }, returns: v.array(v.object({ _id: v.id('projects'), title: v.string(), createdAt: v.number(), updatedAt: v.number(), aspectRatio, clipCount: v.number(), aiRunning: v.boolean(), coverUrl: v.union(v.string(), v.null()), coverKind: v.union(v.literal("video"), v.literal("image"), v.null()) })), handler: async (ctx, args) => {
  const migration=await ctx.db.query('projectDataMigration').withIndex('by_key',q=>q.eq('key','project-data-v1')).unique();
  if(migration?.completed){const ownerId=await requireOwner(ctx),rows=await ctx.db.query('projectCatalog').withIndex('by_owner_updated',q=>q.eq('ownerId',ownerId)).filter(q=>q.neq(q.field('deleting'),true)).order('desc').take(listLimit(args.limit));return Promise.all(rows.map(async row=>({_id:row.projectId,title:row.title,createdAt:row.createdAt,updatedAt:row.updatedAt,aspectRatio:row.aspectRatio,clipCount:row.clipCount,aiRunning:row.aiRunning,coverUrl:await mediaUrl(ctx,{storageId:row.coverStorageId,r2Key:row.coverR2Key}),coverKind:row.coverStorageId||row.coverR2Key?'image' as const:null})));}
  const ownerId = await requireOwner(ctx); const projects = await ctx.db.query("projects").withIndex("by_ownerId_updatedAt", q => q.eq("ownerId", ownerId)).filter(q=>q.neq(q.field("deleting"),true)).order("desc").take(listLimit(args.limit));
  return await Promise.all(projects.map(async project => {
    const media = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", project._id)).order("desc").take(5);
    const cover = media.find(asset => asset.kind === "video" || asset.kind === "image");
    return { _id: project._id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, aspectRatio: project.aspectRatio, clipCount: project.timeline?.clips.length ?? 0, aiRunning: !!project.aiRunning, coverUrl: cover ? await mediaUrl(ctx, cover) : null, coverKind: cover ? cover.kind as "video" | "image" : null };
  }));
}});
export const update = mutation({ args: { projectId: v.id("projects"), title: v.optional(v.string()), aspectRatio: v.optional(aspectRatio) }, returns: v.null(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); await requireEditorAccess(ctx, project.ownerId);
  if (args.aspectRatio !== undefined && args.aspectRatio !== currentTimeline(project).aspectRatio) {
    if (await editingWorkflowActive(ctx, project)) throw new ConvexError(workflowLocked);
    await commitTimeline(ctx, project, { ...currentTimeline(project), aspectRatio: args.aspectRatio }, project.revision ?? 0);
  }
  if (args.title !== undefined) await writeProject(ctx,project._id, { title: projectTitle(args.title), updatedAt: Date.now() });
  return null;
}});
export const saveTimeline = mutation({ args: { projectId: v.id("projects"), timeline: timelineValidator, baseTimeline: v.optional(timelineValidator), undoTo: v.optional(timelineValidator), undoHistoryKeys: v.optional(v.array(v.string())), undoTargetKey: v.optional(v.string()), expectedRevision: v.number() }, returns: v.object({ revision: v.number(), timeline: timelineValidator }), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); await requireEditorAccess(ctx, project.ownerId);
  let timeline = args.timeline;
  let undoTo = args.undoTo, undoTargetKey = args.undoTargetKey;
  let expectedRevision = args.expectedRevision;
  if (args.undoTo && serializedBytes(args.undoTo) > 150_000) throw new ConvexError('Timeline is too large');
  if (args.undoHistoryKeys && (!args.undoTo || args.undoHistoryKeys.length > 40 || args.undoHistoryKeys.some(key => !/^[a-f0-9]{64}$/.test(key)))) throw new ConvexError('Invalid undo history');
  if (undoTargetKey !== undefined && (!undoTo || !/^[a-f0-9]{64}$/.test(undoTargetKey))) throw new ConvexError('Invalid undo target');
  if (args.baseTimeline) {
    timeline = await validateTimeline(ctx, project, timeline);
    if (serializedBytes(args.baseTimeline) > 150_000) throw new ConvexError('Timeline is too large');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > (project.revision ?? 0)) throw new ConvexError('Invalid timeline revision');
    const current = currentTimeline(project);
    timeline = applyTimelineEdit(args.baseTimeline, timeline, current);
    if (undoTo) {
      // Keep the original history identity while preserving concurrent changes
      // in both the saved undo and any following gesture's undo target.
      undoTargetKey ??= await timelineHistoryKey(undoTo);
      undoTo = applyTimelineEdit(args.baseTimeline, undoTo, current);
    }
    expectedRevision = project.revision ?? 0;
  }
  if (await editingWorkflowActive(ctx, project)) {
    const current = currentTimeline(project);
    // Late acknowledgements of unchanged data must not invalidate the AI draft.
    if (equalTimelineValue(normalizeTimeline(timeline), current)) return { revision: project.revision ?? 0, timeline: current };
    throw new ConvexError(workflowLocked);
  }
  const revision = await commitTimeline(ctx, project, timeline, expectedRevision, undoTo, args.undoHistoryKeys, undoTargetKey);
  return { revision, timeline: normalizeTimeline(timeline) };
}});
export const undo = mutation({ args: { projectId: v.id("projects") }, returns: v.number(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); await requireEditorAccess(ctx, project.ownerId);
  if (await editingWorkflowActive(ctx, project)) throw new ConvexError(workflowLocked);
  const history = (project.history ?? []).map(normalizeTimeline); const previous = history.pop();
  if (!previous) throw new ConvexError("No edits to undo"); const revision = (project.revision ?? 0) + 1;
  await writeProject(ctx,project._id, { timeline: previous, aspectRatio: previous.aspectRatio, history, revision, updatedAt: Date.now() }); return revision;
}});
export const remove = mutation({ args: { projectId: v.id('projects') }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId=await requireOwner(ctx),project=await requireProject(ctx,args.projectId,ownerId);
  const rendering=await ctx.db.query('renderJobs').withIndex('by_owner_project_status',q=>q.eq('ownerId',ownerId).eq('projectId',project._id).eq('status','rendering')).first();
  if(rendering||project.aiRunning)throw new ConvexError('Wait for the active render or AI edit before deleting the project');
  await writeProject(ctx,project._id,{deleting:true});
  const shares=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',project._id)).take(2);
  for(const share of shares)await ctx.db.patch(share._id,{published:false});
  await ctx.scheduler.runAfter(0,internal.projectDeletion.batch,{projectId:project._id,ownerId});
  return null;
}});
