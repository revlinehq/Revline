import { releaseAccountStorage } from './storage_accounting';
import { internal } from '../_generated/api';
import type { Doc,Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
type StoredMedia={storageId?:Id<'_storage'>;r2Key?:string;thumbnailStorageId?:Id<'_storage'>};

/** Project copies and published snapshots share objects without re-uploading media. */
export async function releaseMediaObjects(ctx:MutationCtx,asset:StoredMedia){
  if(asset.thumbnailStorageId){
    const [attachment,pin]=await Promise.all([
      ctx.db.query('assets').withIndex('by_thumbnailStorageId',q=>q.eq('thumbnailStorageId',asset.thumbnailStorageId)).first(),
      ctx.db.query('shareAssets').withIndex('by_thumbnailStorageId',q=>q.eq('thumbnailStorageId',asset.thumbnailStorageId)).first(),
    ]);if(!attachment&&!pin)await ctx.storage.delete(asset.thumbnailStorageId);
  }
  if(asset.storageId){
    const [attachment,pin]=await Promise.all([
      ctx.db.query('assets').withIndex('by_storageId',q=>q.eq('storageId',asset.storageId)).first(),
      ctx.db.query('shareAssets').withIndex('by_storageId',q=>q.eq('storageId',asset.storageId)).first(),
    ]);if(!attachment&&!pin)await ctx.storage.delete(asset.storageId);
  }
  if(asset.r2Key){
    const [attachment,pin]=await Promise.all([
      ctx.db.query('assets').withIndex('by_r2Key',q=>q.eq('r2Key',asset.r2Key)).first(),
      ctx.db.query('shareAssets').withIndex('by_r2Key',q=>q.eq('r2Key',asset.r2Key)).first(),
    ]);if(!attachment&&!pin)await ctx.scheduler.runAfter(0,internal.r2.deleteObject,{key:asset.r2Key});
  }
}
export async function removeMediaAttachment(ctx:MutationCtx,asset:Doc<'assets'>){
  await ctx.db.delete(asset._id);await releaseMediaObjects(ctx,asset);await releaseAccountStorage(ctx,asset.ownerId,asset);if(asset.thumbnailStorageId)await releaseAccountStorage(ctx,asset.ownerId,{storageId:asset.thumbnailStorageId},true);
}
export async function removeShareAssets(ctx:MutationCtx,shareId:Id<'timelineShares'>){
  const share=await ctx.db.get(shareId);
  const pins=await ctx.db.query('shareAssets').withIndex('by_share',q=>q.eq('shareId',shareId)).take(201);
  for(const pin of pins)await ctx.db.delete(pin._id);
  for(const pin of pins){await releaseMediaObjects(ctx,pin);if(share){await releaseAccountStorage(ctx,share.ownerId,pin);if(pin.thumbnailStorageId)await releaseAccountStorage(ctx,share.ownerId,{storageId:pin.thumbnailStorageId},true);}}
}
export async function removeProjectShares(ctx:MutationCtx,projectId:Id<'projects'>){
  const shares=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).take(2);
  for(const share of shares){await removeShareAssets(ctx,share._id);await ctx.db.delete(share._id);}
}
