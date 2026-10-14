import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/** Remove a project attachment; retain the object while another project uses it. */
export async function removeMediaAttachment(ctx: MutationCtx, asset: Doc<'assets'>) {
  await ctx.db.delete(asset._id);
  if(asset.thumbnailStorageId){
    const remaining=await ctx.db.query('assets').withIndex('by_thumbnailStorageId',q=>q.eq('thumbnailStorageId',asset.thumbnailStorageId)).first();
    if(!remaining)await ctx.storage.delete(asset.thumbnailStorageId);
  }
  if (asset.storageId) {
    const remaining = await ctx.db.query('assets').withIndex('by_storageId', q => q.eq('storageId', asset.storageId)).first();
    if (!remaining) await ctx.storage.delete(asset.storageId);
  }
  if (asset.r2Key) {
    const remaining = await ctx.db.query('assets').withIndex('by_r2Key', q => q.eq('r2Key', asset.r2Key)).first();
    if (!remaining) await ctx.scheduler.runAfter(0, internal.r2.deleteObject, { key: asset.r2Key });
  }
}
