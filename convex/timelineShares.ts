import { writeProject,createProject } from './lib/project_data';
import { recordAssetStorage } from './lib/storage_accounting';
import { ConvexError,v } from 'convex/values';
import { mutation,query } from './_generated/server';
import type { Id,Doc } from './_generated/dataModel';
import { requireOwner,requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { validateTimeline } from './lib/timeline';
import { mediaUrl } from './lib/media_storage';
import { removeShareAssets } from './lib/shared_media';
import { timelineValidator,publicMediaAsset,sharedChatMessage,shareChatPreviewMessage } from './schema';
import { previewSharedChat,snapshotSharedChat } from './lib/share_chat';
import { normalizeTimeline } from '../lib/editor/types';
const shareStatus=v.object({_id:v.id('timelineShares'),title:v.string(),published:v.boolean(),updatedAt:v.number(),includesChat:v.boolean()});

export const status=query({args:{projectId:v.id('projects')},returns:v.union(shareStatus,v.null()),handler:async(ctx,{projectId})=>{
  await requireProject(ctx,projectId,await requireOwner(ctx));
  const share=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  return share?{_id:share._id,title:share.title,published:share.published,updatedAt:share.updatedAt,includesChat:!!share.chat?.length}:null;
}});
export const chatPreview=query({args:{projectId:v.id('projects')},returns:v.object({messages:v.array(shareChatPreviewMessage),truncated:v.boolean()}),handler:async(ctx,{projectId})=>previewSharedChat(ctx,await requireProject(ctx,projectId,await requireOwner(ctx)))});

export const publish=mutation({args:{projectId:v.id('projects'),chat:v.optional(v.array(shareChatPreviewMessage))},returns:v.id('timelineShares'),handler:async(ctx,{projectId,chat:selectedChat})=>{
  const ownerId=await requireOwner(ctx),project=await requireProject(ctx,projectId,ownerId);await requireEditorAccess(ctx,ownerId);
  if(project.aiRunning)throw new ConvexError('Wait for the current AI edit to finish before sharing.');
  if(!project.timeline?.clips.length)throw new ConvexError('Add footage or text before sharing your timeline.');
  const chat=selectedChat===undefined?undefined:await snapshotSharedChat(ctx,project,selectedChat);
  const timeline=await validateTimeline(ctx,project,project.timeline),assets=new Map<string,Doc<'assets'>>();
  const ids=[...new Set(timeline.clips.flatMap(clip=>clip.assetId?[clip.assetId]:[]))];
  for(const raw of ids){const id=ctx.db.normalizeId('assets',raw),asset=id?await ctx.db.get(id):null;if(!asset||asset.ownerId!==ownerId||asset.projectId!==projectId)throw new ConvexError('A source could not be shared.');assets.set(asset._id,asset);}
  // Preserve the linked audio source so adding this footage in the copy keeps audio separation.
  for(const asset of Array.from(assets.values()))if(asset.audioAssetId&&!assets.has(asset.audioAssetId)){
    const audio=await ctx.db.get(asset.audioAssetId);if(!audio||audio.projectId!==projectId||audio.ownerId!==ownerId)throw new ConvexError('Linked audio could not be shared.');assets.set(audio._id,audio);
  }
  if(assets.size>200)throw new ConvexError('A shared timeline supports up to 200 sources.');
  const existing=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).unique(),now=Date.now();
  const shareId=existing?existing._id:await ctx.db.insert('timelineShares',{projectId,ownerId,title:project.title,timeline,...(chat?.length?{chat}:{}),published:true,createdAt:now,updatedAt:now});
  if(existing){await removeShareAssets(ctx,shareId);await ctx.db.patch(shareId,{title:project.title,timeline,chat:chat?.length?chat:undefined,published:true,updatedAt:now});}
  for(const asset of assets.values()){
    const {_id,storageId,r2Key,fileName,contentType,size,kind,duration,width,height,audioAssetId,audioExtracted,waveform,thumbnailStorageId}=asset;
    await ctx.db.insert('shareAssets',{shareId,ownerId,sourceId:_id,fileName,contentType,size,kind,...(storageId?{storageId}:{}),...(r2Key?{r2Key}:{}),...(duration!==undefined?{duration}:{}),...(width!==undefined?{width}:{}),...(height!==undefined?{height}:{}),...(audioAssetId?{audioAssetId}:{}),...(audioExtracted!==undefined?{audioExtracted}:{}),...(waveform?{waveform}:{}),...(thumbnailStorageId?{thumbnailStorageId}:{})});
  }
  return shareId;
}});
export const revoke=mutation({args:{projectId:v.id('projects')},returns:v.null(),handler:async(ctx,{projectId})=>{
  await requireProject(ctx,projectId,await requireOwner(ctx));const share=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  if(share){await ctx.db.patch(share._id,{published:false,chat:undefined,updatedAt:Date.now()});await removeShareAssets(ctx,share._id);}return null;
}});
export const get=query({args:{shareId:v.string()},returns:v.union(v.object({_id:v.id('timelineShares'),title:v.string(),updatedAt:v.number(),timeline:timelineValidator,assets:v.array(publicMediaAsset),chat:v.optional(v.array(sharedChatMessage))}),v.null()),handler:async(ctx,{shareId})=>{
  const id=ctx.db.normalizeId('timelineShares',shareId);if(!id)return null;
  const share=await ctx.db.get(id);if(!share?.published)return null;
  const pins=await ctx.db.query('shareAssets').withIndex('by_share',q=>q.eq('shareId',id)).take(200);
  const assets=await Promise.all(pins.map(async pin=>({_id:String(pin.sourceId),fileName:pin.fileName,kind:pin.kind,url:await mediaUrl(ctx,pin),...(pin.duration!==undefined?{duration:pin.duration}:{}),...(pin.width!==undefined?{width:pin.width}:{}),...(pin.height!==undefined?{height:pin.height}:{}),...(pin.audioAssetId?{audioAssetId:String(pin.audioAssetId)}:{}),...(pin.audioExtracted!==undefined?{audioExtracted:pin.audioExtracted}:{}),...(pin.waveform?{waveform:pin.waveform}:{}),...(pin.thumbnailStorageId?{thumbnailUrl:await ctx.storage.getUrl(pin.thumbnailStorageId)}:{})})));
  return {_id:share._id,title:share.title,updatedAt:share.updatedAt,timeline:share.timeline,assets,...(share.chat?.length?{chat:share.chat}:{})};
}});
export const useTimeline=mutation({args:{shareId:v.id('timelineShares')},returns:v.id('projects'),handler:async(ctx,{shareId})=>{
  const ownerId=await requireOwner(ctx);await requireEditorAccess(ctx,ownerId);const share=await ctx.db.get(shareId);if(!share?.published)throw new ConvexError('This timeline is no longer shared.');
  const pins=await ctx.db.query('shareAssets').withIndex('by_share',q=>q.eq('shareId',shareId)).take(200),now=Date.now();
  const projectId=await createProject(ctx,{ownerId,title:share.title,aspectRatio:share.timeline.aspectRatio,createdAt:now,updatedAt:now,revision:0,history:[]}),ids=new Map<string,Id<'assets'>>();
  for(const pin of pins){const {_id,_creationTime,shareId:_,sourceId,audioAssetId,...media}=pin;const id=await ctx.db.insert('assets',{...media,projectId,ownerId,createdAt:now});await recordAssetStorage(ctx,(await ctx.db.get(id))!);ids.set(sourceId,id);}
  for(const pin of pins)if(pin.audioAssetId&&ids.has(pin.audioAssetId))await ctx.db.patch(ids.get(pin.sourceId)!,{audioAssetId:ids.get(pin.audioAssetId)!});
  const timeline=normalizeTimeline({...share.timeline,clips:share.timeline.clips.map(clip=>({...clip,...(clip.assetId?{assetId:ids.get(clip.assetId)!}:{})}))});
  await writeProject(ctx,projectId,{timeline});return projectId;
}});
