import { MAX_SOURCE_SECONDS, MAX_UPLOAD_PARTS, UPLOAD_PART_BYTES } from '../lib/editor/limits';
import { recordStorageObject, recordAssetStorage, forgetStorageObject } from './lib/storage_accounting';
import { requireEditorAccess } from './lib/billing_access';
import type { Doc, Id } from './_generated/dataModel';
import { ConvexError, v, type ObjectType } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery, type ActionCtx, type QueryCtx, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { requireOwner } from './lib/auth';
import { projectIdentity } from './lib/project_data';
import { assetKind, r2UploadDocument } from './schema';
import { mediaConfig, storageControl, hasPreview, PREVIEW_VERSION } from './lib/media_storage';
import { signMediaToken } from '../lib/storage/media-tokens';
import { requireMediaTask } from './lib/media_task_auth';
import { enqueueMediaTask } from './mediaTasks';
import { requireMediaTaskCapacity, uploadPreparationTasks, UPLOAD_RESERVATION_MS } from './lib/account_limits';
import { releaseMediaObjects } from './lib/shared_media';
import { releaseAccountStorage } from './lib/storage_accounting';
import { isStockAudioKey } from '../lib/editor/stock-audio';

const metadata = { fileName: v.string(), contentType: v.string(), kind: assetKind, size: v.number(), duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()) };
const partsValidator = v.array(v.object({ partNumber: v.number(), etag: v.string() }));
const uploadInfo = v.object({ uploadId: v.id('r2Uploads'), partSize: v.number(), partCount: v.number() });
const taskAuth = { taskId: v.optional(v.id('mediaTasks')), leaseToken: v.optional(v.string()) };
const previewUpload = { purpose:v.optional(v.literal('preview')),sourceAssetId:v.optional(v.id('assets')),previewFps:v.optional(v.number()),previewVersion:v.optional(v.number()) };
type PreviewUploadArgs = { projectId:Id<'projects'>;jobId?:Id<'renderJobs'>;purpose?:'preview';sourceAssetId?:Id<'assets'>;previewFps?:number;previewVersion?:number;kind:'video'|'audio'|'image';contentType:string;duration?:number };
async function previewSource(ctx:QueryCtx|MutationCtx,args:PreviewUploadArgs,task:Doc<'mediaTasks'>|null) {
  if(!args.purpose){if(args.sourceAssetId!==undefined||args.previewFps!==undefined||args.previewVersion!==undefined||task?.kind==='preview')throw new ConvexError('Preview upload purpose is required');return null;}
  if(!task||task.kind!=='preview'||task.projectId!==args.projectId||task.assetId!==args.sourceAssetId||args.jobId||args.kind!=='video'||args.contentType!=='video/mp4'||args.previewVersion!==PREVIEW_VERSION||!Number.isFinite(args.duration)||args.duration!<=0||!Number.isFinite(args.previewFps)||args.previewFps!<=0||args.previewFps!>240)throw new ConvexError('This task cannot upload that preview');
  const source=task.assetId?await ctx.db.get(task.assetId):null;
  if(!source||source.kind!=='video'||source.ownerId!==task.ownerId||source.projectId!==task.projectId)throw new ConvexError('Preview source is unavailable');
  if(args.duration!==undefined&&source.duration!==undefined&&Math.abs(args.duration-source.duration)>.1)throw new ConvexError('Preview duration must match the original');
  return source;
}


/** Media-task heartbeats rewrite the running tasks that capacity checks read.
 * Retry a mutation that lost Convex's own conflict retries to those writes. */
async function retryOnWriteConflict<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      if (attempt >= 3 || !(error instanceof Error) || !error.message.includes('changed while this mutation was being run')) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
}

export const authorize = internalQuery({ args: { ownerId: v.optional(v.string()), projectId: v.id('projects'), jobId: v.optional(v.id('renderJobs')), workerSecret: v.optional(v.string()), ...taskAuth,...previewUpload, duration:v.optional(v.number()), kind: assetKind, contentType: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  const task = args.taskId && args.leaseToken ? await requireMediaTask(ctx, args.taskId, args.leaseToken) : null;
  if (args.taskId && !task) throw new ConvexError('Media task credentials are required');
  const ownerId = task?.ownerId ?? args.ownerId ?? await requireOwner(ctx); await projectIdentity(ctx, args.projectId, ownerId);
  if (!task && !args.jobId) await requireEditorAccess(ctx, ownerId);
  await previewSource(ctx,args,task);
  if (task && (task.projectId !== args.projectId || !['extract', 'preview', 'render', 'import', 'cutout', 'derive'].includes(task.kind) || (task.kind === 'derive' && (args.jobId || !(args.kind === 'video' && args.contentType === 'video/mp4' || args.kind === 'image' && /^image\/(jpeg|png)$/.test(args.contentType)))) || (task.kind === 'import' && (args.jobId || args.kind !== 'video' || args.contentType !== 'video/mp4')) || (task.kind === 'cutout' && (args.jobId || args.kind !== 'video' || args.contentType !== 'video/webm')) || (task.kind === 'extract' && (args.jobId || args.kind !== 'audio' || args.contentType !== 'audio/mp4')) || (task.kind === 'render' && (args.jobId !== task.renderJobId || args.kind !== 'video' || args.contentType !== 'video/mp4')))) throw new ConvexError('This task cannot upload that media');
  if (args.jobId && !task) {
    if (!process.env.RENDER_WORKER_SECRET || args.workerSecret !== process.env.RENDER_WORKER_SECRET) throw new ConvexError('Render worker authentication required');
    const job = await ctx.db.get(args.jobId);
    if (!job || job.ownerId !== ownerId || job.projectId !== args.projectId || job.status !== 'rendering') throw new ConvexError('Render is not accepting an upload');
  }
  const pending = await ctx.db.query('r2Uploads').withIndex('by_projectId_completed', q => q.eq('projectId', args.projectId).eq('completed', false)).take(101);
  if (pending.filter(upload => !upload.completed && upload.expiresAt > Date.now()).length >= 100) throw new ConvexError('Finish the pending uploads first');
  // Fail fast before opening the multipart upload; createLease is authoritative.
  if (!task && !args.jobId) await requireMediaTaskCapacity(ctx, ownerId, uploadPreparationTasks(args.kind));
  return ownerId;
}});
export const createLease = internalMutation({ args: { ...metadata, ownerId: v.string(), projectId: v.id('projects'), jobId: v.optional(v.id('renderJobs')), ...taskAuth,...previewUpload, key: v.string(), uploadId: v.string(), partSize: v.number() }, returns: v.id('r2Uploads'), handler: async (ctx, args) => {
  await projectIdentity(ctx, args.projectId, args.ownerId);
  if (!args.taskId && !args.jobId) await requireEditorAccess(ctx, args.ownerId);
  const task=args.taskId?await requireMediaTask(ctx,args.taskId,args.leaseToken??''):null;
  await previewSource(ctx,args,task);
  // Transactional with the insert below: parallel starts reserve in turn.
  if (!task && !args.jobId) await requireMediaTaskCapacity(ctx, args.ownerId, uploadPreparationTasks(args.kind));
  const { leaseToken, ...fields } = args;
  await recordStorageObject(ctx,{...args,r2Key:args.key,createdAt:Date.now(),kind:args.jobId?'export':args.kind,pending:true,auxiliary:args.purpose==='preview'});
  const id = await ctx.db.insert('r2Uploads', { ...fields, ...(leaseToken ? { taskLeaseToken: leaseToken } : {}), completed: false, expiresAt: Date.now() + 24 * 3600_000 });
  await ctx.scheduler.runAfter(24 * 3600_000, internal.r2.cleanupLease, { uploadId: id });
  return id;
}});
async function authorizedLease(ctx:QueryCtx|MutationCtx,args:{uploadId:Id<'r2Uploads'>;taskId?:Id<'mediaTasks'>;leaseToken?:string;forCleanup?:boolean;ownerId?:string}) {
  const lease = await ctx.db.get(args.uploadId);
  const task = args.taskId && args.leaseToken ? await requireMediaTask(ctx, args.taskId, args.leaseToken) : null;
  if ((task || lease?.taskId) && (!task || !lease || lease.taskId !== task._id || lease.taskLeaseToken !== args.leaseToken)) throw new ConvexError('Upload belongs to another task attempt');
  const ownerId = task?.ownerId ?? args.ownerId ?? await requireOwner(ctx);
  if (!lease || lease.ownerId !== ownerId || lease.expiresAt < Date.now()) throw new ConvexError('Upload expired or belongs to another user');
  await projectIdentity(ctx, lease.projectId, ownerId);
  await previewSource(ctx,lease,task);
  if (!args.forCleanup && lease.aborting) throw new ConvexError('Upload is being removed');
  // Renewal and completion are paid writes; cleanup remains available after expiry.
  if (!args.forCleanup && !lease.taskId && !lease.jobId) await requireEditorAccess(ctx, ownerId);
  return lease;
}
export const getLease = internalQuery({ args: { uploadId: v.id('r2Uploads'), ...taskAuth, forCleanup: v.optional(v.boolean()), ownerId: v.optional(v.string()) }, returns: r2UploadDocument, handler: authorizedLease });
export const beginAbort = internalMutation({args:{uploadId:v.id('r2Uploads'),...taskAuth,scheduled:v.optional(v.boolean())},returns:v.union(r2UploadDocument,v.null()),handler:async(ctx,args)=>{
  const lease=args.scheduled?await ctx.db.get(args.uploadId):await authorizedLease(ctx,{uploadId:args.uploadId,taskId:args.taskId,leaseToken:args.leaseToken,forCleanup:true});
  if(!lease||lease.completed)return lease;
  if(!lease.aborting)await ctx.db.patch(lease._id,{aborting:true});
  return {...lease,aborting:true};
}});

const startArgs = { projectId: v.id('projects'), jobId: v.optional(v.id('renderJobs')), workerSecret: v.optional(v.string()), ...taskAuth,...previewUpload, ...metadata };
export const start = action({ args: startArgs, returns: uploadInfo, handler: (ctx, args) => openUpload(ctx, args) });
/** Opens a multipart upload. ownerId is passed only by trusted server callers (MCP); browsers authenticate through Clerk. */
export async function openUpload(ctx: ActionCtx, args: ObjectType<typeof startArgs>, trustedOwnerId?: string): Promise<{ uploadId: Id<'r2Uploads'>; partSize: number; partCount: number }> {
  const ownerId = await ctx.runQuery(internal.r2.authorize, { ...(trustedOwnerId ? { ownerId: trustedOwnerId } : {}), projectId: args.projectId, kind: args.kind, contentType: args.contentType,...(args.duration!==undefined?{duration:args.duration}:{}),...(args.purpose?{purpose:args.purpose,sourceAssetId:args.sourceAssetId,previewFps:args.previewFps,previewVersion:args.previewVersion}:{}), ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}), ...(args.jobId ? { jobId: args.jobId, workerSecret: args.workerSecret } : {}) });
  if(!args.purpose&&(args.sourceAssetId!==undefined||args.previewFps!==undefined||args.previewVersion!==undefined))throw new ConvexError('Preview upload purpose is required');
  const fileName = args.fileName.trim();
  if (!fileName || fileName.length > 255 || !/^(video|image|audio)\//.test(args.contentType) || args.contentType.length > 128) throw new ConvexError('Choose a supported media file');
  if (!args.contentType.startsWith(`${args.kind}/`) && !(args.kind === 'audio' && /^video\/(mp4|quicktime|webm)$/.test(args.contentType))) throw new ConvexError('File content type does not match the media');
  if (!Number.isSafeInteger(args.size) || args.size < 1) throw new ConvexError('This file is empty or has an invalid size');
  if (args.duration !== undefined && (!Number.isFinite(args.duration) || args.duration <= 0 || args.duration > MAX_SOURCE_SECONDS)) throw new ConvexError('Invalid media duration');
  if (args.kind !== 'audio' && (![args.width, args.height].every(n => Number.isInteger(n) && n! > 0 && n! <= 16384))) throw new ConvexError('This media has no readable dimensions');
  const partSize = UPLOAD_PART_BYTES, partCount = Math.ceil(args.size / partSize);
  if (partCount > MAX_UPLOAD_PARTS) throw new ConvexError('This file exceeds the multipart transport limit');
  const key = `media/${ownerId}/${args.projectId}/${crypto.randomUUID()}`;
  const created = await storageControl({ action: 'create', key, contentType: args.contentType });
  if (!created.uploadId) throw new ConvexError('Cloudflare did not open the upload');
  const multipartId = created.uploadId;
  try {
    const uploadId = await retryOnWriteConflict(() => ctx.runMutation(internal.r2.createLease, { projectId: args.projectId, ownerId, key, uploadId: multipartId, partSize, fileName, contentType: args.contentType, kind: args.kind, size: args.size,...(args.purpose?{purpose:args.purpose,sourceAssetId:args.sourceAssetId,previewFps:args.previewFps,previewVersion:args.previewVersion}:{}), ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}), ...(args.jobId ? { jobId: args.jobId } : {}), ...(args.duration !== undefined ? { duration: args.duration } : {}), ...(args.width !== undefined ? { width: args.width } : {}), ...(args.height !== undefined ? { height: args.height } : {}) }));
    return { uploadId, partSize, partCount };
  } catch (error) { await storageControl({ action: 'abort', key, uploadId: created.uploadId }); throw error; }
}
export const partUrl = action({ args: { uploadId: v.id('r2Uploads'), partNumber: v.number(), ...taskAuth }, returns: v.string(), handler: async (ctx, args): Promise<string> => {
  const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: args.uploadId, ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}) });
  return signPartUrl(lease, args.partNumber);
}});
/** A one-hour URL that accepts exactly one part's bytes by PUT. */
export async function signPartUrl(lease: Doc<'r2Uploads'>, partNumber: number) {
  const count = Math.ceil(lease.size / lease.partSize);
  if (lease.completed || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) throw new ConvexError('Invalid upload part');
  const { url, secret } = mediaConfig();
  const size = Math.min(lease.partSize, lease.size - (partNumber - 1) * lease.partSize);
  const token = await signMediaToken(secret, { operation: 'part', key: lease.key, uploadId: lease.uploadId, partNumber, size, expires: Date.now() + 3600_000 });
  return `${url}/part?token=${token}`;
}
export const finish = internalMutation({ args: { uploadId: v.id('r2Uploads'), size: v.number(), contentType: v.string() }, returns: v.union(v.id('assets'), v.null()), handler: async (ctx, args) => {
  const lease = await ctx.db.get(args.uploadId);
  if (!lease || lease.expiresAt < Date.now()) throw new ConvexError('Upload expired');
  if (lease.completed) return lease.assetId ?? null;
  if (lease.aborting) throw new ConvexError('Upload is being removed');
  if (lease.size !== args.size || lease.contentType !== args.contentType) throw new ConvexError('Uploaded media does not match the requested file');
  const project = await projectIdentity(ctx, lease.projectId, lease.ownerId);
  // The action performed external IO; access may have expired since authorization.
  if (!lease.taskId && !lease.jobId) await requireEditorAccess(ctx, lease.ownerId);
  const task=lease.taskId?await requireMediaTask(ctx,lease.taskId,lease.taskLeaseToken??''):null;
  const source=await previewSource(ctx,lease,task);
  if(lease.purpose==='preview'&&source){
    if(!lease.duration||!lease.width||!lease.height)throw new ConvexError('Preview metadata is incomplete');
    if(hasPreview(source)){
      await forgetStorageObject(ctx,lease.ownerId,{r2Key:lease.key});
      await ctx.scheduler.runAfter(0,internal.r2.deleteObject,{key:lease.key});
    }else{
      const preview={previewR2Key:lease.key,previewSize:lease.size,previewWidth:lease.width,previewHeight:lease.height,previewFps:lease.previewFps!,previewVersion:lease.previewVersion!};
      await ctx.db.patch(source._id,preview);
      await recordStorageObject(ctx,{ownerId:source.ownerId,r2Key:preview.previewR2Key,fileName:`${source.fileName} preview`,kind:'video',size:preview.previewSize,createdAt:source.createdAt,auxiliary:true});
      if(source.previewR2Key&&source.previewR2Key!==lease.key){await releaseMediaObjects(ctx,{previewR2Key:source.previewR2Key});await releaseAccountStorage(ctx,source.ownerId,{r2Key:source.previewR2Key},'preview');}
    }
    await ctx.db.patch(lease._id,{completed:true,assetId:source._id});
    return source._id;
  }
  if (lease.jobId) {
    const job = await ctx.db.get(lease.jobId);
    if (!job || job.ownerId !== lease.ownerId || job.status !== 'rendering' || lease.contentType !== 'video/mp4') throw new ConvexError('Render cannot accept this output');
    await recordStorageObject(ctx,{ownerId:lease.ownerId,r2Key:lease.key,fileName:lease.fileName,size:lease.size,kind:'export',jobId:job._id,createdAt:job.createdAt});
    await ctx.db.patch(job._id, { outputSize:lease.size, outputR2Key: lease.key, status: lease.taskId ? 'rendering' : 'completed', progress: lease.taskId ? 99 : 100, updatedAt: Date.now() });
    await ctx.db.patch(lease._id, { completed: true }); return null;
  }
  const count = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', lease.ownerId).eq('projectId', project._id)).take(200);
  if (count.length >= 200) throw new ConvexError('A project supports up to 200 media files');
  const assetId = await ctx.db.insert('assets', { ownerId: lease.ownerId, projectId: lease.projectId, r2Key: lease.key, fileName: lease.fileName, contentType: lease.contentType, kind: lease.kind, size: lease.size, createdAt: Date.now(), ...(lease.duration !== undefined ? { duration: lease.duration } : {}), ...(lease.width !== undefined ? { width: lease.width } : {}), ...(lease.height !== undefined ? { height: lease.height } : {}) });
  await recordAssetStorage(ctx,(await ctx.db.get(assetId))!);
  await ctx.db.patch(lease._id, { completed: true, assetId });
  if (lease.taskId) await ctx.db.patch(lease.taskId, { outputAssetId: assetId });
  else if (lease.kind !== 'image') {
    // The lease reserved this source's tasks before its bytes moved, so only a
    // lease older than its reservation meets a backstop of twice the limit.
    // Fresh leases skip the read: running tasks heartbeat constantly, and
    // reading them here made finishing collide with those writes on every retry.
    if (Date.now() - lease._creationTime > UPLOAD_RESERVATION_MS) await requireMediaTaskCapacity(ctx, lease.ownerId, uploadPreparationTasks(lease.kind), { ceiling: 2, countUploads: false });
    await enqueueMediaTask(ctx, { ownerId: lease.ownerId, projectId: lease.projectId, assetId, kind: lease.kind === 'video' ? 'extract' : 'waveform' });
    if(lease.kind==='video')await enqueueMediaTask(ctx,{ownerId:lease.ownerId,projectId:lease.projectId,assetId,kind:'preview'});
    if (lease.kind === 'video') await enqueueMediaTask(ctx, { ownerId: lease.ownerId, projectId: lease.projectId, assetId, kind: 'understand' });
    else await enqueueMediaTask(ctx, { ownerId: lease.ownerId, projectId: lease.projectId, assetId, kind: 'transcribe' });
  }
  return assetId;
}});
export const complete = action({ args: { uploadId: v.id('r2Uploads'), parts: partsValidator, ...taskAuth }, returns: v.union(v.id('assets'), v.null()), handler: async (ctx, args): Promise<Id<'assets'> | null> => {
  const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: args.uploadId, ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}) });
  return completeUpload(ctx, lease, args.parts);
}});
export async function completeUpload(ctx: ActionCtx, lease: Doc<'r2Uploads'>, parts: { partNumber: number; etag: string }[]): Promise<Id<'assets'> | null> {
  const args = { uploadId: lease._id, parts };
  if (lease.completed) return lease.assetId ?? null;
  if (args.parts.length !== Math.ceil(lease.size / lease.partSize) || args.parts.some((part, i) => part.partNumber !== i + 1 || !part.etag || part.etag.length > 256)) throw new ConvexError('Upload parts are incomplete');
  const file = await storageControl({ action: 'complete', key: lease.key, uploadId: lease.uploadId, parts: args.parts });
  if (file.size === undefined || !file.contentType) throw new ConvexError('Cloudflare did not return media metadata');
  // The bytes are already assembled in R2; a lost write race must not discard them.
  const size = file.size, contentType = file.contentType;
  return retryOnWriteConflict(() => ctx.runMutation(internal.r2.finish, { uploadId: args.uploadId, size, contentType }));
}
export const abort = action({ args: { uploadId: v.id('r2Uploads'), ...taskAuth }, returns: v.null(), handler: async (ctx, args): Promise<null> => {
  const lease = await ctx.runMutation(internal.r2.beginAbort, args);
  if (lease&&!lease.completed) { await storageControl({ action: 'abort', key: lease.key, uploadId: lease.uploadId }); await storageControl({ action: 'delete', key: lease.key }); await ctx.runMutation(internal.r2.removeLease, { uploadId: args.uploadId }); }
  return null;
}});
export const deleteObject = internalAction({ args: { key: v.string(),attempt:v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  if(isStockAudioKey(args.key))return null;
  try{await storageControl({ action: 'delete', key: args.key });}
  catch(error){const attempt=args.attempt??0;if(attempt>=8)throw error;await ctx.scheduler.runAfter(Math.min(3600_000,60_000*2**attempt),internal.r2.deleteObject,{key:args.key,attempt:attempt+1});}
  return null;
} });

export const leaseForCleanup = internalQuery({ args: { uploadId: v.id('r2Uploads') }, returns: v.union(r2UploadDocument, v.null()), handler: (ctx, args) => ctx.db.get(args.uploadId) });
export const removeLease = internalMutation({ args: { uploadId: v.id('r2Uploads') }, returns: v.null(), handler: async (ctx, args) => { const lease=await ctx.db.get(args.uploadId);if(!lease)return null;if(!lease.completed){if(!lease.aborting)throw new ConvexError('Upload cleanup has not started');await forgetStorageObject(ctx,lease.ownerId,{r2Key:lease.key});}await ctx.db.delete(args.uploadId); return null; } });
export const cleanupLease = internalAction({ args: { uploadId: v.id('r2Uploads'),attempt:v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args): Promise<null> => {
  const lease = await ctx.runMutation(internal.r2.beginAbort, {uploadId:args.uploadId,scheduled:true});
  if (!lease) return null;
  try {
    if (!lease.completed && !isStockAudioKey(lease.key)) { await storageControl({ action: 'abort', key: lease.key, uploadId: lease.uploadId }); await storageControl({ action: 'delete', key: lease.key }); }
    await ctx.runMutation(internal.r2.removeLease, {uploadId:args.uploadId});
  } catch(error) {
    const attempt=args.attempt??0;if(attempt>=8)throw error;
    await ctx.scheduler.runAfter(Math.min(3600_000,60_000*2**attempt),internal.r2.cleanupLease,{uploadId:args.uploadId,attempt:attempt+1});
  }
  return null;
} });
