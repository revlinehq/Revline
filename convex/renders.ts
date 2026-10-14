import { recordStorageObject, forgetStorageObject } from './lib/storage_accounting';
import { internal } from './_generated/api';
import { requireEditorAccess } from './lib/billing_access';
import { mediaUrl } from './lib/media_storage';
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { listLimit, requireOwner, requireProject } from "./lib/auth";
import { currentTimeline, validateTimeline } from "./lib/timeline";
import { assetWithUrl, renderDocument, timelineValidator } from "./schema";
import { consumeUpload, issueUpload } from "./uploads";
import { MAX_EXPORT_SECONDS } from '../lib/editor/limits';
import { normalizeTimeline, timelineDuration } from '../lib/editor/types';
import { enqueueMediaTask } from './mediaTasks';
const workerArgs = { jobId: v.id("renderJobs"), workerSecret: v.string() };
async function requireJob(ctx: MutationCtx, jobId: Id<"renderJobs">, workerSecret: string) {
  const secret = process.env.RENDER_WORKER_SECRET;
  if (!secret || workerSecret !== secret) throw new ConvexError("Render worker authentication required");
  const ownerId = await requireOwner(ctx); const job = await ctx.db.get(jobId);
  if (!job || job.ownerId !== ownerId) throw new ConvexError("Render not found");
  await requireProject(ctx, job.projectId, ownerId); return job;
}
export const start = mutation({ args: { projectId: v.id("projects"), resolution: v.number(), fps: v.number(), quality: v.string() }, returns: v.id("renderJobs"), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); const project = await requireProject(ctx, args.projectId, ownerId);
  if (![720, 1080].includes(args.resolution) || ![24, 30, 60].includes(args.fps) || !["draft", "standard", "high"].includes(args.quality)) throw new ConvexError("Invalid export settings");
  const timeline = await validateTimeline(ctx, project, currentTimeline(project)); if (!timeline.clips.length) throw new ConvexError("Add a clip before exporting");
  if (timelineDuration(timeline) > MAX_EXPORT_SECONDS) throw new ConvexError("Exports currently support up to five minutes. Shorten the final edit before exporting; your full arrangement remains saved.");
  const active = await ctx.db.query("renderJobs").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", project._id)).order("desc").take(501);
  if (active.length > 500) throw new ConvexError("Render history is full");
  if (active.some(job => job.status === "queued" || job.status === "rendering")) throw new ConvexError("A render is already in progress");
  const assetIds: Id<"assets">[] = [];
  for (const clip of timeline.clips) if (clip.assetId) { const id = ctx.db.normalizeId("assets", clip.assetId)!; if (!assetIds.includes(id)) assetIds.push(id); }
  const now = Date.now();
  const jobId = await ctx.db.insert("renderJobs", { ownerId, projectId: project._id, timeline, assetIds, resolution: args.resolution, fps: args.fps, quality: args.quality, status: "queued", progress: 0, createdAt: now, updatedAt: now });
  const taskId = await enqueueMediaTask(ctx, { ownerId, projectId: project._id, kind: 'render', renderJobId: jobId });
  await ctx.db.patch(jobId, { taskId });
  return jobId;
}});
export const claim = mutation({ args: workerArgs, returns: v.object({ projectId: v.id("projects"), timeline: timelineValidator, assets: v.array(assetWithUrl), resolution: v.number(), fps: v.number(), quality: v.string() }), handler: async (ctx, args) => {
  const job = await requireJob(ctx, args.jobId, args.workerSecret);
  if (job.status !== "queued" || !job.timeline) throw new ConvexError("Render cannot be claimed");
  const assets = [];
  for (const assetId of job.assetIds ?? []) { const asset = await ctx.db.get(assetId); if (!asset || asset.ownerId !== job.ownerId || asset.projectId !== job.projectId) throw new ConvexError("Render media not found"); const url = await mediaUrl(ctx, asset); if (!url) throw new ConvexError("Render media storage not found"); assets.push({ ...asset, url }); }
  const timeline = normalizeTimeline(job.timeline);
  await ctx.db.patch(job._id, { status: "rendering", timeline, updatedAt: Date.now() });
  return { projectId: job.projectId, timeline, assets, resolution: job.resolution ?? 1080, fps: job.fps ?? timeline.fps, quality: job.quality ?? "high" };
}});
export const progress = mutation({ args: { ...workerArgs, progress: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const job = await requireJob(ctx, args.jobId, args.workerSecret);
  if (job.status !== "rendering") throw new ConvexError("Render is not running");
  if (!Number.isFinite(args.progress) || args.progress < (job.progress ?? 0) || args.progress > 99) throw new ConvexError("Render progress must increase from 0 to 99");
  await ctx.db.patch(job._id, { progress: args.progress, updatedAt: Date.now() }); return null;
}});
export const generateUploadUrl = mutation({ args: workerArgs, returns: v.string(), handler: async (ctx, args) => {
  const job = await requireJob(ctx, args.jobId, args.workerSecret); if (job.status !== "rendering") throw new ConvexError("Render is not running");
  return await issueUpload(ctx, job.ownerId, job.projectId, job._id);
}});
export const complete = mutation({ args: { ...workerArgs, storageId: v.id("_storage") }, returns: v.null(), handler: async (ctx, args) => {
  const job = await requireJob(ctx, args.jobId, args.workerSecret); if (job.status !== "rendering") throw new ConvexError("Render is not running");
  const file = await ctx.db.system.get(args.storageId); if (!file || file.contentType !== "video/mp4") throw new ConvexError("Render output must be an uploaded MP4");
  await consumeUpload(ctx, args.storageId, job.ownerId, job.projectId, job._id);
  await recordStorageObject(ctx,{ownerId:job.ownerId,storageId:args.storageId,fileName:"Export.mp4",kind:"export",size:file.size,createdAt:job.createdAt,jobId:job._id});
  await ctx.db.patch(job._id, { outputSize:file.size,status: "completed", outputStorageId: args.storageId, progress: 100, updatedAt: Date.now() }); return null;
}});
export const fail = mutation({ args: { ...workerArgs, error: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const job = await requireJob(ctx, args.jobId, args.workerSecret); if (job.status !== "queued" && job.status !== "rendering") throw new ConvexError("Render is already finished");
  await ctx.db.patch(job._id, { status: "failed", error: args.error.slice(0, 1000), updatedAt: Date.now() }); return null;
}});
export const get = query({ args: { jobId: v.id("renderJobs") }, returns: renderDocument, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); const job = await ctx.db.get(args.jobId); if (!job || job.ownerId !== ownerId) throw new ConvexError("Render not found");
  return { ...job, ...(job.timeline ? { timeline: normalizeTimeline(job.timeline) } : {}), url: await mediaUrl(ctx, { storageId: job.outputStorageId, r2Key: job.outputR2Key }) };
}});
export const list = query({ args: { projectId: v.id("projects"), limit: v.optional(v.number()) }, returns: v.array(renderDocument), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId);
  const jobs = await ctx.db.query("renderJobs").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", args.projectId)).order("desc").take(listLimit(args.limit));
  return await Promise.all(jobs.map(async job => ({ ...job, ...(job.timeline ? { timeline: normalizeTimeline(job.timeline) } : {}), url: await mediaUrl(ctx, { storageId: job.outputStorageId, r2Key: job.outputR2Key }) })));
}});

export async function removeOwnedExport(ctx:MutationCtx,ownerId:string,jobId:Id<'renderJobs'>) {
  const job=await ctx.db.get(jobId);
  if(!job||job.ownerId!==ownerId)throw new ConvexError('Export not found');
  if(job.status==='queued'||job.status==='rendering')throw new ConvexError('Wait for this export to finish');
  if(job.outputStorageId)await ctx.storage.delete(job.outputStorageId);
  if(job.outputR2Key)await ctx.scheduler.runAfter(0,internal.r2.deleteObject,{key:job.outputR2Key});
  await forgetStorageObject(ctx,ownerId,{storageId:job.outputStorageId,r2Key:job.outputR2Key});
  await ctx.db.delete(job._id);return null;
}
