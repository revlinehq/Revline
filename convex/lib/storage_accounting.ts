import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type StoredObject = { r2Key?:string; storageId?:Id<'_storage'> };
type ObjectDetails = StoredObject & { ownerId:string; fileName:string; kind:'video'|'audio'|'image'|'export'; size:number; createdAt:number; auxiliary?:boolean; pending?:boolean; jobId?:Id<'renderJobs'> };
type Context = MutationCtx | QueryCtx;
export const STORAGE_LIMIT_BYTES = 15_000_000_000;
export function storageLimit() {
  const value = process.env.ACCOUNT_STORAGE_LIMIT_BYTES;
  const limit = value ? Number(value) : STORAGE_LIMIT_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid account storage allowance');
  return limit;
}
export function objectKey(source:StoredObject) { return source.r2Key ? `r2:${source.r2Key}` : source.storageId ? `convex:${source.storageId}` : null; }
export const emptyStorage = { usedBytes:0,reservedBytes:0,videoBytes:0,audioBytes:0,imageBytes:0,exportBytes:0,fileCount:0 };
export async function storageAccount(ctx:Context,ownerId:string) { return ctx.db.query('storageAccounts').withIndex('by_owner',q=>q.eq('ownerId',ownerId)).unique(); }
export async function accountingReady(ctx:Context) { return !!(await ctx.db.query('storageAccounting').withIndex('by_name',q=>q.eq('name','objects-v1')).unique())?.ready; }
async function adjust(ctx:MutationCtx,ownerId:string,source:Pick<Doc<'storageObjects'>,'kind'|'size'|'pending'|'auxiliary'>,direction:1|-1) {
  const row = await storageAccount(ctx,ownerId), values = {...emptyStorage,...row};
  const delta = direction * source.size;
  if (source.pending) values.reservedBytes += delta;
  else {
    values.usedBytes += delta;
    values[`${source.kind}Bytes`] += delta;
    if (!source.auxiliary) values.fileCount += direction;
  }
  const next = Object.fromEntries(Object.keys(emptyStorage).map(key=>[key,values[key as keyof typeof emptyStorage]])) as typeof emptyStorage;
  if (Object.values(next).some(n=>n<0)) throw new Error('Storage accounting is inconsistent');
  if (row) await ctx.db.patch(row._id,next); else await ctx.db.insert('storageAccounts',{ownerId,...next});
}
/** One record per physical object per account, even when several projects reuse it. */
export async function recordStorageObject(ctx:MutationCtx,source:ObjectDetails,backfill=false) {
  const key=objectKey(source); if(!key)return;
  if (!Number.isSafeInteger(source.size)||source.size<0) throw new ConvexError('Invalid stored file size');
  const existing=await ctx.db.query('storageObjects').withIndex('by_owner_key',q=>q.eq('ownerId',source.ownerId).eq('objectKey',key)).unique();
  const pending=source.pending??false, auxiliary=source.auxiliary??false;
  if(existing&&!existing.pending)return;
  // Reserving bytes and inserting the lease share one transaction, so concurrent uploads cannot overbook.
  if(!existing&&!backfill&&await accountingReady(ctx)) {
    const account=await storageAccount(ctx,source.ownerId);
    if((account?.usedBytes??0)+(account?.reservedBytes??0)+source.size>storageLimit()) throw new ConvexError('Your cloud storage is full. Delete unused media or old exports before uploading.');
  }
  if(existing)await adjust(ctx,source.ownerId,existing,-1);
  const next={ownerId:source.ownerId,fileName:source.fileName,kind:source.kind,size:source.size,createdAt:source.createdAt,objectKey:key,pending,auxiliary,...(source.r2Key?{r2Key:source.r2Key}:{}),...(source.storageId?{storageId:source.storageId}:{}),...(source.jobId?{jobId:source.jobId}:{})};
  if(existing)await ctx.db.replace(existing._id,next);else await ctx.db.insert('storageObjects',next);
  await adjust(ctx,source.ownerId,next,1);
}
export async function forgetStorageObject(ctx:MutationCtx,ownerId:string,source:StoredObject) {
  const key=objectKey(source);if(!key)return;
  const row=await ctx.db.query('storageObjects').withIndex('by_owner_key',q=>q.eq('ownerId',ownerId).eq('objectKey',key)).unique();
  if(row){await adjust(ctx,ownerId,row,-1);await ctx.db.delete(row._id);}
}
export async function recordAssetStorage(ctx:MutationCtx,asset:Doc<'assets'>,backfill=false) {
  await recordStorageObject(ctx,asset,backfill);
  if(asset.thumbnailStorageId){const metadata=await ctx.db.system.get(asset.thumbnailStorageId);if(metadata)await recordStorageObject(ctx,{ownerId:asset.ownerId,storageId:asset.thumbnailStorageId,fileName:`${asset.fileName} thumbnail`,size:metadata.size,kind:'image',createdAt:asset.createdAt,auxiliary:true},backfill);}
}
export async function ownedObjectReferences(ctx:Context,ownerId:string,source:StoredObject,thumbnail=false) {
  const assets=source.r2Key ? ctx.db.query('assets').withIndex('by_owner_r2Key',q=>q.eq('ownerId',ownerId).eq('r2Key',source.r2Key)) : thumbnail ? ctx.db.query('assets').withIndex('by_owner_thumbnail',q=>q.eq('ownerId',ownerId).eq('thumbnailStorageId',source.storageId)) : ctx.db.query('assets').withIndex('by_owner_storageId',q=>q.eq('ownerId',ownerId).eq('storageId',source.storageId));
  const pins=source.r2Key ? ctx.db.query('shareAssets').withIndex('by_owner_r2Key',q=>q.eq('ownerId',ownerId).eq('r2Key',source.r2Key)) : thumbnail ? ctx.db.query('shareAssets').withIndex('by_owner_thumbnail',q=>q.eq('ownerId',ownerId).eq('thumbnailStorageId',source.storageId)) : ctx.db.query('shareAssets').withIndex('by_owner_storageId',q=>q.eq('ownerId',ownerId).eq('storageId',source.storageId));
  const [attachments,shares]=await Promise.all([assets.take(201),pins.take(201)]);
  return {attachments,shares,tooMany:attachments.length>200||shares.length>200};
}
export async function releaseAccountStorage(ctx:MutationCtx,ownerId:string,source:StoredObject,thumbnail=false) {
  if(!objectKey(source))return;
  const refs=await ownedObjectReferences(ctx,ownerId,source,thumbnail);
  if(!refs.attachments.length&&!refs.shares.length)await forgetStorageObject(ctx,ownerId,source);
}
export async function usedByActiveExport(ctx:Context,ownerId:string,projectId:Id<'projects'>,assetIds:Set<string>) {
  const jobs=await Promise.all((['queued','rendering'] as const).map(status=>ctx.db.query('renderJobs').withIndex('by_owner_project_status',q=>q.eq('ownerId',ownerId).eq('projectId',projectId).eq('status',status)).take(2)));
  return jobs.some(group=>group.length>=2||group.some(job=>job.assetIds?.some(id=>assetIds.has(String(id)))));
}
