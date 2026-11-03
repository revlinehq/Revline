import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx,QueryCtx } from '../_generated/server';
const sourceKey=(asset:Doc<'assets'>)=>asset.r2Key??asset.storageId??asset._id;
const modes={highlights:'highlights',transcript:'transcribe',understanding:'understand',shots:'shots',beats:'beats',focus:'track',reference:'reference',facecam:'facecam',speakers:'speakers'} as const;
export async function hydrateAsset(ctx:MutationCtx|QueryCtx,asset:Doc<'assets'>):Promise<Doc<'assets'>> {
  if(asset.analysis||!asset.analysisId)return asset;
  const saved=await ctx.db.get(asset.analysisId);
  if(!saved||saved.ownerId!==asset.ownerId||saved.sourceKey!==sourceKey(asset))throw new ConvexError('Source analysis is unavailable');
  const analysis={...saved.analysis};
  if(analysis.transcript?.chunkCount){
    const chunks=await ctx.db.query('assetTranscriptChunks').withIndex('by_owner_source',q=>q.eq('ownerId',asset.ownerId).eq('sourceKey',sourceKey(asset))).take(64);
    if(chunks.length!==analysis.transcript.chunkCount)throw new ConvexError('Timed transcript chunks are incomplete.');
    analysis.transcript={...analysis.transcript,words:chunks.sort((a,b)=>a.chunk-b.chunk).flatMap(c=>c.words)};
  }
  return {...asset,analysis};
}
export function compactAnalysis(analysis:NonNullable<Doc<'assets'>['analysis']>) {
  const transcript=analysis.transcript;
  return transcript&&transcript.words.length>4000?{...analysis,transcript:{...transcript,words:[],wordCount:transcript.words.length,chunkCount:Math.ceil(transcript.words.length/2000)}}:analysis;
}
export async function storeAnalysis(ctx:MutationCtx,asset:Doc<'assets'>,analysis:NonNullable<Doc<'assets'>['analysis']>,updatedAt=Date.now()) {
  const row=await ctx.db.query('assetAnalyses').withIndex('by_owner_source',q=>q.eq('ownerId',asset.ownerId).eq('sourceKey',sourceKey(asset))).unique();
  if(analysis.transcript&&analysis.transcript.words.length>4000&&(!row||row.updatedAt<=updatedAt||!row.analysis.transcript)){
    const previous=await ctx.db.query('assetTranscriptChunks').withIndex('by_owner_source',q=>q.eq('ownerId',asset.ownerId).eq('sourceKey',sourceKey(asset))).take(64);
    const words=analysis.transcript.words;
    for(let i=0;i<Math.ceil(words.length/2000);i++){
      const part={ownerId:asset.ownerId,sourceKey:sourceKey(asset),chunk:i,words:words.slice(i*2000,(i+1)*2000)};
      const existing=previous.find(c=>c.chunk===i);if(existing)await ctx.db.replace(existing._id,part);else await ctx.db.insert('assetTranscriptChunks',part);
    }
    for(const old of previous)if(old.chunk>=Math.ceil(words.length/2000))await ctx.db.delete(old._id);
  }
  analysis=compactAnalysis(analysis);
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
