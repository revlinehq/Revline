import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { BEAT_ANALYSIS_ENGINE } from '../lib/media-analysis/beat-map';

export const aspectRatio = v.union(v.literal("vertical"), v.literal("square"), v.literal("landscape"), v.literal("portrait-feed"), v.literal("classic"));
export const assetKind = v.union(v.literal("video"), v.literal("audio"), v.literal("image"));
export const waveformValidator = v.object({ peaks: v.string(), samplesPerSecond: v.number() });
export const focusValidator = v.array(v.object({ time: v.number(), x: v.number(), y: v.number() }));
export const motionKeyframeValidator = v.object({ time: v.number(), x: v.number(), y: v.number(), scale: v.number(), rotation: v.number(), opacity: v.number(), brightness: v.number() });
export const colorGradeValidator = v.object({ enabled: v.boolean(), exposure: v.number(), contrast: v.number(), saturation: v.number(), temperature: v.number(), tint: v.number(), vibrance: v.number() });
export const zoomBlurValidator = v.object({ enabled: v.boolean(), amount: v.number(), centerX: v.number(), centerY: v.number() });
export const invertValidator = v.object({ enabled: v.boolean(), amount: v.number() });
export const ditherValidator = v.object({ enabled: v.boolean(), amount: v.number(), levels: v.number(), size: v.number(), shadowColor: v.optional(v.string()), highlightColor: v.optional(v.string()) });
export const glitchValidator = v.object({ enabled: v.boolean(), intensity: v.number(), blockSize: v.number(), rgbSplit: v.number() });
export const textTemplateValidator = v.object({ preset: v.union(v.literal('word-reveal'), v.literal('word-pop'), v.literal('slide-title'), v.literal('karaoke'), v.literal('neon-echo'), v.literal('lyric-slam'), v.literal('kinetic-stack')), highlightColor: v.optional(v.string()), duration: v.optional(v.number()), offset: v.optional(v.number()) });
export const textStyleValidator = v.object({strokeWidth:v.number(),strokeColor:v.string(),shadowBlur:v.number(),shadowX:v.number(),shadowY:v.number(),shadowColor:v.string(),glowBlur:v.number(),glowColor:v.string()});
export const audioSettingsValidator=v.object({role:v.union(v.literal('original'),v.literal('voice'),v.literal('music')),fadeIn:v.number(),fadeOut:v.number(),ducking:v.object({enabled:v.boolean(),amount:v.number(),attack:v.number(),release:v.number()})});
export const clipValidator = v.object({
  id: v.string(), kind: v.union(assetKind, v.literal("caption"), v.literal("graphic"), v.literal("effect")),
  assetId: v.optional(v.string()), focus: v.optional(focusValidator), track: v.optional(v.number()), start: v.number(), duration: v.number(), sourceStart: v.number(),
  playbackRate: v.optional(v.number()),
  audio:v.optional(audioSettingsValidator),
  audioFadeTiming:v.optional(v.object({duration:v.number(),offset:v.number()})),
  visualFade:v.optional(v.object({fadeIn:v.number(),fadeOut:v.number()})),
  visualFadeTiming:v.optional(v.object({duration:v.number(),offset:v.number()})),
  frameShrink:v.optional(v.object({size:v.number(),speed:v.number()})),
  zoom:v.optional(v.object({direction:v.union(v.literal('in'),v.literal('out')),amount:v.number(),speed:v.number(),centerX:v.number(),centerY:v.number()})),
  transform: v.optional(v.object({ x: v.number(), y: v.number(), scale: v.number(), rotation: v.number(), opacity: v.number() })),
  crop: v.optional(v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() })),
  fit: v.optional(v.union(v.literal("cover"), v.literal("contain"))),
  text: v.optional(v.string()), fontSize: v.optional(v.number()), color: v.optional(v.string()),
  background: v.optional(v.string()), x: v.optional(v.number()), y: v.optional(v.number()), volume: v.optional(v.number()),
  linkedClipId: v.optional(v.string()), audioSeparated: v.optional(v.boolean()),
  blendMode: v.optional(v.union(v.literal("normal"), v.literal("screen"), v.literal("multiply"), v.literal("overlay"), v.literal("plus-lighter"), v.literal("difference"))),
  motion: v.optional(v.array(motionKeyframeValidator)), motionOffset: v.optional(v.number()),
  colorGrade: v.optional(colorGradeValidator), zoomBlur: v.optional(zoomBlurValidator), glitch: v.optional(glitchValidator), invert: v.optional(invertValidator), dither: v.optional(ditherValidator),
  neonEdges:v.optional(v.object({enabled:v.boolean(),amount:v.number(),color:v.string(),detail:v.number(),threshold:v.number(),glow:v.number()})),
  textTemplate: v.optional(textTemplateValidator),
  textStyle:v.optional(textStyleValidator),
  fontFamily:v.optional(v.union(v.literal('space-grotesk'),v.literal('anton'),v.literal('dm-serif'),v.literal('geist-mono'))),
  effectPreset: v.optional(v.union(v.literal('none'), v.literal('fade'), v.literal('punch'), v.literal('shake'), v.literal('flash'), v.literal('pop'), v.literal('cinematic-bars'), v.literal('quick-zoom-in'), v.literal('quick-zoom-out'),v.literal('frame-shrink'), v.literal('zoom-blur'), v.literal('solid-color'),v.literal('crossfade'),v.literal('spin-zoom'),v.literal('blur-dissolve'))),
  cinematicBars: v.optional(v.object({ size: v.number(), speed: v.number() })),
  solidColor:v.optional(v.object({color:v.string(),width:v.number(),height:v.number(),x:v.number(),y:v.number(),opacity:v.number()})),
  transition:v.optional(v.object({fromClipId:v.string(),toClipId:v.string(),direction:v.union(v.literal('clockwise'),v.literal('counter-clockwise'))})),
  animation: v.optional(v.union(v.literal("none"), v.literal("fade"), v.literal("rise"))),
  textAnimationTiming:v.optional(v.object({duration:v.number(),offset:v.number()})),
});
export const timelineMarkerValidator = v.object({ id: v.string(), time: v.number(), label: v.optional(v.string()) });
export const timelineValidator = v.object({ clips: v.array(clipValidator), fps: v.number(), aspectRatio, tracks: v.optional(v.object({ visual: v.number(), overlay: v.number(), audio: v.number(), effects: v.optional(v.number()) })), markers: v.optional(v.array(timelineMarkerValidator)) });
export const assistantRecoveryValidator = v.object({requests:v.array(v.string()),runId:v.string(),revision:v.number(),savedEdits:v.optional(v.number()),reason:v.string(),status:v.union(v.literal('failed'),v.literal('stopped')),updatedAt:v.number()});
export const projectFields = {
  title: v.string(), ownerId: v.string(), aspectRatio, createdAt: v.number(), updatedAt: v.number(),
  timeline: v.optional(timelineValidator), revision: v.optional(v.number()), history: v.optional(v.array(timelineValidator)),
  threadId: v.optional(v.string()), aiRunning: v.optional(v.boolean()), aiError: v.optional(v.string()), aiRunId: v.optional(v.string()), aiUndoRecorded: v.optional(v.boolean()), aiCheckpointRevision: v.optional(v.number()),
  aiRequest:v.optional(v.object({prompt:v.string(),messageId:v.string(),startedRevision:v.number()})),aiRecovery:v.optional(assistantRecoveryValidator),
};
export const projectDocument = v.object({ _id: v.id("projects"), _creationTime: v.number(), ...projectFields });
export const timedText = v.object({ start: v.number(), end: v.number(), text: v.string() });
export const transcriptValidator = v.object({ segments: v.array(timedText), words: v.array(timedText) });
export const understandingValidator = v.object({ summary: v.string(), scenes: v.array(v.object({ start: v.number(), end: v.number(), description: v.string(), score: v.number() })), suggestions: v.optional(v.array(v.object({ label: v.string(), prompt: v.string(), start: v.number(), end: v.number() }))) });
export const shotsValidator = v.object({ fps: v.number(), sourceTiming: v.optional(v.object({ basis: v.literal('pts'), videoStart: v.number(), videoEnd: v.number(), frameCount: v.number() })), shots: v.array(v.object({ start: v.number(), end: v.number(), startFrame: v.number(), endFrame: v.number() })) });
const audioHitValidator = v.object({ time: v.number(), strength: v.number() });
export const beatsValidator = v.object({ beats: v.array(v.number()), bpm: v.number(), confidence: v.number(), engine: v.optional(v.literal(BEAT_ANALYSIS_ENGINE)), downbeats: v.optional(v.array(v.number())), accents: v.optional(v.array(audioHitValidator)), dropCandidates: v.optional(v.array(audioHitValidator)) });
export const analysisValidator = v.object({ transcript: v.optional(transcriptValidator), understanding: v.optional(understandingValidator), shots: v.optional(shotsValidator), beats: v.optional(beatsValidator), focus: v.optional(focusValidator) });
export const frameRequestValidator = v.object({ start: v.number(), end: v.number(), question: v.string() });
export const frameInspectionValidator = v.object({ ...frameRequestValidator.fields, sourceFps: v.number(), sampleInterval: v.number(), consecutive: v.boolean(), summary: v.string(), uncertainty: v.string(), frames: v.array(v.object({ frameIndex: v.number(), time: v.number(), observation: v.string() })), events: v.array(v.object({ frameIndex: v.number(), time: v.number(), description: v.string(), confidence: v.union(v.literal('low'), v.literal('medium'), v.literal('high')) })) });
export const videoRequestValidator = v.object({ start: v.number(), end: v.number(), question: v.string() });
export const videoInspectionValidator = v.object({ ...videoRequestValidator.fields, summary: v.string(), uncertainty: v.string(), matches: v.array(v.object({ start: v.number(), end: v.number(), description: v.string() })) });
export const analysisMode = v.union(v.literal("transcribe"), v.literal("understand"), v.literal("shots"), v.literal("beats"), v.literal("track"), v.literal('frames'), v.literal('video'));
const analysisRequestFields = { ownerId: v.string(), projectId: v.id("projects"), assetId: v.id("assets"), aiRunId: v.string(), mode: analysisMode, frameRequest: v.optional(frameRequestValidator), frameInspection: v.optional(frameInspectionValidator), videoRequest: v.optional(videoRequestValidator), videoInspection: v.optional(videoInspectionValidator), taskId: v.optional(v.id('mediaTasks')), status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")), error: v.optional(v.string()), createdAt: v.number(), expiresAt: v.number() };
export const analysisRequestDocument = v.object({ _id: v.id("analysisRequests"), _creationTime: v.number(), ...analysisRequestFields });
export const assetFields = {
  ownerId: v.string(), projectId: v.id("projects"), storageId: v.optional(v.id("_storage")), r2Key: v.optional(v.string()), fileName: v.string(),
  contentType: v.string(), size: v.number(), kind: assetKind, createdAt: v.number(),
  duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()), analysis: v.optional(analysisValidator), analysisUpdatedAt: v.optional(v.number()),
  audioAssetId: v.optional(v.id("assets")), audioExtracted: v.optional(v.boolean()),
  waveform: v.optional(waveformValidator),
  thumbnailStorageId: v.optional(v.id('_storage')),
  analysisCompletedAt: v.optional(v.object({ transcribe: v.optional(v.number()), understand: v.optional(v.number()), shots: v.optional(v.number()), beats: v.optional(v.number()), track: v.optional(v.number()) })),
};
export const assetDocument = v.object({ _id: v.id("assets"), _creationTime: v.number(), ...assetFields });
export const assetWithUrl = v.object({ _id: v.id("assets"), _creationTime: v.number(), ...assetFields, url: v.union(v.string(), v.null()), thumbnailUrl:v.optional(v.union(v.string(),v.null())) });
export const renderFields = {
  ownerId: v.string(), projectId: v.id("projects"),
  status: v.union(v.literal("queued"), v.literal("rendering"), v.literal("completed"), v.literal("failed")),
  outputStorageId: v.optional(v.id("_storage")), outputR2Key: v.optional(v.string()), outputSize: v.optional(v.number()), error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
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
export const mediaTaskKind = v.union(analysisMode, v.literal('extract'), v.literal('waveform'), v.literal('render'), v.literal('import'));
export const mediaTaskStatus = v.union(v.literal('queued'), v.literal('running'), v.literal('retrying'), v.literal('completed'), v.literal('failed'), v.literal('cancelled'));
export const mediaTaskFields = {
  ownerId: v.string(), projectId: v.id('projects'), kind: mediaTaskKind,
  assetId: v.optional(v.id('assets')), renderJobId: v.optional(v.id('renderJobs')), analysisRequestId: v.optional(v.id('analysisRequests')),
  status: mediaTaskStatus, workflowId: v.optional(v.string()), attempt: v.number(), progress: v.number(),
  outputAssetId: v.optional(v.id('assets')),
  sourceUrl: v.optional(v.string()),
  frameRequest: v.optional(frameRequestValidator), frameInspection: v.optional(frameInspectionValidator),
  videoRequest: v.optional(videoRequestValidator), videoInspection: v.optional(videoInspectionValidator),
  leaseToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), attemptStartedAt: v.optional(v.number()),
  error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
};
export const mediaTaskDocument = v.object({ _id: v.id('mediaTasks'), _creationTime: v.number(), ...mediaTaskFields });
export const sharedAssetFields = {
  ownerId:v.optional(v.string()),
  sourceId:v.id('assets'), storageId:v.optional(v.id('_storage')), r2Key:v.optional(v.string()),
  fileName:v.string(),contentType:v.string(),size:v.number(),kind:assetKind,
  duration:v.optional(v.number()),width:v.optional(v.number()),height:v.optional(v.number()),
  audioAssetId:v.optional(v.id('assets')),audioExtracted:v.optional(v.boolean()),
  waveform:v.optional(waveformValidator),thumbnailStorageId:v.optional(v.id('_storage')),
};
export const publicMediaAsset = v.object({
  _id:v.string(),fileName:v.string(),kind:assetKind,url:v.union(v.string(),v.null()),
  duration:v.optional(v.number()),width:v.optional(v.number()),height:v.optional(v.number()),
  audioAssetId:v.optional(v.string()),audioExtracted:v.optional(v.boolean()),waveform:v.optional(waveformValidator),thumbnailUrl:v.optional(v.union(v.string(),v.null())),
});
export default defineSchema({
  storageAccounts: defineTable({ ownerId:v.string(), usedBytes:v.number(), reservedBytes:v.number(), videoBytes:v.number(), audioBytes:v.number(), imageBytes:v.number(), exportBytes:v.number(), fileCount:v.number() }).index('by_owner',['ownerId']),
  storageObjects: defineTable({ ownerId:v.string(), objectKey:v.string(), r2Key:v.optional(v.string()), storageId:v.optional(v.id('_storage')), fileName:v.string(), kind:v.union(assetKind,v.literal('export')), size:v.number(), createdAt:v.number(), auxiliary:v.boolean(), pending:v.boolean(), jobId:v.optional(v.id('renderJobs')) })
    .index('by_owner_key',['ownerId','objectKey']).index('by_owner_visible_size',['ownerId','auxiliary','pending','size']).index('by_owner_visible_created',['ownerId','auxiliary','pending','createdAt'])
    .index('by_owner_kind_size',['ownerId','auxiliary','pending','kind','size']).index('by_owner_kind_created',['ownerId','auxiliary','pending','kind','createdAt'])
    .searchIndex('search_name',{searchField:'fileName',filterFields:['ownerId','auxiliary','pending','kind']}),
  storageAccounting: defineTable({ name:v.string(), ready:v.boolean() }).index('by_name',['name']),
  editorEntitlements: defineTable({ ownerId: v.string(), reason: v.string(), grantedAt: v.number(), updatedAt: v.number(), expiresAt: v.optional(v.number()), revokedAt: v.optional(v.number()) }).index('by_owner', ['ownerId']),
  timelineShares:defineTable({projectId:v.id('projects'),ownerId:v.string(),title:v.string(),timeline:timelineValidator,published:v.boolean(),createdAt:v.number(),updatedAt:v.number()}).index('by_project',['projectId']),
  shareAssets:defineTable({shareId:v.id('timelineShares'),...sharedAssetFields}).index('by_share',['shareId']).index('by_storageId',['storageId']).index('by_r2Key',['r2Key']).index('by_thumbnailStorageId',['thumbnailStorageId']).index('by_owner_r2Key',['ownerId','r2Key']).index('by_owner_storageId',['ownerId','storageId']).index('by_owner_thumbnail',['ownerId','thumbnailStorageId']),
  billingCheckouts: defineTable({ ownerId: v.string(), priceId: v.string(), origin: v.string(), trialEligible: v.boolean(), requestId: v.string(), createdAt: v.number(), sessionId: v.optional(v.string()), url: v.optional(v.string()), expiresAt: v.optional(v.number()) }).index('by_owner', ['ownerId']),
  mediaTasks: defineTable(mediaTaskFields).index('by_status_createdAt', ['status', 'createdAt']).index('by_asset_kind', ['assetId', 'kind']).index('by_project_createdAt', ['projectId', 'createdAt']),
  users: defineTable(userFields).index("by_clerk_id", ["clerkId"]),
  projects: defineTable(projectFields).index("by_ownerId_updatedAt", ["ownerId", "updatedAt"]),
  assets: defineTable(assetFields).index("by_ownerId_projectId", ["ownerId", "projectId"]).index("by_ownerId_createdAt", ["ownerId", "createdAt"]).index("by_storageId", ["storageId"]).index("by_r2Key", ["r2Key"]).index('by_thumbnailStorageId',['thumbnailStorageId']).index('by_owner_r2Key',['ownerId','r2Key']).index('by_owner_storageId',['ownerId','storageId']).index('by_owner_thumbnail',['ownerId','thumbnailStorageId']).index('by_owner_audio',['ownerId','audioAssetId']),
  renderJobs: defineTable(renderFields).index("by_ownerId_projectId", ["ownerId", "projectId"]).index("by_status_createdAt", ["status", "createdAt"]).index("by_owner_project_status",["ownerId","projectId","status"]),
  analysisRequests: defineTable(analysisRequestFields).index("by_projectId_runId", ["projectId", "aiRunId"]).index("by_projectId", ["projectId"]),
  r2Uploads: defineTable(r2UploadFields).index("by_projectId", ["projectId"]).index("by_projectId_completed", ["projectId", "completed"]),
  uploadTickets: defineTable({
    token: v.string(), ownerId: v.string(), projectId: v.id("projects"), jobId: v.optional(v.id("renderJobs")),
    storageId: v.optional(v.id("_storage")), expiresAt: v.number(), consumed: v.boolean(), receiving: v.optional(v.boolean()),
  }).index("by_token", ["token"]).index("by_storageId", ["storageId"]).index("by_projectId", ["projectId"]),
});
