import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx,QueryCtx } from '../_generated/server';
const sourceKey=(asset:Doc<'assets'>)=>asset.r2Key??asset.storageId??asset._id;
const modes={transcript:'transcribe',understanding:'understand',shots:'shots',beats:'beats',focus:'track',reference:'reference'} as const;
export async function hydrateAsset(ctx:MutationCtx|QueryCtx,asset:Doc<'assets'>):Promise<Doc<'assets'>> {
  if(asset.analysis||!asset.analysisId)return asset;
  const saved=await ctx.db.get(asset.analysisId);
  if(!saved||saved.ownerId!==asset.ownerId||saved.sourceKey!==sourceKey(asset))throw new ConvexError('Source analysis is unavailable');
  return {...asset,analysis:saved.analysis};
}
export async function storeAnalysis(ctx:MutationCtx,asset:Doc<'assets'>,analysis:NonNullable<Doc<'assets'>['analysis']>,updatedAt=Date.now()) {
  const row=await ctx.db.query('assetAnalyses').withIndex('by_owner_source',q=>q.eq('ownerId',asset.ownerId).eq('sourceKey',sourceKey(asset))).unique();
  const merged=row&&row.updatedAt>updatedAt?{...analysis,...row.analysis}:analysis;
  const analysisId=row?row._id:await ctx.db.insert('assetAnalyses',{ownerId:asset.ownerId,sourceKey:sourceKey(asset),analysis:merged,updatedAt});
  if(row)await ctx.db.patch(row._id,{analysis:merged,updatedAt:Math.max(row.updatedAt,updatedAt)});
  const patch={analysis:undefined,analysisId,analysisKinds:Object.entries(modes).filter(([key])=>merged[key as keyof typeof modes]!==undefined).map(([,mode])=>mode),editSuggestions:merged.understanding?.suggestions};
  await ctx.db.patch(asset._id,patch);return {...asset,...patch};
}
/** A copied attachment shares source observations instead of duplicating them. */
export async function shareAnalysis(ctx:MutationCtx,asset:Doc<'assets'>) {
  return asset.analysis?storeAnalysis(ctx,asset,asset.analysis,asset.analysisUpdatedAt??0):asset;
}
