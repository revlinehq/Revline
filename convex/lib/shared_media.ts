import { releaseAccountStorage } from './storage_accounting';
import { internal } from '../_generated/api';
import type { Doc,Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { isStockAudioKey } from '../../lib/editor/stock-audio';
type StoredMedia={storageId?:Id<'_storage'>;r2Key?:string;previewR2Key?:string;thumbnailStorageId?:Id<'_storage'>};

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
  if(asset.previewR2Key){
    const [attachment,pin]=await Promise.all([
      ctx.db.query('assets').withIndex('by_previewR2Key',q=>q.eq('previewR2Key',asset.previewR2Key)).first(),
      ctx.db.query('shareAssets').withIndex('by_previewR2Key',q=>q.eq('previewR2Key',asset.previewR2Key)).first(),
    ]);if(!attachment&&!pin)await ctx.scheduler.runAfter(0,internal.r2.deleteObject,{key:asset.previewR2Key});
  }
  if(asset.r2Key&&!isStockAudioKey(asset.r2Key)){
    const [attachment,pin]=await Promise.all([
      ctx.db.query('assets').withIndex('by_r2Key',q=>q.eq('r2Key',asset.r2Key)).first(),
      ctx.db.query('shareAssets').withIndex('by_r2Key',q=>q.eq('r2Key',asset.r2Key)).first(),
    ]);if(!attachment&&!pin)await ctx.scheduler.runAfter(0,internal.r2.deleteObject,{key:asset.r2Key});
  }
}
export async function removeMediaAttachment(ctx:MutationCtx,asset:Doc<'assets'>){
  await ctx.scheduler.runAfter(0, internal.frameCache.removeAsset, {projectId:asset.projectId,assetId:asset._id});
  const segments=await ctx.db.query('previewSegments').withIndex('by_asset',q=>q.eq('assetId',asset._id)).collect();
  for(const segment of segments){await ctx.db.delete(segment._id);await ctx.scheduler.runAfter(0,internal.r2.deleteObject,{key:segment.r2Key});await releaseAccountStorage(ctx,asset.ownerId,{r2Key:segment.r2Key},'preview');}
  await ctx.db.delete(asset._id);if(asset.analysisId&&!await ctx.db.query('assets').withIndex('by_analysis',q=>q.eq('analysisId',asset.analysisId)).first())await ctx.db.delete(asset.analysisId);await releaseMediaObjects(ctx,asset);await releaseAccountStorage(ctx,asset.ownerId,asset);if(asset.previewR2Key)await releaseAccountStorage(ctx,asset.ownerId,{r2Key:asset.previewR2Key},'preview');if(asset.thumbnailStorageId)await releaseAccountStorage(ctx,asset.ownerId,{storageId:asset.thumbnailStorageId},true);
}
export async function removeShareAssets(ctx:MutationCtx,shareId:Id<'timelineShares'>){
  const share=await ctx.db.get(shareId);
  const pins=await ctx.db.query('shareAssets').withIndex('by_share',q=>q.eq('shareId',shareId)).take(201);
  for(const pin of pins)await ctx.db.delete(pin._id);
  for(const pin of pins){await releaseMediaObjects(ctx,pin);if(share){await releaseAccountStorage(ctx,share.ownerId,pin);if(pin.previewR2Key)await releaseAccountStorage(ctx,share.ownerId,{r2Key:pin.previewR2Key},'preview');if(pin.thumbnailStorageId)await releaseAccountStorage(ctx,share.ownerId,{storageId:pin.thumbnailStorageId},true);}}
}
export async function removeShareTabs(ctx:MutationCtx,shareId:Id<'timelineShares'>){
  for(const row of await ctx.db.query('shareTimelines').withIndex('by_share',q=>q.eq('shareId',shareId)).take(20))await ctx.db.delete(row._id);
}
export async function removeProjectShares(ctx:MutationCtx,projectId:Id<'projects'>){
  const shares=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).take(2);
  for(const share of shares){if(share.cardStorageId)await ctx.storage.delete(share.cardStorageId);await removeShareAssets(ctx,share._id);await removeShareTabs(ctx,share._id);await ctx.db.delete(share._id);}
}

/** The playback fields a shared timeline copies from one source asset; its analysis stays with the source. */
export function sharedAssetFields(asset: Doc<'assets'>) {
  const { _id, storageId, r2Key, fileName, contentType, size, kind, duration, width, height, audioAssetId, audioExtracted, waveform, thumbnailStorageId, previewR2Key, previewSize, previewWidth, previewHeight, previewFps, previewVersion } = asset;
  return { sourceId: _id, fileName, contentType, size, kind, ...(storageId ? { storageId } : {}), ...(r2Key ? { r2Key } : {}), ...(duration !== undefined ? { duration } : {}), ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}), ...(audioAssetId ? { audioAssetId } : {}), ...(audioExtracted !== undefined ? { audioExtracted } : {}), ...(waveform ? { waveform } : {}), ...(thumbnailStorageId ? { thumbnailStorageId } : {}), ...(previewR2Key ? { previewR2Key, previewSize, previewWidth, previewHeight, previewFps, previewVersion } : {}) };
}
