import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { cancelMediaTask, enqueueMediaTask } from './lib/media_queue';
import { referenceBox } from './schema';
import { READ_TOOL_INPUTS } from './lib/reference_reads';
import { LOOKS_OFF, looksSwitchedOff } from '../lib/ai/eyes';

// The reference-read rows and their lifecycle. The runners that queue a read and wait for the worker are in lib/reference_reads.

export const request = internalMutation({ args: { ownerId: v.string(), projectId: v.id('projects'), assetId: v.string(), mode: v.union(v.literal('sheet'), v.literal('looks')), start: v.number(), end: v.number(), times: v.optional(v.array(v.number())), count: v.optional(v.number()), fps: v.optional(v.number()), momentsOnly: v.optional(v.boolean()), stillsOnly: v.optional(v.boolean()), crop: v.optional(referenceBox) }, returns: v.id('referenceReads'), handler: async (ctx, { ownerId, projectId, assetId: rawAssetId, ...args }) => {
  // Safety valve: REEL_LOOKS=off stops face measurement on this deployment; the reel lane then warns instead of checking.
  if (args.mode === 'looks' && looksSwitchedOff()) throw new ConvexError(LOOKS_OFF);
  await requireEditorAccess(ctx, ownerId);
  const project = await requireProject(ctx, projectId, ownerId, false);
  const assetId = ctx.db.normalizeId('assets', rawAssetId), asset = assetId ? await ctx.db.get(assetId) : null;
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== project._id) throw new ConvexError('That media is not in this project. Use an assetId from getProject.');
  const still = asset.kind === 'image';
  if (asset.kind !== 'video' && !still) throw new ConvexError('Choose a video or image from this project.');
  if (still && args.mode !== 'sheet') throw new ConvexError('Still images support readFrames only.');
  if (still && args.mode === 'sheet' && (args.start !== 0 || args.end !== 0 || args.fps !== undefined || args.momentsOnly || (args.count ?? 1) !== 1)) throw new ConvexError('Read a still image with start: 0, end: 0, count: 1; it has no moving frames.');
  const duration = still ? Infinity : asset.duration ?? Infinity;
  if(args.mode==='sheet'&&args.times&&(args.times.length>30||!args.times.length||args.times.some(time=>!Number.isFinite(time)||time<args.start||time>args.end||time<0||time>duration)))throw new ConvexError('Explicit frame times must be inside the source start/end window (up to 30 stills).');
  if (args.start > duration || args.end < args.start) throw new ConvexError(`Choose a window inside the video (0 to ${Math.round(duration * 100) / 100} source seconds).`);
  await requireMediaTaskCapacity(ctx, ownerId, 1);
  const readId = await ctx.db.insert('referenceReads', { projectId: project._id, ownerId, assetId: asset._id, ...args, status: 'queued', createdAt: Date.now() });
  const taskId = await enqueueMediaTask(ctx, { ownerId, projectId: project._id, kind: 'read', assetId: asset._id, readId });
  await ctx.db.patch(readId, { taskId });
  // Readings are returned once; anything unread is removed shortly after.
  await ctx.scheduler.runAfter(10 * 60_000, internal.referenceReads.discard, { readId });
  return readId;
}});

export const get = internalQuery({ args: { ownerId: v.string(), readId: v.id('referenceReads') }, returns: v.any(), handler: async (ctx, args) => {
  const read = await ctx.db.get(args.readId);
  if (!read || read.ownerId !== args.ownerId) throw new ConvexError('Frame reading not found.');
  return { status: read.status, ...(read.error ? { error: read.error } : {}), ...(read.result ? { result: read.result } : {}), ...(read.resultStorageId ? { resultStorageId: read.resultStorageId } : {}) };
}});

/** Source evidence is independent of the editor timeline, but bound to its original source request. */
export const resumeFrames = internalQuery({
  args: { ownerId: v.string(), projectId: v.id('projects'), checkId: v.string(), input: v.any() },
  returns: v.id('referenceReads'),
  handler: async (ctx, args) => {
    await requireEditorAccess(ctx, args.ownerId);
    await requireProject(ctx, args.projectId, args.ownerId, false);
    const id = ctx.db.normalizeId('referenceReads', args.checkId);
    const read = id ? await ctx.db.get(id) : null;
    const input = READ_TOOL_INPUTS.readFrames.parse(args.input);
    const assetId = ctx.db.normalizeId('assets', input.assetId);
    const asset = assetId ? await ctx.db.get(assetId) : null;
    if (!read || read.ownerId !== args.ownerId || read.projectId !== args.projectId || read.assetId !== assetId || read.mode !== 'sheet' || read.createdAt + 600_000 <= Date.now() || !asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId) throw new ConvexError('Source frame check not found for this request.');
    for (const key of ['start', 'end', 'times', 'count', 'fps', 'stillsOnly', 'momentsOnly', 'crop'] as const) {
      if (JSON.stringify(key === 'crop' && read.crop ? [read.crop.x, read.crop.y, read.crop.w, read.crop.h] : read[key]) !== JSON.stringify(key === 'crop' && input.crop ? [input.crop.x, input.crop.y, input.crop.w, input.crop.h] : input[key])) throw new ConvexError('Resume source frames with the original arguments from nextAction.');
    }
    return read._id;
  },
});

/** get, deleting a finished or failed reading as it is read, so its images are read once instead of again by discard. */
export const take = internalMutation({ args: { ownerId: v.string(), readId: v.id('referenceReads') }, returns: v.any(), handler: async (ctx, args) => {
  const read = await ctx.db.get(args.readId);
  if (!read || read.ownerId !== args.ownerId) throw new ConvexError('Frame reading not found.');
  if (read.status !== 'queued' && !read.resultStorageId) await ctx.db.delete(read._id);
  return { status: read.status, ...(read.error ? { error: read.error } : {}), ...(read.result ? { result: read.result } : {}), ...(read.resultStorageId ? { resultStorageId: read.resultStorageId } : {}) };
}});

export const discard = internalMutation({ args: { readId: v.id('referenceReads') }, returns: v.null(), handler: async (ctx, args) => {
  const read = await ctx.db.get(args.readId);
  if (read?.status === 'queued' && (read.mode === 'compare' || read.recreation) && read.taskId) await cancelMediaTask(ctx, read.taskId);
  if (read) { if(read.resultStorageId)await ctx.storage.delete(read.resultStorageId); await ctx.db.delete(read._id); }
  return null;
}});
