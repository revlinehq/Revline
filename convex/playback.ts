import { previewSegmentUrl } from './schema';
import type { PreviewSegment } from '../lib/editor/types';
import { ConvexError, v } from 'convex/values';
import { action, internalQuery, mutation } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOwner, requireProject } from './lib/auth';
import { enqueueMediaTask } from './lib/media_queue';
import { requireMediaTask } from './lib/media_task_auth';
import { mediaTaskCredentials } from './lib/media_task_contract';
import { recordAssetStorage } from './lib/storage_accounting';
import { requireEditorAccess } from './lib/billing_access';
import { hasPreview, mediaUrl, previewUrl } from './lib/media_storage';

const request = { projectId: v.id('projects'), assetIds: v.array(v.id('assets')) };
const refreshedPreview={previewUrl:v.optional(v.union(v.string(),v.null())),previewSegments:v.optional(v.array(previewSegmentUrl))};
const source = v.object({ ...refreshedPreview, _id: v.id('assets'), storageId: v.optional(v.id('_storage')), r2Key: v.optional(v.string()) });
type PlaybackSource = { _id: Id<'assets'>; storageId?: Id<'_storage'>; r2Key?: string;previewUrl?:string|null;previewSegments?:PreviewSegment[] };
type PlaybackUrl = { _id: Id<'assets'>; url: string | null;previewUrl?:string|null;previewSegments?:PreviewSegment[] };

export const authorize = internalQuery({
  args: request, returns: v.array(source),
  handler: async (ctx, args): Promise<PlaybackSource[]> => {
    const ownerId = await requireOwner(ctx);
    await requireProject(ctx, args.projectId, ownerId);
    if (args.assetIds.length > 200) throw new ConvexError('Refresh up to 200 project media files');
    const assets = await Promise.all([...new Set(args.assetIds)].map(id => ctx.db.get(id)));
    return Promise.all(assets.map(async asset => {
      if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId) throw new ConvexError('Media not found');
      return { ...await previewUrl(ctx,asset,true),_id: asset._id, ...(!hasPreview(asset)&&asset.storageId ? { storageId: asset.storageId } : {}), ...(hasPreview(asset)?{r2Key:asset.previewR2Key}:asset.r2Key ? { r2Key: asset.r2Key } : {}) };
    }));
  },
});

// Sign in an action so an unchanged, cached source query cannot reuse an expired URL.
export const refresh = action({
  args: request, returns: v.array(v.object({ ...refreshedPreview,_id: v.id('assets'), url: v.union(v.string(), v.null()) })),
  handler: async (ctx, args): Promise<PlaybackUrl[]> => {
    const assets = await ctx.runQuery(internal.playback.authorize, args);
    return Promise.all(assets.map(async asset => ({ _id: asset._id, url: await mediaUrl(ctx, asset,true),...(asset.previewUrl?{previewUrl:asset.previewUrl}:{}),...(asset.previewSegments?{previewSegments:asset.previewSegments}:{}) })));
  },
});

/** Prepare legacy footage once; durable tasks deduplicate repeated client requests. */
export const prepare=mutation({args:request,returns:v.array(v.id('mediaTasks')),handler:async(ctx,args)=>{
  const ownerId=await requireOwner(ctx);await requireProject(ctx,args.projectId,ownerId);await requireEditorAccess(ctx,ownerId);
  if(args.assetIds.length>200)throw new ConvexError('Prepare up to 200 project media files');
  const assets=await Promise.all([...new Set(args.assetIds)].map(id=>ctx.db.get(id)));
  for(const asset of assets)if(!asset||asset.ownerId!==ownerId||asset.projectId!==args.projectId||asset.kind!=='video')throw new ConvexError('Choose video from this project');
  const tasks:Id<'mediaTasks'>[]=[];
  for(const asset of assets)if(asset&&!hasPreview(asset))tasks.push(await enqueueMediaTask(ctx,{ownerId,projectId:args.projectId,assetId:asset._id,kind:'preview'}));
  return tasks;
}});

/** Only the leased preview worker can publish probed playback compatibility and its early poster. */
export const identify = mutation({args:{...mediaTaskCredentials,originalPlayable:v.boolean()},returns:v.null(),handler:async(ctx,args)=>{
  const task=await requireMediaTask(ctx,args.taskId,args.leaseToken);
  if(task.kind!=='preview'||!task.assetId)throw new ConvexError('A preview task is required');
  await ctx.db.patch(task.assetId,{previewOriginalPlayable:args.originalPlayable});return null;
}});
export const posterUploadUrl = mutation({args:mediaTaskCredentials,returns:v.string(),handler:async(ctx,args)=>{
  const task=await requireMediaTask(ctx,args.taskId,args.leaseToken);
  if(task.kind!=='preview'||!task.assetId)throw new ConvexError('A preview task is required');
  return ctx.storage.generateUploadUrl();
}});
export const attachPoster = mutation({args:{...mediaTaskCredentials,storageId:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const task=await requireMediaTask(ctx,args.taskId,args.leaseToken);
  const asset=task.assetId?await ctx.db.get(task.assetId):null;
  if(task.kind!=='preview'||!asset||asset.ownerId!==task.ownerId||asset.projectId!==task.projectId)throw new ConvexError('Preview source is unavailable');
  const storageId=ctx.db.system.normalizeId('_storage',args.storageId);if(!storageId)throw new ConvexError('Invalid poster storage id');
  const metadata=await ctx.db.system.get(storageId);
  if(!metadata||metadata.contentType!=='image/jpeg'||metadata.size>128*1024)throw new ConvexError('Use a JPEG poster under 128 KB');
  if(asset.thumbnailStorageId){if(asset.thumbnailStorageId!==storageId)await ctx.storage.delete(storageId);return null;}
  await ctx.db.patch(asset._id,{thumbnailStorageId:storageId});
  await recordAssetStorage(ctx,{...asset,thumbnailStorageId:storageId});return null;
}});
