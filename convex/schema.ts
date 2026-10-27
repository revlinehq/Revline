import {pinnedClaudeModelValidator} from './lib/claude_model';
import { effectPlanValidator, compositionReviewResult } from './lib/effect_plan';
import { cutoutEffectValidator } from './lib/cutout_effect_validator';
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { BEAT_ANALYSIS_ENGINE } from '../lib/media-analysis/beat-map';
import { aiCostRecordFields } from './lib/ai_cost';
import { alertFields } from './lib/discord_alert';

export const aspectRatio = v.union(v.literal("vertical"), v.literal("square"), v.literal("landscape"), v.literal("portrait-feed"), v.literal("classic"));
export const assetKind = v.union(v.literal("video"), v.literal("audio"), v.literal("image"));
export const waveformValidator = v.object({ peaks: v.string(), samplesPerSecond: v.number() });
export const focusValidator = v.array(v.object({ time: v.number(), x: v.number(), y: v.number() }));
export const motionKeyframeValidator = v.object({ time: v.number(), x: v.number(), y: v.number(), scale: v.number(), rotation: v.number(), opacity: v.number(), brightness: v.number() });
export const smoothZoomValidator = v.object({ start: v.number(), inDuration: v.number(), holdDuration: v.number(), outDuration: v.number(), scale: v.number(), centerX: v.number(), centerY: v.number(), framing: v.optional(v.union(v.literal('anchor'), v.literal('center'))), easing: v.union(v.literal('linear'), v.literal('ease-in-out'), v.literal('ease-out'), v.literal('focused-spring')) });
export const cameraMotionValidator = v.object({ blurAmount:v.optional(v.number()), keyframes:v.array(v.object({time:v.number(),scale:v.number(),centerX:v.number(),centerY:v.number(),easing:smoothZoomValidator.fields.easing})) });
export const colorGradeValidator = v.object({ enabled: v.boolean(), exposure: v.number(), contrast: v.number(), saturation: v.number(), temperature: v.number(), tint: v.number(), vibrance: v.number() });
export const zoomBlurValidator = v.object({ enabled: v.boolean(), amount: v.number(), centerX: v.number(), centerY: v.number() });
export const invertValidator = v.object({ enabled: v.boolean(), amount: v.number() });
export const ditherValidator = v.object({ enabled: v.boolean(), amount: v.number(), levels: v.number(), size: v.number(), shadowColor: v.optional(v.string()), highlightColor: v.optional(v.string()) });
export const glitchValidator = v.object({ enabled: v.boolean(), intensity: v.number(), blockSize: v.number(), rgbSplit: v.number() });
export const textTemplateValidator = v.object({ preset: v.union(v.literal('word-reveal'), v.literal('word-pop'), v.literal('slide-title'), v.literal('karaoke'), v.literal('neon-echo'), v.literal('lyric-slam'), v.literal('kinetic-stack'), v.literal('rgb-split'), v.literal('type-trails'), v.literal('blur-focus'), v.literal('character-scramble'), v.literal('spotlight-sweep'), v.literal('ink-write'), v.literal('tunnel-zoom')), highlightColor: v.optional(v.string()), strength:v.optional(v.number()), revealDuration:v.optional(v.number()), stagger:v.optional(v.number()), duration: v.optional(v.number()), offset: v.optional(v.number()), wordTimings:v.optional(v.array(v.object({start:v.number(),end:v.number()}))) });
export const textGradientValidator = v.object({colors:v.array(v.string()),angle:v.number(),animation:v.optional(v.object({duration:v.number(),direction:v.union(v.literal('forward'),v.literal('reverse')),loop:v.boolean()})),offset:v.optional(v.number())});
export const textStyleValidator = v.object({strokeWidth:v.number(),strokeColor:v.string(),shadowBlur:v.number(),shadowX:v.number(),shadowY:v.number(),shadowColor:v.string(),glowBlur:v.number(),glowColor:v.string(),fontWeight:v.optional(v.number()),italic:v.optional(v.boolean()),letterSpacing:v.optional(v.number()),lineHeight:v.optional(v.number()),textAlign:v.optional(v.union(v.literal('left'),v.literal('center'),v.literal('right'))),paddingX:v.optional(v.number()),paddingY:v.optional(v.number()),borderRadius:v.optional(v.number())});
export const audioSettingsValidator=v.object({role:v.union(v.literal('original'),v.literal('voice'),v.literal('music')),fadeIn:v.number(),fadeOut:v.number(),ducking:v.object({enabled:v.boolean(),amount:v.number(),attack:v.number(),release:v.number()})});
export const clipValidator = v.object({
  id: v.string(), kind: v.union(assetKind, v.literal("caption"), v.literal("graphic"), v.literal("solid"), v.literal("scene"), v.literal("effect")),
  assetId: v.optional(v.string()), focus: v.optional(focusValidator), track: v.optional(v.number()), start: v.number(), duration: v.number(), sourceStart: v.number(),
  playbackRate: v.optional(v.number()),
  audio:v.optional(audioSettingsValidator),
  audioFadeTiming:v.optional(v.object({duration:v.number(),offset:v.number()})),
  visualFade:v.optional(v.object({fadeIn:v.number(),fadeOut:v.number()})),
  visualFadeTiming:v.optional(v.object({duration:v.number(),offset:v.number()})),
  frameShrink:v.optional(v.object({size:v.number(),speed:v.number()})),
  flash:v.optional(v.object({strength:v.number(),attack:v.number(),release:v.number()})),
  punch:v.optional(v.object({amount:v.number(),speed:v.number(),centerX:v.number(),centerY:v.number(),attack:v.optional(v.number()),release:v.optional(v.number())})),
  shake:v.optional(v.object({strength:v.number(),speed:v.number(),direction:v.union(v.literal('both'),v.literal('horizontal'),v.literal('vertical'))})),
  pop:v.optional(v.object({startScale:v.number(),bounce:v.number(),speed:v.number()})),
  zoom:v.optional(v.object({direction:v.union(v.literal('in'),v.literal('out')),amount:v.number(),speed:v.number(),centerX:v.number(),centerY:v.number()})),
  transform: v.optional(v.object({ x: v.number(), y: v.number(), scale: v.number(), rotation: v.number(), opacity: v.number() })),
  crop: v.optional(v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() })),
  fit: v.optional(v.union(v.literal("cover"), v.literal("contain"))),
  text: v.optional(v.string()), fontSize: v.optional(v.number()), color: v.optional(v.string()),
  background: v.optional(v.string()), x: v.optional(v.number()), y: v.optional(v.number()), volume: v.optional(v.number()),
  linkedClipId: v.optional(v.string()), audioSeparated: v.optional(v.boolean()),
  blendMode: v.optional(v.union(v.literal("normal"), v.literal("screen"), v.literal("multiply"), v.literal("overlay"), v.literal("plus-lighter"), v.literal("difference"))),
  motion: v.optional(v.array(motionKeyframeValidator)), motionOffset: v.optional(v.number()),
  smoothZoom: v.optional(smoothZoomValidator), cameraMotion:v.optional(cameraMotionValidator),
  colorGrade: v.optional(colorGradeValidator), zoomBlur: v.optional(zoomBlurValidator), glitch: v.optional(glitchValidator), invert: v.optional(invertValidator), dither: v.optional(ditherValidator),
  neonEdges:v.optional(v.object({enabled:v.boolean(),amount:v.number(),color:v.string(),detail:v.number(),threshold:v.number(),glow:v.number()})),
  softBlur:v.optional(v.object({enabled:v.boolean(),amount:v.number()})),
  frameCorners:v.optional(v.object({enabled:v.boolean(),amount:v.number()})),
  outline:v.optional(v.object({enabled:v.boolean(),color:v.string(),width:v.number(),glow:v.number()})),
  lensDistortion:v.optional(v.object({enabled:v.boolean(),amount:v.number(),centerX:v.number(),centerY:v.number(),fringing:v.number()})),
  frameDistortion:v.optional(v.object({enabled:v.boolean(),horizontal:v.number(),vertical:v.number(),skew:v.number(),bend:v.optional(v.number())})),
  filmOverlay:v.optional(v.object({enabled:v.boolean(),amount:v.number(),grain:v.number(),dust:v.number(),scratches:v.number(),vignette:v.number(),flicker:v.number(),warmth:v.number()})),
  directionalBlur:v.optional(v.object({enabled:v.boolean(),amount:v.number(),angle:v.number()})),
  turbulentDisplace:v.optional(v.object({enabled:v.boolean(),amount:v.number(),scale:v.number(),speed:v.number()})),
  lightSweep:v.optional(v.object({enabled:v.boolean(),amount:v.number(),color:v.string(),angle:v.number(),position:v.number(),width:v.number(),speed:v.number()})),
  vhs:v.optional(v.object({enabled:v.boolean(),amount:v.number(),scanlines:v.number(),noise:v.number(),bleed:v.number(),tracking:v.number(),speed:v.number()})),
  lightLeak:v.optional(v.object({enabled:v.boolean(),amount:v.number(),color:v.string(),position:v.number(),spread:v.number(),speed:v.number()})),
  scene: v.optional(v.object({ title: v.string(), code: v.string() })),
  textTemplate: v.optional(textTemplateValidator),
  textStyle:v.optional(textStyleValidator), textGradient:v.optional(textGradientValidator),
  fontFamily:v.optional(v.union(v.literal('space-grotesk'),v.literal('anton'),v.literal('dm-serif'),v.literal('geist-mono'),v.literal('inter'),v.literal('dm-sans'),v.literal('montserrat'),v.literal('poppins'),v.literal('oswald'),v.literal('bebas-neue'),v.literal('playfair-display'),v.literal('caveat'),v.literal('tiktok-sans'),v.literal('barlow-condensed'),v.literal('ibm-plex-mono'),v.literal('lora'),v.literal('archivo-black'),v.literal('fraunces'))),
  effectPreset: v.optional(v.union(v.literal('none'), v.literal('fade'), v.literal('punch'), v.literal('shake'), v.literal('flash'), v.literal('pop'), v.literal('cinematic-bars'), v.literal('quick-zoom-in'), v.literal('quick-zoom-out'),v.literal('frame-shrink'), v.literal('zoom-blur'), v.literal('solid-color'),v.literal('crossfade'),v.literal('spin-zoom'),v.literal('blur-dissolve'),v.literal('gradient-wipe'),v.literal('iris-wipe'))),
  cinematicBars: v.optional(v.object({ size: v.number(), speed: v.number() })),
  solidColor:v.optional(v.object({color:v.string(),width:v.number(),height:v.number(),x:v.number(),y:v.number(),opacity:v.number()})),
  transition:v.optional(v.object({fromClipId:v.string(),toClipId:v.string(),direction:v.union(v.literal('clockwise'),v.literal('counter-clockwise')),wipeDirection:v.optional(v.union(v.literal('left'),v.literal('right'),v.literal('up'),v.literal('down'))),softness:v.optional(v.number()),centerX:v.optional(v.number()),centerY:v.optional(v.number()),shape:v.optional(v.union(v.literal('circle'),v.literal('ellipse')))})),
  animation: v.optional(v.union(v.literal("none"), v.literal("fade"), v.literal("rise"))),
  textAnimationTiming:v.optional(v.object({duration:v.number(),offset:v.number()})),
});
export const timelineMarkerValidator = v.object({ id: v.string(), time: v.number(), label: v.optional(v.string()) });
// Legacy: timelines saved while sections existed may still hold them; saving drops them.
const timelineSectionValidator = v.object({ id: v.string(), name: v.string(), start: v.number(), end: v.number() });
export const timelineValidator = v.object({ clips: v.array(clipValidator), fps: v.number(), aspectRatio, tracks: v.optional(v.object({ visual: v.number(), overlay: v.number(), audio: v.number(), effects: v.optional(v.number()) })), markers: v.optional(v.array(timelineMarkerValidator)), sections: v.optional(v.array(timelineSectionValidator)) });
export const assistantRecoveryValidator = v.object({requests:v.array(v.string()),runId:v.string(),revision:v.number(),savedEdits:v.optional(v.number()),reason:v.string(),status:v.union(v.literal('failed'),v.literal('stopped')),updatedAt:v.number()});
export const aiStateFields = {
  aiQueuePaused:v.optional(v.boolean()), aiWorkflowId:v.optional(v.string()), aiRunning: v.optional(v.boolean()), aiEditing: v.optional(v.boolean()), aiError: v.optional(v.string()), aiRunId: v.optional(v.string()), aiUndoRecorded: v.optional(v.boolean()), aiCheckpointRevision: v.optional(v.number()),
  aiAnalysisUsage:v.optional(v.object({runId:v.string(),enqueued:v.number()})),
  // The connected app driving an MCP run (its OAuth client name), shown in the editor's chat.
  aiAgentName:v.optional(v.string()),
  // An MCP agent counts as working until this time; every tool call on the project extends it.
  aiAgentActiveUntil:v.optional(v.number()),
  aiRequest:v.optional(v.object({prompt:v.string(),messageId:v.string(),startedRevision:v.number()})),aiRecovery:v.optional(assistantRecoveryValidator),
};
export const projectFields = {
  deleting:v.optional(v.boolean()), title: v.string(), ownerId: v.string(), aspectRatio, createdAt: v.number(), updatedAt: v.number(),
  timeline: v.optional(timelineValidator), revision: v.optional(v.number()), history: v.optional(v.array(timelineValidator)),
  threadId:v.optional(v.string()), ...aiStateFields,
  // Timeline tabs: the open tab's timeline is `timeline`; the others live in projectTimelines.
  timelineTabs:v.optional(v.array(v.object({id:v.string(),name:v.string()}))), activeTimelineId:v.optional(v.string()),
};
export const projectDocument = v.object({ _id: v.id("projects"), _creationTime: v.number(), ...projectFields });
export const timedText = v.object({ start: v.number(), end: v.number(), text: v.string() });
export const transcriptValidator = v.object({ segments: v.array(timedText), words: v.array(timedText), version: v.optional(v.number()) });
export const audioActivityValidator = v.object({ version: v.literal(1), duration: v.number(), frameSeconds: v.literal(.01), quiet: v.array(v.object({ start: v.number(), end: v.number() })), level: v.object({ noiseFloorDb: v.number(), speechDb: v.number(), quietThresholdDb: v.number(), separationDb: v.number() }), reliable: v.boolean() });
export const understandingValidator = v.object({ summary: v.string(), scenes: v.array(v.object({ start: v.number(), end: v.number(), description: v.string(), score: v.number() })), suggestions: v.optional(v.array(v.object({ label: v.string(), prompt: v.string(), start: v.number(), end: v.number() }))) });
export const shotsValidator = v.object({ fps: v.number(), sourceTiming: v.optional(v.object({ basis: v.literal('pts'), videoStart: v.number(), videoEnd: v.number(), frameCount: v.number() })), shots: v.array(v.object({ start: v.number(), end: v.number(), startFrame: v.number(), endFrame: v.number() })) });
const audioHitValidator = v.object({ time: v.number(), strength: v.number() });
export const beatsValidator = v.object({ beats: v.array(v.number()), bpm: v.number(), confidence: v.number(), engine: v.optional(v.literal(BEAT_ANALYSIS_ENGINE)), downbeats: v.optional(v.array(v.number())), accents: v.optional(v.array(audioHitValidator)), dropCandidates: v.optional(v.array(audioHitValidator)) });
export const analysisValidator = v.object({ transcript: v.optional(transcriptValidator), audioActivity: v.optional(audioActivityValidator), understanding: v.optional(understandingValidator), shots: v.optional(shotsValidator), beats: v.optional(beatsValidator), focus: v.optional(focusValidator) });
export const frameRequestValidator = v.object({ start: v.number(), end: v.number(), question: v.string() });
export const frameTargetValidator=v.object({frameIndex:v.number(),time:v.number(),label:v.string(),confidence:v.union(v.literal('low'),v.literal('medium'),v.literal('high')),box:v.object({left:v.number(),top:v.number(),right:v.number(),bottom:v.number()})});
export const frameInspectionValidator = v.object({ ...frameRequestValidator.fields, geometry:v.optional(v.object({sourceWidth:v.number(),sourceHeight:v.number(),decodedWidth:v.number(),decodedHeight:v.number()})),targets:v.optional(v.array(frameTargetValidator)),sourceFps: v.number(), sampleInterval: v.number(), consecutive: v.boolean(), summary: v.string(), uncertainty: v.string(), frames: v.array(v.object({ frameIndex: v.number(), time: v.number(), observation: v.string() })), events: v.array(v.object({ frameIndex: v.number(), time: v.number(), description: v.string(), confidence: v.union(v.literal('low'), v.literal('medium'), v.literal('high')) })) });
export const videoRequestValidator = v.object({ start: v.number(), end: v.number(), question: v.string() });
export const videoInspectionValidator = v.object({ ...videoRequestValidator.fields, summary: v.string(), uncertainty: v.string(), matches: v.array(v.object({ start: v.number(), end: v.number(), description: v.string() })) });
export const analysisMode = v.union(v.literal("transcribe"), v.literal("understand"), v.literal("shots"), v.literal("beats"), v.literal("track"), v.literal('frames'), v.literal('video'));
const analysisRequestFields = { ownerId: v.string(), projectId: v.id("projects"), assetId: v.id("assets"), aiRunId: v.string(), mode: analysisMode, frameRequest: v.optional(frameRequestValidator), frameInspection: v.optional(frameInspectionValidator), videoRequest: v.optional(videoRequestValidator), videoInspection: v.optional(videoInspectionValidator), taskId: v.optional(v.id('mediaTasks')), status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")), error: v.optional(v.string()), createdAt: v.number(), expiresAt: v.number() };
export const analysisRequestDocument = v.object({ _id: v.id("analysisRequests"), _creationTime: v.number(), ...analysisRequestFields });
export const previewFields = { previewR2Key:v.optional(v.string()), previewSize:v.optional(v.number()), previewWidth:v.optional(v.number()), previewHeight:v.optional(v.number()), previewFps:v.optional(v.number()), previewVersion:v.optional(v.number()) };
export const assetFields = {
  ...previewFields,
  ownerId: v.string(), projectId: v.id("projects"), storageId: v.optional(v.id("_storage")), r2Key: v.optional(v.string()), fileName: v.string(),
  contentType: v.string(), size: v.number(), kind: assetKind, createdAt: v.number(),
  duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()), analysisId:v.optional(v.id('assetAnalyses')),analysisKinds:v.optional(v.array(v.string())),editSuggestions:understandingValidator.fields.suggestions, analysis: v.optional(analysisValidator), analysisUpdatedAt: v.optional(v.number()),
  audioAssetId: v.optional(v.id("assets")), audioExtracted: v.optional(v.boolean()),
  waveform: v.optional(waveformValidator),
  // JSON recipe of an assistant-generated sound effect; editSound re-renders from it.
  soundRecipe: v.optional(v.string()),
  // A background-removed copy (VP9 with alpha) of cutoutOf on the same source timeline;
  // frames before cutoutStart are transparent padding.
  cutoutOf: v.optional(v.id('assets')), cutoutStart: v.optional(v.number()),
  thumbnailStorageId: v.optional(v.id('_storage')),
  analysisCompletedAt: v.optional(v.object({ transcribe: v.optional(v.number()), understand: v.optional(v.number()), shots: v.optional(v.number()), beats: v.optional(v.number()), track: v.optional(v.number()) })),
};
export const assetDocument = v.object({ _id: v.id("assets"), _creationTime: v.number(), ...assetFields });
export const assetWithUrl = v.object({ _id: v.id("assets"), _creationTime: v.number(), ...assetFields, url: v.union(v.string(), v.null()), previewUrl:v.optional(v.union(v.string(),v.null())), thumbnailUrl:v.optional(v.union(v.string(),v.null())) });
export const renderFields = {
  ownerId: v.string(), projectId: v.id("projects"),
  status: v.union(v.literal("queued"), v.literal("rendering"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
  outputStorageId: v.optional(v.id("_storage")), outputR2Key: v.optional(v.string()), outputSize: v.optional(v.number()), error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  sourceRevision:v.optional(v.number()), sourceClipId:v.optional(v.string()), sourceSectionId:v.optional(v.string()), sourceTimelineId:v.optional(v.string()), label:v.optional(v.string()), timeline: v.optional(timelineValidator), resolution: v.optional(v.number()), fps: v.optional(v.number()), quality: v.optional(v.string()),
  progress: v.optional(v.number()), assetIds: v.optional(v.array(v.id("assets"))), taskId: v.optional(v.id('mediaTasks')),
};
export const renderDocument = v.object({ _id: v.id("renderJobs"), _creationTime: v.number(), ...renderFields, url: v.union(v.string(), v.null()) });
const {timeline:_snapshot,...renderSummaryFields}=renderFields;
export const renderSummaryDocument=v.object({_id:v.id('renderJobs'),_creationTime:v.number(),...renderSummaryFields,url:v.union(v.string(),v.null())});
export const r2UploadFields = {
    ownerId: v.string(), projectId: v.id("projects"), jobId: v.optional(v.id("renderJobs")), taskId: v.optional(v.id('mediaTasks')), taskLeaseToken: v.optional(v.string()), purpose:v.optional(v.literal('preview')), sourceAssetId:v.optional(v.id('assets')), previewFps:v.optional(v.number()), previewVersion:v.optional(v.number()),
    key: v.string(), uploadId: v.string(), fileName: v.string(), contentType: v.string(), kind: assetKind,
    size: v.number(), partSize: v.number(), duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()),
    cleanupScheduled:v.optional(v.boolean()), aborting:v.optional(v.boolean()), expiresAt: v.number(), assetId: v.optional(v.id("assets")), completed: v.optional(v.boolean()),
};
export const r2UploadDocument = v.object({ _id: v.id("r2Uploads"), _creationTime: v.number(), ...r2UploadFields });
export const userFields = {
  clerkId: v.string(), email: v.optional(v.string()), name: v.optional(v.string()), imageUrl: v.optional(v.string()),
  createdAt: v.number(), updatedAt: v.number(),
};
export const userDocument = v.object({ _id: v.id("users"), _creationTime: v.number(), ...userFields });
export const mediaTaskKind = v.union(analysisMode, v.literal('extract'), v.literal('preview'), v.literal('waveform'), v.literal('render'), v.literal('import'), v.literal('review'), v.literal('snapshot'), v.literal('cutout'));
export const mediaTaskStatus = v.union(v.literal('queued'), v.literal('running'), v.literal('retrying'), v.literal('completed'), v.literal('failed'), v.literal('cancelled'));
export const mediaTaskActivity = v.union(v.literal('downloading'), v.literal('preparing-analysis'), v.literal('sending-gemini'), v.literal('preparing-gemini'), v.literal('analyzing'), v.literal('retrying-analysis'));
export const mediaTaskFields = {
  ownerId: v.string(), projectId: v.id('projects'), kind: mediaTaskKind,
  // Ultra exports run on the 4-vCPU processor slot; other work leaves this unset.
  lane: v.optional(v.literal('ultra')),
  assetId: v.optional(v.id('assets')), renderJobId: v.optional(v.id('renderJobs')), analysisRequestId: v.optional(v.id('analysisRequests')),
  status: mediaTaskStatus, claimable:v.optional(v.boolean()), workflowId: v.optional(v.string()), attempt: v.number(), progress: v.number(),
  activity:v.optional(mediaTaskActivity),activityStartedAt:v.optional(v.number()),
  outputAssetId: v.optional(v.id('assets')),
  sourceUrl: v.optional(v.string()),
  reviewId:v.optional(v.id('compositionReviews')),snapshotId:v.optional(v.id('frameSnapshots')),cutoutId:v.optional(v.id('cutouts')),previewVersion:v.optional(v.number()),requiredProcessorVersion:v.optional(v.number()),
  frameRequest: v.optional(frameRequestValidator), frameInspection: v.optional(frameInspectionValidator),
  videoRequest: v.optional(videoRequestValidator), videoInspection: v.optional(videoInspectionValidator),
  leaseToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), attemptStartedAt: v.optional(v.number()),
  error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
};
export const mediaTaskDocument = v.object({ _id: v.id('mediaTasks'), _creationTime: v.number(), ...mediaTaskFields });
export const sharedAssetFields = {
  ...previewFields,
  ownerId:v.optional(v.string()),
  sourceId:v.id('assets'), storageId:v.optional(v.id('_storage')), r2Key:v.optional(v.string()),
  fileName:v.string(),contentType:v.string(),size:v.number(),kind:assetKind,
  duration:v.optional(v.number()),width:v.optional(v.number()),height:v.optional(v.number()),
  audioAssetId:v.optional(v.id('assets')),audioExtracted:v.optional(v.boolean()),
  waveform:v.optional(waveformValidator),thumbnailStorageId:v.optional(v.id('_storage')),
};
export const publicMediaAsset = v.object({
  previewSize:previewFields.previewSize,previewWidth:previewFields.previewWidth,previewHeight:previewFields.previewHeight,previewFps:previewFields.previewFps,previewVersion:previewFields.previewVersion,
  _id:v.string(),fileName:v.string(),kind:assetKind,url:v.union(v.string(),v.null()),previewUrl:v.optional(v.union(v.string(),v.null())),
  duration:v.optional(v.number()),width:v.optional(v.number()),height:v.optional(v.number()),
  audioAssetId:v.optional(v.string()),audioExtracted:v.optional(v.boolean()),waveform:v.optional(waveformValidator),thumbnailUrl:v.optional(v.union(v.string(),v.null())),
});
export const sharedChatMessage = v.object({role:v.union(v.literal('user'),v.literal('assistant')),text:v.string()});
export const shareChatPreviewMessage = v.object({id:v.string(),...sharedChatMessage.fields});
export default defineSchema({
  projectTransferReceipts:defineTable({transferKey:v.string(),transferId:v.string(),sourceDeployment:v.string(),sourceProjectId:v.string(),sourceRevision:v.number(),fingerprint:v.string(),ownerId:v.string(),email:v.string(),projectId:v.id('projects'),shareId:v.id('timelineShares'),createdAt:v.number()}).index('by_key',['transferKey']),
  aiCostRecords:defineTable({ownerId:v.string(),projectId:v.id('projects'),runId:v.string(),threadId:v.optional(v.string()),promptMessageId:v.optional(v.string()),...aiCostRecordFields}).index('by_owner_recorded',['ownerId','recordedAt']).index('by_run_key',['runId','key']).index('by_owner_project_thread_prompt',['ownerId','projectId','threadId','promptMessageId']),
  assistantPlans:defineTable({projectId:v.id('projects'),ownerId:v.string(),runId:v.string(),plans:v.array(effectPlanValidator),originals:v.array(clipValidator),reviews:v.number(),createdAt:v.number()}).index('by_project',['projectId']),
  compositionReviews:defineTable({projectId:v.id('projects'),ownerId:v.string(),runId:v.string(),revision:v.number(),timeline:timelineValidator,reference:timelineValidator,plans:v.array(effectPlanValidator),assetIds:v.array(v.id('assets')),start:v.number(),end:v.number(),taskId:v.optional(v.id('mediaTasks')),status:v.union(v.literal('queued'),v.literal('completed'),v.literal('failed')),result:v.optional(compositionReviewResult),error:v.optional(v.string()),createdAt:v.number()}).index('by_project',['projectId']).index('by_created',['createdAt']),

  assetAnalyses:defineTable({ownerId:v.string(),sourceKey:v.string(),analysis:analysisValidator,updatedAt:v.number()}).index('by_owner_source',['ownerId','sourceKey']),
  projectAccess:defineTable({projectId:v.id('projects'),ownerId:v.string(),historyStored:v.optional(v.boolean()),threadId:v.optional(v.string()),deleting:v.optional(v.boolean())}).index('by_project',['projectId']),
  // Share of the per-request token cap the active run has used, 0–1.
  aiBudgets:defineTable({projectId:v.id('projects'),runId:v.string(),used:v.number(),updatedAt:v.number()}).index('by_project',['projectId']),
  aiTimelinePreviews:defineTable({projectId:v.id('projects'),ownerId:v.string(),runId:v.string(),baseRevision:v.number(),timeline:timelineValidator,label:v.string(),changedClipIds:v.array(v.string()),removedClips:v.array(clipValidator),at:v.number(),sequence:v.number(),updatedAt:v.number()}).index('by_project',['projectId']),
  assistantQueue:defineTable({projectId:v.id('projects'),ownerId:v.string(),prompt:v.string(),pinnedModel:pinnedClaudeModelValidator,attachedAssetIds:v.optional(v.array(v.id('assets'))),selectedClipId:v.optional(v.string()),selectedClipIds:v.optional(v.array(v.string())),playhead:v.optional(v.number()),error:v.optional(v.string()),createdAt:v.number()}).index('by_project',['projectId']),
  aiRuns:defineTable({projectId:v.id('projects'),ownerId:v.string(),...aiStateFields}).index('by_project',['projectId']),
  projectTimelines:defineTable({projectId:v.id('projects'),ownerId:v.string(),timelineId:v.string(),timeline:timelineValidator,history:v.optional(v.array(timelineValidator))}).index('by_project_timeline',['projectId','timelineId']),
  timelineRevisions:defineTable({projectId:v.id('projects'),ownerId:v.string(),sequence:v.number(),timeline:timelineValidator,key:v.optional(v.string()),keyVersion:v.optional(v.number())}).index('by_project_sequence',['projectId','sequence']),
  projectCatalog:defineTable({projectId:v.id('projects'),ownerId:v.string(),title:v.string(),aspectRatio,createdAt:v.number(),updatedAt:v.number(),clipCount:v.number(),aiRunning:v.boolean(),deleting:v.optional(v.boolean()),coverKind:v.optional(assetKind),coverStorageId:v.optional(v.id('_storage')),coverR2Key:v.optional(v.string())}).index('by_project',['projectId']).index('by_owner_updated',['ownerId','updatedAt']),
  projectDataMigration:defineTable({key:v.string(),cursor:v.union(v.string(),v.null()),completed:v.boolean()}).index('by_key',['key']),
  storageAccounts: defineTable({ ownerId:v.string(), usedBytes:v.number(), reservedBytes:v.number(), videoBytes:v.number(), audioBytes:v.number(), imageBytes:v.number(), exportBytes:v.number(), fileCount:v.number() }).index('by_owner',['ownerId']),
  storageObjects: defineTable({ ownerId:v.string(), objectKey:v.string(), r2Key:v.optional(v.string()), storageId:v.optional(v.id('_storage')), fileName:v.string(), kind:v.union(assetKind,v.literal('export')), size:v.number(), createdAt:v.number(), auxiliary:v.boolean(), pending:v.boolean(), jobId:v.optional(v.id('renderJobs')) })
    .index('by_owner_key',['ownerId','objectKey']).index('by_owner_visible_size',['ownerId','auxiliary','pending','size']).index('by_owner_visible_created',['ownerId','auxiliary','pending','createdAt'])
    .index('by_owner_kind_size',['ownerId','auxiliary','pending','kind','size']).index('by_owner_kind_created',['ownerId','auxiliary','pending','kind','createdAt'])
    .searchIndex('search_name',{searchField:'fileName',filterFields:['ownerId','auxiliary','pending','kind']}),
  storageAccounting: defineTable({ name:v.string(), ready:v.boolean() }).index('by_name',['name']),
  editorEntitlements: defineTable({ ownerId: v.string(), reason: v.string(), grantedAt: v.number(), updatedAt: v.number(), expiresAt: v.optional(v.number()), revokedAt: v.optional(v.number()), plan: v.optional(v.literal('ultra')) }).index('by_owner', ['ownerId']),
  timelineShares:defineTable({projectId:v.id('projects'),ownerId:v.string(),title:v.string(),timeline:timelineValidator,chat:v.optional(v.array(sharedChatMessage)),published:v.boolean(),createdAt:v.number(),updatedAt:v.number()}).index('by_project',['projectId']),
  shareAssets:defineTable({shareId:v.id('timelineShares'),...sharedAssetFields}).index('by_share',['shareId']).index('by_storageId',['storageId']).index('by_r2Key',['r2Key']).index('by_previewR2Key',['previewR2Key']).index('by_owner_previewR2Key',['ownerId','previewR2Key']).index('by_thumbnailStorageId',['thumbnailStorageId']).index('by_owner_r2Key',['ownerId','r2Key']).index('by_owner_storageId',['ownerId','storageId']).index('by_owner_thumbnail',['ownerId','thumbnailStorageId']),
  billingCheckouts: defineTable({ ownerId: v.string(), priceId: v.string(), origin: v.string(), trialEligible: v.boolean(), requestId: v.string(), createdAt: v.number(), sessionId: v.optional(v.string()), url: v.optional(v.string()), expiresAt: v.optional(v.number()) }).index('by_owner', ['ownerId']),
  billingSubscriptionSync: defineTable({ stripeSubscriptionId: v.string(), token: v.string(), lastEventId: v.optional(v.string()) }).index('by_subscription', ['stripeSubscriptionId']),
  discordAlerts: defineTable({ ...alertFields, status: v.union(v.literal('queued'), v.literal('delivering'), v.literal('sent'), v.literal('failed')), attempts: v.number(), leaseUntil: v.optional(v.number()), lastError: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number() }).index('by_source_event', ['source', 'eventId']).index('by_status_updated', ['status', 'updatedAt']),
  mediaTasks: defineTable(mediaTaskFields).index('by_status_createdAt', ['status', 'createdAt']).index('by_status_claimable_created',['status','claimable','createdAt']).index('by_status_claimable_kind_created',['status','claimable','kind','createdAt']).index('by_status_updated',['status','updatedAt']).index('by_asset_kind', ['assetId', 'kind']).index('by_project_createdAt', ['projectId', 'createdAt']).index('by_project_kind_status',['projectId','kind','status']).index('by_owner_status',['ownerId','status']),
  // One row: serializes Fly export dispatch so concurrent runs cannot both create a warm machine.
  flyDispatchLocks: defineTable({ name: v.string(), lockedUntil: v.number(), pending: v.boolean() }).index('by_name', ['name']),
  accountRateLimits:defineTable({ownerId:v.string(),name:v.string(),period:v.number(),windowStart:v.number(),count:v.number()}).index('by_owner_name_period',['ownerId','name','period']),
  users: defineTable(userFields).index("by_clerk_id", ["clerkId"]),
  projects: defineTable(projectFields).index("by_ownerId_updatedAt", ["ownerId", "updatedAt"]),
  assets: defineTable(assetFields).index("by_analysis",["analysisId"]).index("by_ownerId_projectId", ["ownerId", "projectId"]).index('by_owner_project_r2Key',['ownerId','projectId','r2Key']).index("by_ownerId_createdAt", ["ownerId", "createdAt"]).index("by_storageId", ["storageId"]).index("by_r2Key", ["r2Key"]).index('by_previewR2Key',['previewR2Key']).index('by_owner_previewR2Key',['ownerId','previewR2Key']).index('by_thumbnailStorageId',['thumbnailStorageId']).index('by_owner_r2Key',['ownerId','r2Key']).index('by_owner_storageId',['ownerId','storageId']).index('by_owner_thumbnail',['ownerId','thumbnailStorageId']).index('by_owner_audio',['ownerId','audioAssetId']),
  renderJobs: defineTable(renderFields).index("by_ownerId_projectId", ["ownerId", "projectId"]).index("by_status_createdAt", ["status", "createdAt"]).index("by_owner_project_status",["ownerId","projectId","status"]).index('by_owner_status',['ownerId','status']),
  analysisRequests: defineTable(analysisRequestFields).index("by_projectId_runId", ["projectId", "aiRunId"]).index("by_projectId", ["projectId"]),
  r2Uploads: defineTable(r2UploadFields).index("by_projectId", ["projectId"]).index("by_projectId_completed", ["projectId", "completed"]).index('by_owner_completed',['ownerId','completed']),
  uploadTickets: defineTable({
    token: v.string(), ownerId: v.string(), projectId: v.id("projects"), jobId: v.optional(v.id("renderJobs")),
    storageId: v.optional(v.id("_storage")), expiresAt: v.number(), consumed: v.boolean(), receiving: v.optional(v.boolean()),
  }).index("by_token", ["token"]).index("by_storageId", ["storageId"]).index("by_projectId", ["projectId"]),
  // MCP: OAuth clients registered dynamically (RFC 7591), one-time authorization
  // codes, and hashed bearer tokens. Token values are never stored.
  mcpClients: defineTable({ clientId: v.string(), clientName: v.string(), redirectUris: v.array(v.string()), createdAt: v.number() }).index("by_clientId", ["clientId"]).index("by_createdAt", ["createdAt"]),
  // A redeemed code stays as a tombstone naming its grant, so a replayed code can revoke it.
  mcpAuthCodes: defineTable({ codeHash: v.string(), clientId: v.string(), ownerId: v.string(), redirectUri: v.string(), codeChallenge: v.string(), resource: v.optional(v.string()), expiresAt: v.number(), redeemedGrantId: v.optional(v.string()) }).index("by_codeHash", ["codeHash"]).index("by_expiresAt", ["expiresAt"]),
  mcpTokens: defineTable({
    tokenHash: v.string(), kind: v.union(v.literal("access"), v.literal("refresh"), v.literal("personal")), ownerId: v.string(),
    // One connection (an approved client, or one personal token) shares a grant.
    grantId: v.string(), clientId: v.optional(v.string()), label: v.string(),
    createdAt: v.number(), expiresAt: v.optional(v.number()), lastUsedAt: v.optional(v.number()), revokedAt: v.optional(v.number()),
  }).index("by_tokenHash", ["tokenHash"]).index("by_owner", ["ownerId"]).index("by_grant", ["grantId"]).index("by_grant_revoked", ["grantId", "revokedAt"]).index("by_clientId", ["clientId"]).index("by_revokedAt", ["revokedAt"]),
  // Background removal for one clip's source range, run by fal.ai through the media worker.
  cutouts: defineTable({ ownerId: v.string(), projectId: v.id("projects"), clipId: v.string(), sourceAssetId: v.id("assets"), start: v.number(), end: v.number(), fps: v.optional(v.number()), subject: v.optional(v.string()), effect: v.optional(cutoutEffectValidator), status: v.union(v.literal("queued"), v.literal("completed"), v.literal("failed")), taskId: v.optional(v.id("mediaTasks")), outputAssetId: v.optional(v.id("assets")), placed: v.optional(v.boolean()), error: v.optional(v.string()), createdAt: v.number() }).index("by_project", ["projectId"]),
  // Rendered timeline frames an MCP client asked to see; deleted once read.
  frameSnapshots: defineTable({ projectId: v.id("projects"), ownerId: v.string(), revision: v.number(), times: v.array(v.number()), taskId: v.optional(v.id("mediaTasks")), status: v.union(v.literal("queued"), v.literal("completed"), v.literal("failed")), frames: v.optional(v.array(v.object({ time: v.number(), image: v.string() }))), error: v.optional(v.string()), createdAt: v.number() }).index("by_project", ["projectId"]),
  // Per-minute counters keyed by owner (tool calls) or "register:<ip>" (client registration).
  mcpUsage: defineTable({ ownerId: v.string(), windowStart: v.number(), calls: v.number() }).index("by_owner", ["ownerId"]),
});
