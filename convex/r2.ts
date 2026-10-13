import { requireEditorAccess } from './lib/billing_access';
import type { Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireOwner, requireProject } from './lib/auth';
import { assetKind, r2UploadDocument } from './schema';
import { mediaConfig, storageControl } from './lib/media_storage';
import { signMediaToken } from '../lib/storage/media-tokens';
import { requireMediaTask } from './lib/media_task_auth';
import { enqueueMediaTask } from './mediaTasks';

const metadata = { fileName: v.string(), contentType: v.string(), kind: assetKind, size: v.number(), duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()) };
const partsValidator = v.array(v.object({ partNumber: v.number(), etag: v.string() }));
const uploadInfo = v.object({ uploadId: v.id('r2Uploads'), partSize: v.number(), partCount: v.number() });
const taskAuth = { taskId: v.optional(v.id('mediaTasks')), leaseToken: v.optional(v.string()) };

export const authorize = internalQuery({ args: { projectId: v.id('projects'), jobId: v.optional(v.id('renderJobs')), workerSecret: v.optional(v.string()), ...taskAuth, kind: assetKind, contentType: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  const task = args.taskId && args.leaseToken ? await requireMediaTask(ctx, args.taskId, args.leaseToken) : null;
  if (args.taskId && !task) throw new ConvexError('Media task credentials are required');
  const ownerId = task?.ownerId ?? await requireOwner(ctx); await requireProject(ctx, args.projectId, ownerId);
  if (!task && !args.jobId) await requireEditorAccess(ctx, ownerId);
  if (task && (task.projectId !== args.projectId || !['extract', 'render', 'import'].includes(task.kind) || (task.kind === 'import' && (args.jobId || args.kind !== 'video' || args.contentType !== 'video/mp4')) || (task.kind === 'extract' && (args.jobId || args.kind !== 'audio' || args.contentType !== 'audio/mp4')) || (task.kind === 'render' && (args.jobId !== task.renderJobId || args.kind !== 'video' || args.contentType !== 'video/mp4')))) throw new ConvexError('This task cannot upload that media');
  if (args.jobId && !task) {
    if (!process.env.RENDER_WORKER_SECRET || args.workerSecret !== process.env.RENDER_WORKER_SECRET) throw new ConvexError('Render worker authentication required');
    const job = await ctx.db.get(args.jobId);
    if (!job || job.ownerId !== ownerId || job.projectId !== args.projectId || job.status !== 'rendering') throw new ConvexError('Render is not accepting an upload');
  }
  const pending = await ctx.db.query('r2Uploads').withIndex('by_projectId_completed', q => q.eq('projectId', args.projectId).eq('completed', false)).take(101);
  if (pending.filter(upload => !upload.completed && upload.expiresAt > Date.now()).length >= 100) throw new ConvexError('Finish the pending uploads first');
  return ownerId;
}});
export const createLease = internalMutation({ args: { ...metadata, ownerId: v.string(), projectId: v.id('projects'), jobId: v.optional(v.id('renderJobs')), ...taskAuth, key: v.string(), uploadId: v.string(), partSize: v.number() }, returns: v.id('r2Uploads'), handler: async (ctx, args) => {
  await requireProject(ctx, args.projectId, args.ownerId);
  if (args.taskId) await requireMediaTask(ctx, args.taskId, args.leaseToken ?? '');
  const { leaseToken, ...fields } = args;
  const id = await ctx.db.insert('r2Uploads', { ...fields, ...(leaseToken ? { taskLeaseToken: leaseToken } : {}), completed: false, expiresAt: Date.now() + 24 * 3600_000 });
  await ctx.scheduler.runAfter(24 * 3600_000, internal.r2.cleanupLease, { uploadId: id });
  return id;
}});
export const getLease = internalQuery({ args: { uploadId: v.id('r2Uploads'), ...taskAuth }, returns: r2UploadDocument, handler: async (ctx, args) => {
  const lease = await ctx.db.get(args.uploadId);
  const task = args.taskId && args.leaseToken ? await requireMediaTask(ctx, args.taskId, args.leaseToken) : null;
  if (task && (!lease || lease.taskId !== task._id || lease.taskLeaseToken !== args.leaseToken)) throw new ConvexError('Upload belongs to another task attempt');
  const ownerId = task?.ownerId ?? await requireOwner(ctx);
  if (!lease || lease.ownerId !== ownerId || lease.expiresAt < Date.now()) throw new ConvexError('Upload expired or belongs to another user');
  await requireProject(ctx, lease.projectId, ownerId); return lease;
}});

export const start = action({ args: { projectId: v.id('projects'), jobId: v.optional(v.id('renderJobs')), workerSecret: v.optional(v.string()), ...taskAuth, ...metadata }, returns: uploadInfo, handler: async (ctx, args): Promise<{ uploadId: Id<'r2Uploads'>; partSize: number; partCount: number }> => {
  const ownerId = await ctx.runQuery(internal.r2.authorize, { projectId: args.projectId, kind: args.kind, contentType: args.contentType, ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}), ...(args.jobId ? { jobId: args.jobId, workerSecret: args.workerSecret } : {}) });
  const fileName = args.fileName.trim();
  if (!fileName || fileName.length > 255 || !/^(video|image|audio)\//.test(args.contentType) || args.contentType.length > 128) throw new ConvexError('Choose a supported media file');
  if (!args.contentType.startsWith(`${args.kind}/`) && !(args.kind === 'audio' && /^video\/(mp4|quicktime|webm)$/.test(args.contentType))) throw new ConvexError('File content type does not match the media');
  if (!Number.isSafeInteger(args.size) || args.size < 1) throw new ConvexError('This file is empty or has an invalid size');
  if (args.duration !== undefined && (!Number.isFinite(args.duration) || args.duration <= 0 || args.duration > 86400)) throw new ConvexError('Invalid media duration');
  if (args.kind !== 'audio' && (![args.width, args.height].every(n => Number.isInteger(n) && n! > 0 && n! <= 16384))) throw new ConvexError('This media has no readable dimensions');
  const partSize = 32 * 1024 * 1024, partCount = Math.ceil(args.size / partSize);
  if (partCount > 10000) throw new ConvexError('This file exceeds the multipart transport limit');
  const key = `media/${ownerId}/${args.projectId}/${crypto.randomUUID()}`;
  const created = await storageControl({ action: 'create', key, contentType: args.contentType });
  if (!created.uploadId) throw new ConvexError('Cloudflare did not open the upload');
  try {
    const uploadId = await ctx.runMutation(internal.r2.createLease, { projectId: args.projectId, ownerId, key, uploadId: created.uploadId, partSize, fileName, contentType: args.contentType, kind: args.kind, size: args.size, ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}), ...(args.jobId ? { jobId: args.jobId } : {}), ...(args.duration !== undefined ? { duration: args.duration } : {}), ...(args.width !== undefined ? { width: args.width } : {}), ...(args.height !== undefined ? { height: args.height } : {}) });
    return { uploadId, partSize, partCount };
  } catch (error) { await storageControl({ action: 'abort', key, uploadId: created.uploadId }); throw error; }
}});
export const partUrl = action({ args: { uploadId: v.id('r2Uploads'), partNumber: v.number(), ...taskAuth }, returns: v.string(), handler: async (ctx, args): Promise<string> => {
  const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: args.uploadId, ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}) });
  const count = Math.ceil(lease.size / lease.partSize);
  if (lease.completed || !Number.isInteger(args.partNumber) || args.partNumber < 1 || args.partNumber > count) throw new ConvexError('Invalid upload part');
  const { url, secret } = mediaConfig();
  const size = Math.min(lease.partSize, lease.size - (args.partNumber - 1) * lease.partSize);
  const token = await signMediaToken(secret, { operation: 'part', key: lease.key, uploadId: lease.uploadId, partNumber: args.partNumber, size, expires: Date.now() + 3600_000 });
  return `${url}/part?token=${token}`;
}});
export const finish = internalMutation({ args: { uploadId: v.id('r2Uploads'), size: v.number(), contentType: v.string() }, returns: v.union(v.id('assets'), v.null()), handler: async (ctx, args) => {
  const lease = await ctx.db.get(args.uploadId);
  if (!lease || lease.expiresAt < Date.now()) throw new ConvexError('Upload expired');
  if (lease.completed) return lease.assetId ?? null;
  if (lease.size !== args.size || lease.contentType !== args.contentType) throw new ConvexError('Uploaded media does not match the requested file');
  const project = await requireProject(ctx, lease.projectId, lease.ownerId);
  if (lease.taskId) await requireMediaTask(ctx, lease.taskId, lease.taskLeaseToken ?? '');
  if (lease.jobId) {
    const job = await ctx.db.get(lease.jobId);
    if (!job || job.ownerId !== lease.ownerId || job.status !== 'rendering' || lease.contentType !== 'video/mp4') throw new ConvexError('Render cannot accept this output');
    await ctx.db.patch(job._id, { outputR2Key: lease.key, status: lease.taskId ? 'rendering' : 'completed', progress: lease.taskId ? 99 : 100, updatedAt: Date.now() });
    await ctx.db.patch(lease._id, { completed: true }); return null;
  }
  const count = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', lease.ownerId).eq('projectId', project._id)).take(200);
  if (count.length >= 200) throw new ConvexError('A project supports up to 200 media files');
  const assetId = await ctx.db.insert('assets', { ownerId: lease.ownerId, projectId: lease.projectId, r2Key: lease.key, fileName: lease.fileName, contentType: lease.contentType, kind: lease.kind, size: lease.size, createdAt: Date.now(), ...(lease.duration !== undefined ? { duration: lease.duration } : {}), ...(lease.width !== undefined ? { width: lease.width } : {}), ...(lease.height !== undefined ? { height: lease.height } : {}) });
  await ctx.db.patch(lease._id, { completed: true, assetId });
  if (lease.taskId) await ctx.db.patch(lease.taskId, { outputAssetId: assetId });
  else if (lease.kind !== 'image') {
    await enqueueMediaTask(ctx, { ownerId: lease.ownerId, projectId: lease.projectId, assetId, kind: lease.kind === 'video' ? 'extract' : 'waveform' });
    if (lease.kind === 'video') await enqueueMediaTask(ctx, { ownerId: lease.ownerId, projectId: lease.projectId, assetId, kind: 'understand' });
  }
  return assetId;
}});
export const complete = action({ args: { uploadId: v.id('r2Uploads'), parts: partsValidator, ...taskAuth }, returns: v.union(v.id('assets'), v.null()), handler: async (ctx, args): Promise<Id<'assets'> | null> => {
  const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: args.uploadId, ...(args.taskId ? { taskId: args.taskId, leaseToken: args.leaseToken } : {}) });
  if (lease.completed) return lease.assetId ?? null;
  if (args.parts.length !== Math.ceil(lease.size / lease.partSize) || args.parts.some((part, i) => part.partNumber !== i + 1 || !part.etag || part.etag.length > 256)) throw new ConvexError('Upload parts are incomplete');
  const file = await storageControl({ action: 'complete', key: lease.key, uploadId: lease.uploadId, parts: args.parts });
  if (file.size === undefined || !file.contentType) throw new ConvexError('Cloudflare did not return media metadata');
  return ctx.runMutation(internal.r2.finish, { uploadId: args.uploadId, size: file.size, contentType: file.contentType });
}});
export const abort = action({ args: { uploadId: v.id('r2Uploads'), ...taskAuth }, returns: v.null(), handler: async (ctx, args): Promise<null> => {
  const lease = await ctx.runQuery(internal.r2.getLease, args);
  if (!lease.completed) { await storageControl({ action: 'abort', key: lease.key, uploadId: lease.uploadId }); await ctx.runMutation(internal.r2.removeLease, { uploadId: args.uploadId }); }
  return null;
}});
export const deleteObject = internalAction({ args: { key: v.string() }, returns: v.null(), handler: async (_ctx, args) => { await storageControl({ action: 'delete', key: args.key }); return null; } });

export const leaseForCleanup = internalQuery({ args: { uploadId: v.id('r2Uploads') }, returns: v.union(r2UploadDocument, v.null()), handler: (ctx, args) => ctx.db.get(args.uploadId) });
export const removeLease = internalMutation({ args: { uploadId: v.id('r2Uploads') }, returns: v.null(), handler: async (ctx, args) => { await ctx.db.delete(args.uploadId); return null; } });
export const cleanupLease = internalAction({ args: { uploadId: v.id('r2Uploads') }, returns: v.null(), handler: async (ctx, args): Promise<null> => {
  const lease = await ctx.runQuery(internal.r2.leaseForCleanup, args);
  if (!lease) return null;
  if (!lease.completed) { await storageControl({ action: 'abort', key: lease.key, uploadId: lease.uploadId }); await storageControl({ action: 'delete', key: lease.key }); }
  await ctx.runMutation(internal.r2.removeLease, args); return null;
} });
