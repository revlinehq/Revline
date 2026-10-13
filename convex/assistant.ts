import { requireEditorAccess } from './lib/billing_access';
import { abortStream, createThread, listStreams, listUIMessages, saveMessage, syncStreams, vPaginationResult, vStreamArgs } from "@convex-dev/agent";
import { vStreamDelta, vStreamMessage } from "@convex-dev/agent/validators";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireOwner, requireProject } from "./lib/auth";
import { commitTimeline, currentTimeline, validateTimeline } from "./lib/timeline";
import { analysisMode, analysisRequestDocument, assetDocument, projectDocument, timelineValidator } from "./schema";
import { normalizeTimeline } from '../lib/editor/types';
import { enqueueMediaTask, cancelMediaTask } from './mediaTasks';
const providerReason = "Claude editing requires ANTHROPIC_API_KEY in Convex, or AI_GATEWAY_ENABLED=true on an eligible paid Convex team.";
function configured() { return !!process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_ENABLED === "true"; }
export const status = query({ args: { projectId: v.id("projects") }, returns: v.object({ configured: v.boolean(), running: v.boolean(), error: v.union(v.string(), v.null()), reason: v.union(v.string(), v.null()) }), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx)); return { configured: configured(), running: project.aiRunning ?? false, error: project.aiError ?? null, reason: configured() ? null : providerReason };
}});
export const send = mutation({ args: { projectId: v.id("projects"), prompt: v.string(), selectedClipId: v.optional(v.string()), selectedClipIds: v.optional(v.array(v.string())), playhead: v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); const project = await requireProject(ctx, args.projectId, ownerId);
  const clipIds = new Set(currentTimeline(project).clips.map(clip => clip.id));
  if (args.selectedClipId !== undefined && !clipIds.has(args.selectedClipId)) throw new ConvexError("Selected clip does not belong to this project");
  if (args.selectedClipIds) {
    if (args.selectedClipIds.length > 200) throw new ConvexError("Select at most 200 clips");
    if (new Set(args.selectedClipIds).size !== args.selectedClipIds.length) throw new ConvexError("Selected clips must be unique");
    if (args.selectedClipIds.some(id => !clipIds.has(id))) throw new ConvexError("Selected clips must belong to this project");
  }
  if (args.playhead !== undefined && (!Number.isFinite(args.playhead) || args.playhead < 0 || args.playhead > 300)) throw new ConvexError("Playhead must be between 0 and 300 seconds");
  if (!configured()) throw new ConvexError(providerReason);
  const prompt = args.prompt.trim(); if (!prompt || prompt.length > 8000) throw new ConvexError("Write a prompt between 1 and 8000 characters");
  if (project.aiRunning) throw new ConvexError("Wait for the current AI edit to finish");
  const threadId = project.threadId ?? await createThread(ctx, components.agent, { userId: ownerId, title: project.title });
  const { messageId } = await saveMessage(ctx, components.agent, { threadId, userId: ownerId, prompt });
  const runId = `${Date.now()}-${Math.random()}`;
  await ctx.db.patch(project._id, { threadId, aiRunning: true, aiError: undefined, aiRunId: runId, aiUndoRecorded: false, aiCheckpointRevision: undefined });
  await ctx.scheduler.runAfter(0, internal.assistantActions.respond, { projectId: project._id, ownerId, runId, threadId, promptMessageId: messageId, ...(args.selectedClipId ? { selectedClipId: args.selectedClipId } : {}), ...(args.selectedClipIds ? { selectedClipIds: args.selectedClipIds } : {}), ...(args.playhead !== undefined ? { playhead: args.playhead } : {}) }); return null;
}});
export const messages = query({
  args: { projectId: v.id("projects"), threadId: v.string(), paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs },
  // AI SDK UI parts are polymorphic; agent validates and converts their stored representation.
  returns: v.object({ ...vPaginationResult(v.any()).fields, streams: v.union(v.object({ kind: v.literal("list"), messages: v.array(vStreamMessage) }), v.object({ kind: v.literal("deltas"), deltas: v.array(vStreamDelta) })) }),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, await requireOwner(ctx));
    if (args.paginationOpts.numItems < 0 || args.paginationOpts.numItems > 100 || (args.paginationOpts.numItems === 0 && !args.streamArgs)) throw new ConvexError("Message pages must contain between 1 and 100 messages");
    if (project.threadId && args.threadId !== project.threadId) throw new ConvexError("Conversation not found");
    if (!project.threadId) return { page: [], isDone: true, continueCursor: "", streams: args.streamArgs?.kind === "deltas" ? { kind: "deltas" as const, deltas: [] } : { kind: "list" as const, messages: [] } };
    const page = args.paginationOpts.numItems === 0 ? { page: [], isDone: true, continueCursor: "" } : await listUIMessages(ctx, components.agent, { threadId: project.threadId, paginationOpts: args.paginationOpts });
    const streams = await syncStreams(ctx, components.agent, { threadId: project.threadId, streamArgs: args.streamArgs });
    return { ...page, streams: streams ?? { kind: "list" as const, messages: [] } };
  },
});
const runArgs = { projectId: v.id("projects"), ownerId: v.string(), runId: v.string() };
export const stop = mutation({ args: { projectId: v.id('projects') }, returns: v.null(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx));
  if (!project.aiRunning) return null;
  if (project.threadId) {
    const streams = await listStreams(ctx, components.agent, { threadId: project.threadId, includeStatuses: ['streaming'] });
    for (const stream of streams) await abortStream(ctx, components.agent, { streamId: stream.streamId, reason: 'Stopped by the user' });
  }
  if (project.aiRunId) {
    const requests = await ctx.db.query('analysisRequests').withIndex('by_projectId_runId', q => q.eq('projectId', project._id).eq('aiRunId', project.aiRunId!)).take(16);
    for (const request of requests) { if (request.taskId) await cancelMediaTask(ctx, request.taskId); await ctx.db.delete(request._id); }
  }
  // Already-saved edits remain undoable; invalidating the run blocks every later checkpoint.
  await ctx.db.patch(project._id, { aiRunning: false, aiRunId: undefined, aiError: undefined });
  return null;
}});
export const isRunActive = internalQuery({ args: runArgs, returns: v.boolean(), handler: async (ctx, args) => {
  const project = await ctx.db.get(args.projectId);
  return !!project && project.ownerId === args.ownerId && project.aiRunId === args.runId && project.aiRunning === true;
}});
export const getRun = internalQuery({ args: runArgs, returns: v.object({ project: projectDocument, assets: v.array(assetDocument) }), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId);
  if (project.aiRunId !== args.runId || !project.aiRunning) throw new ConvexError("AI run is no longer active");
  const assets = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", args.ownerId).eq("projectId", project._id)).take(200);
  return { project: { ...project, timeline: currentTimeline(project), ...(project.history ? { history: project.history.map(normalizeTimeline) } : {}) }, assets };
}});
export const apply = internalMutation({ args: { ...runArgs, expectedRevision: v.number(), timeline: timelineValidator }, returns: v.number(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId);
  if (project.aiRunId !== args.runId || !project.aiRunning) throw new ConvexError("AI run is no longer active");
  if (project.aiUndoRecorded && project.aiCheckpointRevision === args.expectedRevision) {
    if ((project.revision ?? 0) !== args.expectedRevision) throw new ConvexError("The timeline changed elsewhere. Reload before saving.");
    const timeline = await validateTimeline(ctx, project, args.timeline);
    const revision = args.expectedRevision + 1;
    await ctx.db.patch(project._id, { timeline, aspectRatio: timeline.aspectRatio, revision, aiCheckpointRevision: revision, updatedAt: Date.now() }); return revision;
  }
  const revision = await commitTimeline(ctx, project, args.timeline, args.expectedRevision);
  await ctx.db.patch(project._id, { aiUndoRecorded: true, aiCheckpointRevision: revision }); return revision;
}});
export const finish = internalMutation({ args: { ...runArgs, error: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const project = await ctx.db.get(args.projectId);
  if (project?.ownerId === args.ownerId && project.aiRunId === args.runId) {
    const requests = await ctx.db.query("analysisRequests").withIndex("by_projectId_runId", q => q.eq("projectId", args.projectId).eq("aiRunId", args.runId)).take(16);
    for (const request of requests) await ctx.db.delete(request._id);
    await ctx.db.patch(project._id, { aiRunning: false, aiError: args.error?.slice(0, 1000) });
  }
  return null;
}});

export const requestAnalysis = internalMutation({ args: { ...runArgs, assetId: v.string(), mode: analysisMode }, returns: v.id("analysisRequests"), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId);
  if (!project.aiRunning || project.aiRunId !== args.runId) throw new ConvexError("AI run is no longer active");
  const assetId = ctx.db.normalizeId("assets", args.assetId); const asset = assetId ? await ctx.db.get(assetId) : null;
  if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId || asset.kind === "image" || ((args.mode === "understand" || args.mode === "shots" || args.mode === "track") && asset.kind !== "video")) throw new ConvexError("Choose suitable media from this project");
  const requests = await ctx.db.query("analysisRequests").withIndex("by_projectId_runId", q => q.eq("projectId", project._id).eq("aiRunId", args.runId)).take(16);
  if (requests.length >= 15) throw new ConvexError("Too many analysis requests in one AI run");
  const requestId = await ctx.db.insert("analysisRequests", { ownerId: args.ownerId, projectId: project._id, assetId: asset._id, aiRunId: args.runId, mode: args.mode, status: "pending", createdAt: Date.now(), expiresAt: Date.now() + 240_000 });
  const taskId = await enqueueMediaTask(ctx, { ownerId: args.ownerId, projectId: project._id, assetId: asset._id, kind: args.mode, analysisRequestId: requestId });
  await ctx.db.patch(requestId, { taskId });
  return requestId;
}});
export const analysisRequest = internalQuery({ args: { ...runArgs, requestId: v.id("analysisRequests") }, returns: analysisRequestDocument, handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId); const request = await ctx.db.get(args.requestId);
  if (!project.aiRunning || project.aiRunId !== args.runId || !request || request.ownerId !== args.ownerId || request.projectId !== project._id || request.aiRunId !== args.runId) throw new ConvexError("AI analysis request is no longer active");
  return request;
}});
export const clearAnalysis = internalMutation({ args: { ...runArgs, requestId: v.id("analysisRequests") }, returns: v.null(), handler: async (ctx, args) => {
  const request = await ctx.db.get(args.requestId);
  if (request?.ownerId === args.ownerId && request.projectId === args.projectId && request.aiRunId === args.runId) await ctx.db.delete(request._id);
  return null;
}});
