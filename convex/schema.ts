import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const aspectRatio = v.union(v.literal("vertical"), v.literal("square"), v.literal("landscape"), v.literal("portrait-feed"), v.literal("classic"));
export const assetKind = v.union(v.literal("video"), v.literal("audio"), v.literal("image"));
export const waveformValidator = v.object({ peaks: v.string(), samplesPerSecond: v.number() });
export const focusValidator = v.array(v.object({ time: v.number(), x: v.number(), y: v.number() }));
export const clipValidator = v.object({
  id: v.string(), kind: v.union(assetKind, v.literal("caption"), v.literal("graphic")),
  assetId: v.optional(v.string()), focus: v.optional(focusValidator), track: v.optional(v.number()), start: v.number(), duration: v.number(), sourceStart: v.number(),
  transform: v.optional(v.object({ x: v.number(), y: v.number(), scale: v.number(), rotation: v.number(), opacity: v.number() })),
  crop: v.optional(v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() })),
  fit: v.optional(v.union(v.literal("cover"), v.literal("contain"))),
  text: v.optional(v.string()), fontSize: v.optional(v.number()), color: v.optional(v.string()),
  background: v.optional(v.string()), x: v.optional(v.number()), y: v.optional(v.number()), volume: v.optional(v.number()),
  linkedClipId: v.optional(v.string()), audioSeparated: v.optional(v.boolean()),
  animation: v.optional(v.union(v.literal("none"), v.literal("fade"), v.literal("rise"))),
});
export const timelineValidator = v.object({ clips: v.array(clipValidator), fps: v.number(), aspectRatio, tracks: v.optional(v.object({ visual: v.number(), overlay: v.number(), audio: v.number() })) });
export const projectFields = {
  title: v.string(), ownerId: v.string(), aspectRatio, createdAt: v.number(), updatedAt: v.number(),
  timeline: v.optional(timelineValidator), revision: v.optional(v.number()), history: v.optional(v.array(timelineValidator)),
  threadId: v.optional(v.string()), aiRunning: v.optional(v.boolean()), aiError: v.optional(v.string()), aiRunId: v.optional(v.string()), aiUndoRecorded: v.optional(v.boolean()), aiCheckpointRevision: v.optional(v.number()),
};
export const projectDocument = v.object({ _id: v.id("projects"), _creationTime: v.number(), ...projectFields });
export const timedText = v.object({ start: v.number(), end: v.number(), text: v.string() });
export const transcriptValidator = v.object({ segments: v.array(timedText), words: v.array(timedText) });
export const understandingValidator = v.object({ summary: v.string(), scenes: v.array(v.object({ start: v.number(), end: v.number(), description: v.string(), score: v.number() })) });
export const shotsValidator = v.object({ fps: v.number(), shots: v.array(v.object({ start: v.number(), end: v.number(), startFrame: v.number(), endFrame: v.number() })) });
export const beatsValidator = v.object({ beats: v.array(v.number()), bpm: v.number(), confidence: v.number() });
export const analysisValidator = v.object({ transcript: v.optional(transcriptValidator), understanding: v.optional(understandingValidator), shots: v.optional(shotsValidator), beats: v.optional(beatsValidator), focus: v.optional(focusValidator) });
export const analysisMode = v.union(v.literal("transcribe"), v.literal("understand"), v.literal("shots"), v.literal("beats"), v.literal("track"));
const analysisRequestFields = { ownerId: v.string(), projectId: v.id("projects"), assetId: v.id("assets"), aiRunId: v.string(), mode: analysisMode, taskId: v.optional(v.id('mediaTasks')), status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")), error: v.optional(v.string()), createdAt: v.number(), expiresAt: v.number() };
export const analysisRequestDocument = v.object({ _id: v.id("analysisRequests"), _creationTime: v.number(), ...analysisRequestFields });
export const assetFields = {
  ownerId: v.string(), projectId: v.id("projects"), storageId: v.optional(v.id("_storage")), r2Key: v.optional(v.string()), fileName: v.string(),
  contentType: v.string(), size: v.number(), kind: assetKind, createdAt: v.number(),
  duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()), analysis: v.optional(analysisValidator), analysisUpdatedAt: v.optional(v.number()),
  audioAssetId: v.optional(v.id("assets")), audioExtracted: v.optional(v.boolean()),
  waveform: v.optional(waveformValidator),
  analysisCompletedAt: v.optional(v.object({ transcribe: v.optional(v.number()), understand: v.optional(v.number()), shots: v.optional(v.number()), beats: v.optional(v.number()), track: v.optional(v.number()) })),
};
export const assetDocument = v.object({ _id: v.id("assets"), _creationTime: v.number(), ...assetFields });
export const assetWithUrl = v.object({ _id: v.id("assets"), _creationTime: v.number(), ...assetFields, url: v.union(v.string(), v.null()) });
export const renderFields = {
  ownerId: v.string(), projectId: v.id("projects"),
  status: v.union(v.literal("queued"), v.literal("rendering"), v.literal("completed"), v.literal("failed")),
  outputStorageId: v.optional(v.id("_storage")), outputR2Key: v.optional(v.string()), error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  timeline: v.optional(timelineValidator), resolution: v.optional(v.number()), fps: v.optional(v.number()), quality: v.optional(v.string()),
  progress: v.optional(v.number()), assetIds: v.optional(v.array(v.id("assets"))), taskId: v.optional(v.id('mediaTasks')),
};
export const renderDocument = v.object({ _id: v.id("renderJobs"), _creationTime: v.number(), ...renderFields, url: v.union(v.string(), v.null()) });
export const r2UploadFields = {
    ownerId: v.string(), projectId: v.id("projects"), jobId: v.optional(v.id("renderJobs")), taskId: v.optional(v.id('mediaTasks')), taskLeaseToken: v.optional(v.string()),
    key: v.string(), uploadId: v.string(), fileName: v.string(), contentType: v.string(), kind: assetKind,
    size: v.number(), partSize: v.number(), duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()),
    expiresAt: v.number(), assetId: v.optional(v.id("assets")), completed: v.optional(v.boolean()),
};
export const r2UploadDocument = v.object({ _id: v.id("r2Uploads"), _creationTime: v.number(), ...r2UploadFields });
export const userFields = {
  clerkId: v.string(), email: v.optional(v.string()), name: v.optional(v.string()), imageUrl: v.optional(v.string()),
  createdAt: v.number(), updatedAt: v.number(),
};
export const userDocument = v.object({ _id: v.id("users"), _creationTime: v.number(), ...userFields });
export const mediaTaskKind = v.union(analysisMode, v.literal('extract'), v.literal('waveform'), v.literal('render'));
export const mediaTaskStatus = v.union(v.literal('queued'), v.literal('running'), v.literal('retrying'), v.literal('completed'), v.literal('failed'), v.literal('cancelled'));
export const mediaTaskFields = {
  ownerId: v.string(), projectId: v.id('projects'), kind: mediaTaskKind,
  assetId: v.optional(v.id('assets')), renderJobId: v.optional(v.id('renderJobs')), analysisRequestId: v.optional(v.id('analysisRequests')),
  status: mediaTaskStatus, workflowId: v.optional(v.string()), attempt: v.number(), progress: v.number(),
  outputAssetId: v.optional(v.id('assets')),
  leaseToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), attemptStartedAt: v.optional(v.number()),
  error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
};
export const mediaTaskDocument = v.object({ _id: v.id('mediaTasks'), _creationTime: v.number(), ...mediaTaskFields });
export default defineSchema({
  mediaTasks: defineTable(mediaTaskFields).index('by_status_createdAt', ['status', 'createdAt']).index('by_asset_kind', ['assetId', 'kind']).index('by_project_createdAt', ['projectId', 'createdAt']),
  users: defineTable(userFields).index("by_clerk_id", ["clerkId"]),
  projects: defineTable(projectFields).index("by_ownerId_updatedAt", ["ownerId", "updatedAt"]),
  assets: defineTable(assetFields).index("by_ownerId_projectId", ["ownerId", "projectId"]).index("by_ownerId_createdAt", ["ownerId", "createdAt"]).index("by_storageId", ["storageId"]).index("by_r2Key", ["r2Key"]),
  renderJobs: defineTable(renderFields).index("by_ownerId_projectId", ["ownerId", "projectId"]).index("by_status_createdAt", ["status", "createdAt"]),
  analysisRequests: defineTable(analysisRequestFields).index("by_projectId_runId", ["projectId", "aiRunId"]).index("by_projectId", ["projectId"]),
  r2Uploads: defineTable(r2UploadFields).index("by_projectId", ["projectId"]).index("by_projectId_completed", ["projectId", "completed"]),
  uploadTickets: defineTable({
    token: v.string(), ownerId: v.string(), projectId: v.id("projects"), jobId: v.optional(v.id("renderJobs")),
    storageId: v.optional(v.id("_storage")), expiresAt: v.number(), consumed: v.boolean(), receiving: v.optional(v.boolean()),
  }).index("by_token", ["token"]).index("by_storageId", ["storageId"]).index("by_projectId", ["projectId"]),
});
