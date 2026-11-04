import { readTranscript } from '../lib/media-analysis/transcript';
import { normalizationAssetIds } from '../lib/editor/audio-normalization';
import { allTabTimelines } from './timelineTabs';
import { facecamAnalysis, speakerAnalysis } from '../lib/media-analysis/clipping';
import { hydrateAsset,transportAsset,storeAnalysis,compactAnalysis } from './lib/asset_analysis';
import { readHighlights } from '../lib/media-analysis/highlights';
import { writeProject,projectIdentity,projectRun } from './lib/project_data';
import { recordAssetStorage,usedByActiveExport,forgetStorageObject } from './lib/storage_accounting';
import { requireEditorAccess } from './lib/billing_access';
import { mediaConfig, mediaUrl, previewUrl } from './lib/media_storage';
import { removeMediaAttachment } from './lib/shared_media';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { action, mutation, internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwner, requireProject } from "./lib/auth";
import { MAX_CLEANUP_CUTS, MAX_CLEANUP_DETAIL } from "../lib/speech-cleanup/types";
import { assetWithUrl, assetKind, transcriptValidator, audioActivityValidator, understandingValidator, shotsValidator, beatsValidator, focusValidator, waveformValidator, analysisValidator } from "./schema";
import { MAX_AUDIO_ACTIVITY_QUIET_INTERVALS, MIN_AUDIO_QUIET_SECONDS } from '../lib/media-analysis/audio-activity';
import { parseShots } from '../lib/media-analysis/shots';
import { validateReference } from '../lib/media-analysis/reference';
import { serializedBytes, validateFocus } from "./lib/timeline";
import { consumeUpload, issueUpload } from "./uploads";
import { enqueueMediaTask } from './mediaTasks';
import { requireMediaTaskCapacity, uploadPreparationTasks } from './lib/account_limits';
import { stockAudio } from '../lib/editor/stock-audio';
import { signMediaToken } from '../lib/storage/media-tokens';import { sceneMediaAssetIds } from '../lib/editor/scene-layers';

/** Public playback is restricted to immutable CC0 catalog IDs, never arbitrary stored keys. */
export const catalogAudioUrl = action({ args: { catalogId: v.string() }, returns: v.string(), handler: async (_ctx, args) => {
  const entry = stockAudio(args.catalogId);
  if (!entry) throw new ConvexError('Audio FX not found');
  const { url, secret } = mediaConfig();
  const token = await signMediaToken(secret, { operation: 'read', key: entry.r2Key, expires: Date.now() + 3600_000 });
  return `${url}/read?token=${token}`;
}});
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
  if (args.kind === 'model' && (metadata.contentType !== 'model/gltf-binary' || metadata.size > 32 * 1024 * 1024)) throw new ConvexError('Use a self-contained GLB model under 32 MB.');
  if (args.duration !== undefined && (!Number.isFinite(args.duration) || args.duration <= 0 || args.duration > 24 * 60 * 60)) throw new ConvexError("Invalid media duration");
  for (const size of [args.width, args.height]) if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 16384)) throw new ConvexError("Invalid media dimensions");
  const count = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", args.projectId)).take(200);
  if (count.length >= 200) throw new ConvexError("A project supports up to 200 media files");
  await consumeUpload(ctx, args.storageId, ownerId, args.projectId);
  const assetId = await ctx.db.insert("assets", { ownerId, projectId: args.projectId, storageId: args.storageId, fileName, contentType: metadata.contentType, size: metadata.size, kind: args.kind, createdAt: Date.now(), ...(args.duration !== undefined ? { duration: args.duration } : {}), ...(args.width !== undefined ? { width: args.width } : {}), ...(args.height !== undefined ? { height: args.height } : {}) });
  await recordAssetStorage(ctx,(await ctx.db.get(assetId))!);
  if(args.kind!=='image'&&args.kind!=='model'){
    await requireMediaTaskCapacity(ctx,ownerId,uploadPreparationTasks(args.kind));
    await enqueueMediaTask(ctx,{ownerId,projectId:args.projectId,assetId,kind:args.kind==='video'?'extract':'waveform'});
    if(args.kind==='video')await enqueueMediaTask(ctx,{ownerId,projectId:args.projectId,assetId,kind:'preview'});
    if(args.kind==='audio')await enqueueMediaTask(ctx,{ownerId,projectId:args.projectId,assetId,kind:'transcribe'});
  }
  return assetId;
}});
/** Catalog metadata and immutable media keys are server-owned; no upload or analysis is needed. */
export const registerStockAudio = mutation({ args: { projectId: v.id('projects'), catalogId: v.string() }, returns: assetWithUrl, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  await requireEditorAccess(ctx, ownerId);
  await requireProject(ctx, args.projectId, ownerId);
  const asset = await attachStockAudio(ctx, ownerId, args.projectId, args.catalogId);
  return { ...asset, url: await mediaUrl(ctx, asset) };
}});
/** Reuse or add the project's reference to one shared catalog sound; also used when the assistant places a requested library sound. */
export async function attachStockAudio(ctx: MutationCtx, ownerId: string, projectId: Id<'projects'>, catalogId: string): Promise<Doc<'assets'>> {
  const entry = stockAudio(catalogId);
  if (!entry) throw new ConvexError('Audio FX not found');
  const existing = await ctx.db.query('assets').withIndex('by_owner_project_r2Key', q => q.eq('ownerId', ownerId).eq('projectId', projectId).eq('r2Key', entry.r2Key)).unique();
  if (existing) return existing;
  const count = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', ownerId).eq('projectId', projectId)).take(200);
  if (count.length >= 200) throw new ConvexError('A project supports up to 200 media files');
  validateWaveform(entry.waveform);
  const id = await ctx.db.insert('assets', { ownerId, projectId, kind: 'audio', fileName: `${entry.name}.ogg`, r2Key: entry.r2Key, contentType: entry.contentType, size: entry.size, duration: entry.duration, waveform: entry.waveform, createdAt: Date.now() });
  const asset = (await ctx.db.get(id))!;
  await recordAssetStorage(ctx, asset);
  return asset;
}
export const list = query({ args: { projectId: v.id("projects"), limit: v.optional(v.number()) }, returns: v.array(assetWithUrl), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await projectIdentity(ctx,args.projectId,ownerId);
  const limit = args.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ConvexError("Load between 1 and 200 project media files");
  const assets = await ctx.db.query("assets").withIndex("by_ownerId_projectId", q => q.eq("ownerId", ownerId).eq("projectId", args.projectId)).order("desc").take(limit);
  return await Promise.all(assets.map(async ({analysis,...asset}) => ({ ...asset,...((asset.editSuggestions??analysis?.understanding?.suggestions)?{analysis:{understanding:{summary:'',scenes:[],suggestions:asset.editSuggestions??analysis?.understanding?.suggestions}}}:{}), url: await mediaUrl(ctx, asset),...await previewUrl(ctx,asset),...await thumbnailUrl(ctx,asset) })));
}});
export const library = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(assetWithUrl), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    if (args.paginationOpts.numItems > 60) throw new ConvexError('Load up to 60 uploads at a time');
    const result = await ctx.db.query('assets').withIndex('by_ownerId_createdAt', q => q.eq('ownerId', ownerId)).order('desc').paginate(args.paginationOpts);
    const page = await Promise.all(result.page.map(async ({ analysis, analysisUpdatedAt, analysisCompletedAt, ...asset }) => ({ ...asset, url: await mediaUrl(ctx, asset),...await previewUrl(ctx,asset),...await thumbnailUrl(ctx,asset) })));
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
export const selected = query({
  args: { assetIds: v.array(v.id('assets')) }, returns: v.array(assetWithUrl),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    if (args.assetIds.length > 200) throw new ConvexError('Choose up to 200 uploads');
    const assets = await Promise.all([...new Set(args.assetIds)].map(id => ctx.db.get(id)));
    return await Promise.all(assets.filter(asset => asset?.ownerId === ownerId).map(async asset => ({ ...asset!, url: await mediaUrl(ctx, asset!),...await previewUrl(ctx,asset!),...await thumbnailUrl(ctx,asset!) })));
  },
});
export async function removeOwnedAsset(ctx:MutationCtx,ownerId:string,assetId:Id<'assets'>) {
  const asset = await ctx.db.get(assetId);
  if (!asset || asset.ownerId !== ownerId) throw new ConvexError("Media not found");
  const project = await requireProject(ctx, asset.projectId, ownerId, true, false);
  if (project.aiRunning) throw new ConvexError("Wait for the current AI edit before deleting media");
  const timelines = await allTabTimelines(ctx,project);
  if(timelines.some(t=>normalizationAssetIds(t).includes(asset._id)))throw new ConvexError('Remove this media from loudness normalization first');
  if (timelines.some(timeline => timeline.clips.some(clip => clip.assetId === asset._id) || sceneMediaAssetIds(timeline).includes(asset._id))) throw new ConvexError("Remove this media from the timeline first");
  if(await usedByActiveExport(ctx,ownerId,asset.projectId,new Set([String(asset._id)])))throw new ConvexError('This media is part of an active render');
  await writeProject(ctx,project._id, { history: project.history?.filter(t => !t.clips.some(clip => clip.assetId === asset._id)&&!normalizationAssetIds(t).includes(asset._id)), updatedAt: Date.now() });
  await removeMediaAttachment(ctx, asset); return null;
}
export const remove = mutation({ args: { assetId: v.id('assets') }, returns: v.null(), handler: async (ctx, args) => removeOwnedAsset(ctx,await requireOwner(ctx),args.assetId) });

export const get = query({ args: { projectId: v.id("projects"), assetId: v.id("assets") }, returns: assetWithUrl, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await projectIdentity(ctx,args.projectId,ownerId); const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId) throw new ConvexError("Media not found");
  return { ...await transportAsset(ctx,asset), url: await mediaUrl(ctx, asset),...await previewUrl(ctx,asset),...await thumbnailUrl(ctx,asset) };
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
  const project = await projectRun(ctx,projectId);
  if (!project?.aiRunning || project.aiRunId !== aiRunId) throw new ConvexError("AI run is no longer active");
  return project.ownerId;
}
// Server-only analysis bridge: a worker secret alone cannot read arbitrary media.
// The requested media must belong to the project whose AI run is still active.
export const getForAssistant = internalQuery({ args: { projectId: v.id("projects"), assetId: v.id("assets"), aiRunId: v.string(), workerSecret: v.string() }, returns: assetWithUrl, handler: async (ctx, args) => {
  const ownerId = await assistantWorkerOwner(ctx, args.projectId, args.aiRunId, args.workerSecret);
  const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.projectId !== args.projectId || asset.ownerId !== ownerId) throw new ConvexError("Media not found");
  return { ...await transportAsset(ctx,asset), url: await mediaUrl(ctx, asset) };
}});
export const saveAnalysis = internalMutation({ args: { projectId: v.id("projects"), assetId: v.id("assets"), workerSecret: v.string(), aiRunId: v.optional(v.string()), transcript: v.optional(transcriptValidator), audioActivity: v.optional(audioActivityValidator), understanding: v.optional(understandingValidator), shots: v.optional(shotsValidator), beats: v.optional(beatsValidator), focus: v.optional(focusValidator) }, returns: v.null(), handler: async (ctx, args) => {
  const secret = process.env.RENDER_WORKER_SECRET; if (!secret || secret !== args.workerSecret) throw new ConvexError("Media worker authentication required");
  const ownerId = args.aiRunId ? await assistantWorkerOwner(ctx, args.projectId, args.aiRunId, args.workerSecret) : await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId); const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId) throw new ConvexError("Media not found");
  return saveAssetAnalysis(ctx, asset, args);
}});

export async function saveAssetAnalysis(ctx: MutationCtx, asset: Doc<"assets">, changes: Infer<typeof analysisValidator>) {
  asset=await hydrateAsset(ctx,asset);
  if(changes.transcript)changes={...changes,transcript:readTranscript(changes.transcript)};
  const duration = asset.duration ?? 86400;
  if(changes.facecam&&(!facecamAnalysis.safeParse(changes.facecam).success||changes.facecam.samples.some(s=>s.time>duration)))throw new ConvexError('Invalid facecam analysis');
  if(changes.speakers&&(!speakerAnalysis.safeParse(changes.speakers).success||changes.speakers.turns.some(t=>t.end>duration)||changes.speakers.focus.some(s=>s.time>duration)))throw new ConvexError('Invalid speaker analysis');
  if (changes.focus) validateFocus(changes.focus, duration);
  if (changes.shots) {
    if (asset.kind !== 'video' || !asset.duration) throw new ConvexError('Shot detection requires a video with a known duration');
    try { parseShots(changes.shots, asset.duration); } catch { throw new ConvexError('Invalid shot boundaries'); }
  }
  const validRange = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + 0.5;
  if (changes.transcript) {
    if (changes.transcript.segments.length > 500 || changes.transcript.words.length > 100000) throw new ConvexError("Transcript is too large");
    for (const item of changes.transcript.segments) if (!validRange(item.start, item.end) || !item.text.trim() || item.text.length > 2000) throw new ConvexError("Invalid transcript timing or text");
    // A transcriber can measure an instantaneous word. Preserve its timing rather
    // than assigning an invented duration; rendered segments remain positive.
    for (const item of changes.transcript.words) if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.start > duration || item.end < item.start || item.end > duration + 0.5 || !item.text.trim() || item.text.length > 2000) throw new ConvexError("Invalid transcript timing or text");
  }
  if (changes.audioActivity) {
    const activity = changes.audioActivity;
    if (!Number.isFinite(activity.duration) || activity.duration <= 0 || activity.duration > 86400.5 || (asset.duration !== undefined && Math.abs(activity.duration - asset.duration) > .5) || activity.quiet.length > MAX_AUDIO_ACTIVITY_QUIET_INTERVALS || Object.values(activity.level).some(level => !Number.isFinite(level)) || activity.level.separationDb < 0 || activity.quiet.some((interval, index) => !Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start < 0 || interval.end - interval.start < MIN_AUDIO_QUIET_SECONDS - 1e-6 || interval.end > activity.duration + 1e-6 || (index > 0 && interval.start < activity.quiet[index - 1].end))) throw new ConvexError('Invalid audio activity measurements');
  }
  if (changes.speechCleanup) {
    const cuts = changes.speechCleanup.cuts;
    const edges = changes.speechCleanup.edges;
    if ((edges && (edges.length > 10_000 || edges.some(value => !Number.isFinite(value) || value < 0 || value > duration + .5))) || cuts.length > MAX_CLEANUP_CUTS || cuts.some((cut, index) => !validRange(cut.start, cut.end) || !Number.isFinite(cut.confidence) || cut.confidence < 0 || cut.confidence > 1 || cut.detail.length > MAX_CLEANUP_DETAIL || (index > 0 && cut.start < cuts[index - 1].start))) throw new ConvexError('Invalid speech cleanup measurements');
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
  if (changes.reference) {
    if (asset.kind !== 'video' || !asset.duration) throw new ConvexError('A reference breakdown requires a video with a known duration');
    try { validateReference(changes.reference, asset.duration); } catch { throw new ConvexError('Invalid reference breakdown'); }
  }
  if(changes.highlights){const tracks=readHighlights(changes.highlights);if(!tracks||Math.abs(tracks.duration-duration)>.5)throw new ConvexError('Invalid highlight signal tracks.');}
  const analysis = { ...asset.analysis, ...Object.fromEntries((['highlights','facecam','speakers','transcript','audioActivity','speechCleanup','understanding','shots','beats','focus','reference'] as const).flatMap(key=>changes[key]!==undefined?[[key,changes[key]]]:[])) };
  if (serializedBytes(compactAnalysis(analysis)) > 900_000) throw new ConvexError("Media analysis is too large to save");
  const now = Date.now();
  const analysisCompletedAt = { ...asset.analysisCompletedAt, ...(changes.transcript ? { transcribe: now } : {}), ...(changes.understanding ? { understand: now } : {}), ...(changes.shots ? { shots: now } : {}), ...(changes.beats ? { beats: now } : {}), ...(changes.focus ? { track: now } : {}) };
  await storeAnalysis(ctx,asset,analysis,now);await ctx.db.patch(asset._id,{analysisUpdatedAt:now,analysisCompletedAt}); return null;
}

export const saveFocus = mutation({ args: { projectId: v.id("projects"), assetId: v.id("assets"), focus: focusValidator }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); await requireProject(ctx, args.projectId, ownerId); const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId || asset.kind !== "video") throw new ConvexError("Video not found");
  return saveAssetAnalysis(ctx,asset,{focus:args.focus});
}});
