import { recordAssetStorage,usedByActiveExport,forgetStorageObject } from './lib/storage_accounting';
import { requireEditorAccess } from './lib/billing_access';
import { mediaUrl } from './lib/media_storage';
import { removeMediaAttachment } from './lib/shared_media';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwner, requireProject } from "./lib/auth";
import { assetWithUrl, assetKind, transcriptValidator, understandingValidator, shotsValidator, beatsValidator, focusValidator, waveformValidator, analysisValidator } from "./schema";
import { parseShots } from '../lib/media-analysis/shots';
import { serializedBytes, validateFocus } from "./lib/timeline";
import { consumeUpload, issueUpload } from "./uploads";
import { enqueueMediaTask } from './mediaTasks';
export const generateUploadUrl = mutation({ args: { projectId: v.id("projects") }, returns: v.string(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); await requireProject(ctx, args.projectId, ownerId); return await issueUpload(ctx, ownerId, args.projectId);
}});
export const attachThumbnail=mutation({args:{assetId:v.id('assets'),storageId:v.id('_storage')},returns:v.null(),handler:async(ctx,args)=>{
  const ownerId=await requireOwner(ctx);const asset=await ctx.db.get(args.assetId);
  if(!asset||asset.ownerId!==ownerId)throw new ConvexError('Media not found');
  await requireEditorAccess(ctx,ownerId);await requireProject(ctx,asset.projectId,ownerId);
  const metadata=await ctx.db.system.get(args.storageId);
  if(!metadata||metadata.contentType!=='image/jpeg'||metadata.size>128*1024)throw new ConvexError('Use a JPEG thumbnail under 128 KB');
  await consumeUpload(ctx,args.storageId,ownerId,asset.projectId);
  if(asset.thumbnailStorageId){await ctx.storage.delete(args.storageId);await forgetStorageObject(ctx,ownerId,{storageId:args.storageId});return null;}
  await ctx.db.patch(asset._id,{thumbnailStorageId:args.storageId});await recordAssetStorage(ctx,{...asset,thumbnailStorageId:args.storageId});return null;
}});

async function thumbnailUrl(ctx:QueryCtx,asset:{thumbnailStorageId?:Id<'_storage'>}) {
  return asset.thumbnailStorageId?{thumbnailUrl:await ctx.storage.getUrl(asset.thumbnailStorageId)}:{};
}
export const create = mutation({ args: { projectId: v.id("projects"), storageId: v.id("_storage"), fileName: v.string(), kind: assetKind, duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()) }, returns: v.id("assets"), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); await requireProject(ctx, args.projectId, ownerId);
  const fileName = args.fileName.trim(); if (!fileName || fileName.length > 255) throw new ConvexError("File name must contain between 1 and 255 characters");
  const existing = await ctx.db.query("assets").withIndex("by_storageId", q => q.eq("storageId", args.storageId)).first();
  if (existing) throw new ConvexError("File is already attached to a project");
  const metadata = await ctx.db.system.get(args.storageId);
  if (!metadata) throw new ConvexError("Uploaded file not found");
  if (!metadata.contentType?.startsWith(`${args.kind}/`)) throw new ConvexError("File content type must match the selected media kind");
  if (args.duration !== undefined && (!Number.isFinite(args.duration) || args.duration <= 0 || args.duration > 24 * 60 * 60)) throw new ConvexError("Invalid media duration");
  for (const size of [args.width, args.height]) if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 16384)) throw new ConvexError("Invalid media dimensions");
  const count = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", args.projectId)).take(200);
  if (count.length >= 200) throw new ConvexError("A project supports up to 200 media files");
  await consumeUpload(ctx, args.storageId, ownerId, args.projectId);
  const assetId = await ctx.db.insert("assets", { ownerId, projectId: args.projectId, storageId: args.storageId, fileName, contentType: metadata.contentType, size: metadata.size, kind: args.kind, createdAt: Date.now(), ...(args.duration !== undefined ? { duration: args.duration } : {}), ...(args.width !== undefined ? { width: args.width } : {}), ...(args.height !== undefined ? { height: args.height } : {}) });
  await recordAssetStorage(ctx,(await ctx.db.get(assetId))!);
  if (args.kind === 'video') await enqueueMediaTask(ctx, { ownerId, projectId: args.projectId, assetId, kind: 'understand' });
  return assetId;
}});
export const list = query({ args: { projectId: v.id("projects"), limit: v.optional(v.number()) }, returns: v.array(assetWithUrl), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId);
  const limit = args.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ConvexError("Load between 1 and 200 project media files");
  const assets = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", args.projectId)).order("desc").take(limit);
  return await Promise.all(assets.map(async ({analysis,...asset}) => ({ ...asset,...(analysis?.understanding?.suggestions?{analysis:{understanding:{summary:'',scenes:[],suggestions:analysis.understanding.suggestions}}}:{}), url: await mediaUrl(ctx, asset),...await thumbnailUrl(ctx,asset) })));
}});
export const library = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(assetWithUrl), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    if (args.paginationOpts.numItems > 60) throw new ConvexError('Load up to 60 uploads at a time');
    const result = await ctx.db.query('assets').withIndex('by_ownerId_createdAt', q => q.eq('ownerId', ownerId)).order('desc').paginate(args.paginationOpts);
    const page = await Promise.all(result.page.map(async ({ analysis, analysisUpdatedAt, analysisCompletedAt, ...asset }) => ({ ...asset, url: await mediaUrl(ctx, asset),...await thumbnailUrl(ctx,asset) })));
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
export const selected = query({
  args: { assetIds: v.array(v.id('assets')) }, returns: v.array(assetWithUrl),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    if (args.assetIds.length > 200) throw new ConvexError('Choose up to 200 uploads');
    const assets = await Promise.all([...new Set(args.assetIds)].map(id => ctx.db.get(id)));
    return await Promise.all(assets.filter(asset => asset?.ownerId === ownerId).map(async asset => ({ ...asset!, url: await mediaUrl(ctx, asset!),...await thumbnailUrl(ctx,asset!) })));
  },
});
export async function removeOwnedAsset(ctx:MutationCtx,ownerId:string,assetId:Id<'assets'>) {
  const asset = await ctx.db.get(assetId);
  if (!asset || asset.ownerId !== ownerId) throw new ConvexError("Media not found");
  const project = await requireProject(ctx, asset.projectId, ownerId);
  if (project.aiRunning) throw new ConvexError("Wait for the current AI edit before deleting media");
  if (project.timeline?.clips.some(clip => clip.assetId === asset._id)) throw new ConvexError("Remove this media from the timeline first");
  if(await usedByActiveExport(ctx,ownerId,asset.projectId,new Set([String(asset._id)])))throw new ConvexError('This media is part of an active render');
  await ctx.db.patch(project._id, { history: project.history?.filter(t => !t.clips.some(clip => clip.assetId === asset._id)), updatedAt: Date.now() });
  await removeMediaAttachment(ctx, asset); return null;
}
export const remove = mutation({ args: { assetId: v.id('assets') }, returns: v.null(), handler: async (ctx, args) => removeOwnedAsset(ctx,await requireOwner(ctx),args.assetId) });

export const get = query({ args: { projectId: v.id("projects"), assetId: v.id("assets") }, returns: assetWithUrl, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId); const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId) throw new ConvexError("Media not found");
  return { ...asset, url: await mediaUrl(ctx, asset),...await thumbnailUrl(ctx,asset) };
}});
export const saveExtractedAudio = internalMutation({
  args: { projectId: v.id('projects'), assetId: v.id('assets'), audioAssetId: v.optional(v.id('assets')), waveform: v.optional(waveformValidator), workerSecret: v.string() },
  returns: v.union(v.id('assets'), v.null()),
  handler: async (ctx, args) => {
    if (!process.env.RENDER_WORKER_SECRET || args.workerSecret !== process.env.RENDER_WORKER_SECRET) throw new ConvexError('Media worker authentication required');
    const ownerId = await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId);
    const video = await ctx.db.get(args.assetId);
    if (!video || video.ownerId !== ownerId || video.projectId !== args.projectId || video.kind !== 'video') throw new ConvexError('Video not found');
    const audio = args.audioAssetId ? await ctx.db.get(args.audioAssetId) : null;
    if (args.audioAssetId && (!audio || audio.ownerId !== ownerId || audio.projectId !== args.projectId || audio.kind !== 'audio')) throw new ConvexError('Audio must belong to this project');
    if (args.waveform) {
      validateWaveform(args.waveform);
      if (!audio) throw new ConvexError('Waveforms require an audio source');
      await ctx.db.patch(audio._id, { waveform: args.waveform });
    }
    // Concurrent requests may upload twice; keep one source and reclaim the other.
    if (video.audioExtracted) {
      if (audio && audio._id !== video.audioAssetId) await removeMediaAttachment(ctx, audio);
      return video.audioAssetId ?? null;
    }
    await ctx.db.patch(video._id, { audioExtracted: true, ...(audio ? { audioAssetId: audio._id } : {}) });
    return audio?._id ?? null;
  },
});
export function validateWaveform(waveform: { peaks: string; samplesPerSecond: number }) {
  if (!Number.isFinite(waveform.samplesPerSecond) || waveform.samplesPerSecond <= 0 || waveform.samplesPerSecond > 100 || !waveform.peaks.length || waveform.peaks.length > 16_136 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(waveform.peaks)) throw new ConvexError('Invalid audio waveform');
}
export const saveWaveform = internalMutation({
  args: { projectId: v.id('projects'), assetId: v.id('assets'), waveform: waveformValidator, workerSecret: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!process.env.RENDER_WORKER_SECRET || args.workerSecret !== process.env.RENDER_WORKER_SECRET) throw new ConvexError('Media worker authentication required');
    const ownerId = await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId);
    const audio = await ctx.db.get(args.assetId);
    if (!audio || audio.ownerId !== ownerId || audio.projectId !== args.projectId || audio.kind !== 'audio') throw new ConvexError('Audio not found');
    validateWaveform(args.waveform);
    await ctx.db.patch(audio._id, { waveform: args.waveform });
    return null;
  },
});
async function assistantWorkerOwner(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">, aiRunId: string, workerSecret: string) {
  const secret = process.env.RENDER_WORKER_SECRET;
  if (!secret || secret !== workerSecret) throw new ConvexError("Media worker authentication required");
  const project = await ctx.db.get(projectId);
  if (!project?.aiRunning || project.aiRunId !== aiRunId) throw new ConvexError("AI run is no longer active");
  return project.ownerId;
}
// Server-only analysis bridge: a worker secret alone cannot read arbitrary media.
// The requested media must belong to the project whose AI run is still active.
export const getForAssistant = internalQuery({ args: { projectId: v.id("projects"), assetId: v.id("assets"), aiRunId: v.string(), workerSecret: v.string() }, returns: assetWithUrl, handler: async (ctx, args) => {
  const ownerId = await assistantWorkerOwner(ctx, args.projectId, args.aiRunId, args.workerSecret);
  const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.projectId !== args.projectId || asset.ownerId !== ownerId) throw new ConvexError("Media not found");
  return { ...asset, url: await mediaUrl(ctx, asset) };
}});
export const saveAnalysis = internalMutation({ args: { projectId: v.id("projects"), assetId: v.id("assets"), workerSecret: v.string(), aiRunId: v.optional(v.string()), transcript: v.optional(transcriptValidator), understanding: v.optional(understandingValidator), shots: v.optional(shotsValidator), beats: v.optional(beatsValidator), focus: v.optional(focusValidator) }, returns: v.null(), handler: async (ctx, args) => {
  const secret = process.env.RENDER_WORKER_SECRET; if (!secret || secret !== args.workerSecret) throw new ConvexError("Media worker authentication required");
  const ownerId = args.aiRunId ? await assistantWorkerOwner(ctx, args.projectId, args.aiRunId, args.workerSecret) : await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId); const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId) throw new ConvexError("Media not found");
  return saveAssetAnalysis(ctx, asset, args);
}});

export async function saveAssetAnalysis(ctx: MutationCtx, asset: Doc<"assets">, changes: Infer<typeof analysisValidator>) {
  const duration = asset.duration ?? 86400;
  if (changes.focus) validateFocus(changes.focus, duration);
  if (changes.shots) {
    if (asset.kind !== 'video' || !asset.duration) throw new ConvexError('Shot detection requires a video with a known duration');
    try { parseShots(changes.shots, asset.duration); } catch { throw new ConvexError('Invalid shot boundaries'); }
  }
  const validRange = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + 0.5;
  if (changes.transcript) {
    if (changes.transcript.segments.length > 500 || changes.transcript.words.length > 5000) throw new ConvexError("Transcript is too large");
    for (const item of changes.transcript.segments) if (!validRange(item.start, item.end) || !item.text.trim() || item.text.length > 2000) throw new ConvexError("Invalid transcript timing or text");
    // Whisper can measure an instantaneous word. Preserve its timing rather
    // than assigning an invented duration; rendered segments remain positive.
    for (const item of changes.transcript.words) if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.start > duration || item.end < item.start || item.end > duration + 0.5 || !item.text.trim() || item.text.length > 2000) throw new ConvexError("Invalid transcript timing or text");
  }
  if (changes.understanding) {
    if (changes.understanding.summary.length > 8000 || changes.understanding.scenes.length > 100) throw new ConvexError("Scene analysis is too large");
    for (const scene of changes.understanding.scenes) if (!validRange(scene.start, scene.end) || !Number.isFinite(scene.score) || scene.score < 0 || scene.score > 1 || scene.description.length > 4000) throw new ConvexError("Invalid scene timing or score");
    const suggestions = changes.understanding.suggestions ?? [];
    if (suggestions.length > 3 || suggestions.some(item => !validRange(item.start, item.end) || item.end > duration || !item.label.trim() || item.label.length > 60 || !item.prompt.trim() || item.prompt.length > 1000)) throw new ConvexError('Invalid source edit suggestions');
  }
  if (changes.beats && (changes.beats.beats.length > 1000 || !Number.isFinite(changes.beats.bpm) || changes.beats.bpm < 0 || changes.beats.bpm > 400 || !Number.isFinite(changes.beats.confidence) || changes.beats.confidence < 0 || changes.beats.confidence > 1 || changes.beats.beats.some((beat, i, beats) => !Number.isFinite(beat) || beat < 0 || beat > duration + 0.5 || (i > 0 && beat <= beats[i - 1])))) throw new ConvexError("Invalid beat analysis");
  if (changes.beats?.downbeats) {
    const beats = new Set(changes.beats.beats);
    if (changes.beats.downbeats.length > changes.beats.beats.length || changes.beats.downbeats.some((beat, i, downbeats) => !Number.isFinite(beat) || !beats.has(beat) || (i > 0 && beat <= downbeats[i - 1]))) throw new ConvexError('Invalid beat analysis');
  }
  for (const hits of [changes.beats?.accents, changes.beats?.dropCandidates]) {
    if (hits && (hits.length > 1000 || hits.some((hit, i) => !Number.isFinite(hit.time) || hit.time < 0 || hit.time > duration + 0.5 || !Number.isFinite(hit.strength) || hit.strength < 0 || hit.strength > 1 || (i > 0 && hit.time <= hits[i - 1].time)))) throw new ConvexError('Invalid beat analysis');
  }
  const analysis = { ...asset.analysis, ...(changes.transcript ? { transcript: changes.transcript } : {}), ...(changes.understanding ? { understanding: changes.understanding } : {}), ...(changes.shots ? { shots: changes.shots } : {}), ...(changes.beats ? { beats: changes.beats } : {}), ...(changes.focus ? { focus: changes.focus } : {}) };
  if (serializedBytes(analysis) > 500_000) throw new ConvexError("Media analysis is too large to save");
  const now = Date.now();
  const analysisCompletedAt = { ...asset.analysisCompletedAt, ...(changes.transcript ? { transcribe: now } : {}), ...(changes.understanding ? { understand: now } : {}), ...(changes.shots ? { shots: now } : {}), ...(changes.beats ? { beats: now } : {}), ...(changes.focus ? { track: now } : {}) };
  await ctx.db.patch(asset._id, { analysis, analysisUpdatedAt: now, analysisCompletedAt }); return null;
}

export const saveFocus = mutation({ args: { projectId: v.id("projects"), assetId: v.id("assets"), focus: focusValidator }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); await requireProject(ctx, args.projectId, ownerId); const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId || asset.kind !== "video") throw new ConvexError("Video not found");
  validateFocus(args.focus, asset.duration); const analysis = { ...asset.analysis, focus: args.focus };
  if (serializedBytes(analysis) > 500_000) throw new ConvexError("Media analysis is too large to save");
  const now = Date.now();
  await ctx.db.patch(asset._id, { analysis, analysisUpdatedAt: now, analysisCompletedAt: { ...asset.analysisCompletedAt, track: now } }); return null;
}});
