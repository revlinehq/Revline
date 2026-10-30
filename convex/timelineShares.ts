import { sceneMediaAssetIds } from '../lib/editor/scene-layers';
import { writeProject,createProject } from './lib/project_data';
import { recordAssetStorage } from './lib/storage_accounting';
import { ConvexError,v } from 'convex/values';
import { internalMutation,mutation,query } from './_generated/server';
import { internal } from './_generated/api';
import { enqueueMediaTask } from './mediaTasks';
import { timelineDuration } from '../lib/editor/types';
import type { Id,Doc } from './_generated/dataModel';
import { requireOwner,requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { validateTimeline } from './lib/timeline';
import { mediaUrl,previewUrl } from './lib/media_storage';
import { removeShareAssets, removeShareTabs, sharedAssetFields } from './lib/shared_media';
import { activeTabOf, storedTabTimeline, tabsOf } from './timelineTabs';
import { timelineValidator,publicMediaAsset,sharedChatMessage,shareChatPreviewMessage } from './schema';
import { previewSharedChat,snapshotSharedChat } from './lib/share_chat';
import { normalizeTimeline } from '../lib/editor/types';
const shareStatus=v.object({_id:v.id('timelineShares'),title:v.string(),published:v.boolean(),updatedAt:v.number(),includesChat:v.boolean(),timelineIds:v.array(v.string())});
const sharedTab=v.object({id:v.string(),name:v.string(),timeline:timelineValidator});

export const status=query({args:{projectId:v.id('projects')},returns:v.union(shareStatus,v.null()),handler:async(ctx,{projectId})=>{
  await requireProject(ctx,projectId,await requireOwner(ctx));
  const share=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  if(!share)return null;
  const tabs=share.tabCount?await ctx.db.query('shareTimelines').withIndex('by_share',q=>q.eq('shareId',share._id)).take(20):[];
  return {_id:share._id,title:share.title,published:share.published,updatedAt:share.updatedAt,includesChat:!!share.chat?.length,timelineIds:tabs.map(tab=>tab.timelineId)};
}});
export const chatPreview=query({args:{projectId:v.id('projects')},returns:v.object({messages:v.array(shareChatPreviewMessage),truncated:v.boolean()}),handler:async(ctx,{projectId})=>previewSharedChat(ctx,await requireProject(ctx,projectId,await requireOwner(ctx)))});

/** Publish the open tab, or the chosen tabs (in tab order) so viewers can switch between them. */
export const publish=mutation({args:{projectId:v.id('projects'),chat:v.optional(v.array(shareChatPreviewMessage)),timelineIds:v.optional(v.array(v.string()))},returns:v.id('timelineShares'),handler:async(ctx,{projectId,chat:selectedChat,timelineIds})=>{
  const ownerId=await requireOwner(ctx),project=await requireProject(ctx,projectId,ownerId);await requireEditorAccess(ctx,ownerId);
  if(project.aiRunning)throw new ConvexError('Wait for the current AI edit to finish before sharing.');
  const open=activeTabOf(project),chosen=new Set(timelineIds?.length?timelineIds:[open]);
  const picked=tabsOf(project).filter(tab=>chosen.has(tab.id));
  if(picked.length!==chosen.size)throw new ConvexError('A timeline to share could not be found.');
  const tabs=await Promise.all(picked.map(async tab=>{
    const stored=await storedTabTimeline(ctx,project,tab.id);
    if(!stored?.clips.length)throw new ConvexError(`Add footage or text to “${tab.name}” before sharing it.`);
    return {id:tab.id,name:tab.name,timeline:await validateTimeline(ctx,project,stored)};
  }));
  const chat=selectedChat===undefined?undefined:await snapshotSharedChat(ctx,project,selectedChat);
  // The link opens on the edit being worked on when it is included.
  const primary=tabs.find(tab=>tab.id===open)??tabs[0],timeline=primary.timeline,assets=new Map<string,Doc<'assets'>>();
  // Footage and the images or videos that scenes show (screenshots), so the link can play every scene.
  const ids=[...new Set(tabs.flatMap(tab=>[...tab.timeline.clips.flatMap(clip=>clip.assetId?[clip.assetId]:[]),...sceneMediaAssetIds(tab.timeline)]))];
  for(const raw of ids){const id=ctx.db.normalizeId('assets',raw),asset=id?await ctx.db.get(id):null;if(!asset||asset.ownerId!==ownerId||asset.projectId!==projectId)throw new ConvexError('A source could not be shared.');assets.set(asset._id,asset);}
  // Preserve the linked audio source so adding this footage in the copy keeps audio separation.
  for(const asset of Array.from(assets.values()))if(asset.audioAssetId&&!assets.has(asset.audioAssetId)){
    const audio=await ctx.db.get(asset.audioAssetId);if(!audio||audio.projectId!==projectId||audio.ownerId!==ownerId)throw new ConvexError('Linked audio could not be shared.');assets.set(audio._id,audio);
  }
  if(assets.size>200)throw new ConvexError('A shared timeline supports up to 200 sources.');
  const existing=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).unique(),now=Date.now();
  const tabCount=tabs.length>1?tabs.length:undefined,openTimelineId=tabCount?primary.id:undefined;
  const shareId=existing?existing._id:await ctx.db.insert('timelineShares',{projectId,ownerId,title:project.title,timeline,...(tabCount?{tabCount,openTimelineId}:{}),...(chat?.length?{chat}:{}),published:true,createdAt:now,updatedAt:now});
  if(existing){await removeShareAssets(ctx,shareId);await removeShareTabs(ctx,shareId);await ctx.db.patch(shareId,{title:project.title,timeline,tabCount,openTimelineId,chat:chat?.length?chat:undefined,published:true,updatedAt:now});}
  if(tabCount)for(const [position,tab] of tabs.entries())await ctx.db.insert('shareTimelines',{shareId,timelineId:tab.id,name:tab.name,position,timeline:tab.timeline});
  for(const asset of assets.values())await ctx.db.insert('shareAssets',{shareId,ownerId,...sharedAssetFields(asset)});
  // The link's preview card: the timeline's name and a frame of it, rendered in the background.
  await ctx.db.patch(shareId,{cardTitle:primary.name});
  await ctx.scheduler.runAfter(0,internal.timelineShares.requestCard,{shareId});
  return shareId;
}});

/** Render the share card: one frame about a third of the way in, composed by the media worker with the name. */
export const requestCard=internalMutation({args:{shareId:v.id('timelineShares')},returns:v.null(),handler:async(ctx,{shareId})=>{
  const share=await ctx.db.get(shareId);if(!share?.published)return null;
  const fps=share.timeline.fps,time=Math.round(timelineDuration(share.timeline)*.35*fps)/fps;
  const snapshotId=await ctx.db.insert('frameSnapshots',{projectId:share.projectId,ownerId:share.ownerId,revision:0,times:[time],status:'queued',createdAt:Date.now(),shareId});
  const taskId=await enqueueMediaTask(ctx,{ownerId:share.ownerId,projectId:share.projectId,kind:'snapshot',snapshotId});
  await ctx.db.patch(snapshotId,{taskId});
  return null;
}});

/** What a link preview needs: the timeline name and whether a card image exists. Public, like the share itself. */
export const card=query({args:{shareId:v.string()},returns:v.union(v.object({title:v.string(),hasImage:v.boolean(),updatedAt:v.number()}),v.null()),handler:async(ctx,{shareId})=>{
  const id=ctx.db.normalizeId('timelineShares',shareId),share=id?await ctx.db.get(id):null;
  if(!share?.published)return null;
  return {title:share.cardTitle??share.title,hasImage:!!share.cardImage,updatedAt:share.cardUpdatedAt??share.updatedAt};
}});

/** The card image itself, served by the share-card HTTP route. */
export const cardImage=query({args:{shareId:v.string()},returns:v.union(v.string(),v.null()),handler:async(ctx,{shareId})=>{
  const id=ctx.db.normalizeId('timelineShares',shareId),share=id?await ctx.db.get(id):null;
  return share?.published&&share.cardImage?share.cardImage:null;
}});
export const revoke=mutation({args:{projectId:v.id('projects')},returns:v.null(),handler:async(ctx,{projectId})=>{
  await requireProject(ctx,projectId,await requireOwner(ctx));const share=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  if(share){await ctx.db.patch(share._id,{published:false,chat:undefined,tabCount:undefined,openTimelineId:undefined,updatedAt:Date.now()});await removeShareAssets(ctx,share._id);await removeShareTabs(ctx,share._id);}return null;
}});
export const get=query({args:{shareId:v.string()},returns:v.union(v.object({_id:v.id('timelineShares'),title:v.string(),updatedAt:v.number(),timeline:timelineValidator,tabs:v.optional(v.array(sharedTab)),openTimelineId:v.optional(v.string()),assets:v.array(publicMediaAsset),chat:v.optional(v.array(sharedChatMessage))}),v.null()),handler:async(ctx,{shareId})=>{
  const id=ctx.db.normalizeId('timelineShares',shareId);if(!id)return null;
  const share=await ctx.db.get(id);if(!share?.published)return null;
  const pins=await ctx.db.query('shareAssets').withIndex('by_share',q=>q.eq('shareId',id)).take(200);
  const assets=await Promise.all(pins.map(async pin=>({_id:String(pin.sourceId),fileName:pin.fileName,kind:pin.kind,url:await mediaUrl(ctx,pin),...await previewUrl(ctx,pin),...(pin.previewVersion!==undefined?{previewSize:pin.previewSize,previewWidth:pin.previewWidth,previewHeight:pin.previewHeight,previewFps:pin.previewFps,previewVersion:pin.previewVersion}:{}),...(pin.duration!==undefined?{duration:pin.duration}:{}),...(pin.width!==undefined?{width:pin.width}:{}),...(pin.height!==undefined?{height:pin.height}:{}),...(pin.audioAssetId?{audioAssetId:String(pin.audioAssetId)}:{}),...(pin.audioExtracted!==undefined?{audioExtracted:pin.audioExtracted}:{}),...(pin.waveform?{waveform:pin.waveform}:{}),...(pin.thumbnailStorageId?{thumbnailUrl:await ctx.storage.getUrl(pin.thumbnailStorageId)}:{})})));
  const rows=share.tabCount?await ctx.db.query('shareTimelines').withIndex('by_share',q=>q.eq('shareId',id)).take(20):[];
  const tabs=rows.map(row=>({id:row.timelineId,name:row.name,timeline:row.timeline}));
  return {_id:share._id,title:share.title,updatedAt:share.updatedAt,timeline:share.timeline,...(tabs.length?{tabs,openTimelineId:share.openTimelineId??tabs[0].id}:{}),assets,...(share.chat?.length?{chat:share.chat}:{})};
}});
/** Copy one shared timeline (the tab being viewed, for multi-tab shares) into a new project. */
export const useTimeline=mutation({args:{shareId:v.id('timelineShares'),timelineId:v.optional(v.string())},returns:v.id('projects'),handler:async(ctx,{shareId,timelineId})=>{
  const ownerId=await requireOwner(ctx);await requireEditorAccess(ctx,ownerId);const share=await ctx.db.get(shareId);if(!share?.published)throw new ConvexError('This timeline is no longer shared.');
  const tab=timelineId&&share.tabCount?(await ctx.db.query('shareTimelines').withIndex('by_share',q=>q.eq('shareId',shareId)).take(20)).find(row=>row.timelineId===timelineId):undefined;
  const source=tab?.timeline??share.timeline,used=new Set([...source.clips.flatMap(clip=>clip.assetId?[clip.assetId]:[]),...sceneMediaAssetIds(source)]);
  // A multi-tab share pins every tab's media; the copy keeps only what its timeline uses (and linked audio).
  const all=await ctx.db.query('shareAssets').withIndex('by_share',q=>q.eq('shareId',shareId)).take(200),now=Date.now();
  for(const pin of all)if(used.has(pin.sourceId)&&pin.audioAssetId)used.add(pin.audioAssetId);
  const pins=all.filter(pin=>used.has(pin.sourceId));
  const projectId=await createProject(ctx,{ownerId,title:tab?`${share.title} · ${tab.name}`:share.title,aspectRatio:source.aspectRatio,createdAt:now,updatedAt:now,revision:0,history:[]}),ids=new Map<string,Id<'assets'>>();
  for(const pin of pins){const {_id,_creationTime,shareId:_,sourceId,audioAssetId,...media}=pin;const id=await ctx.db.insert('assets',{...media,projectId,ownerId,createdAt:now});await recordAssetStorage(ctx,(await ctx.db.get(id))!);ids.set(sourceId,id);}
  for(const pin of pins)if(pin.audioAssetId&&ids.has(pin.audioAssetId))await ctx.db.patch(ids.get(pin.sourceId)!,{audioAssetId:ids.get(pin.audioAssetId)!});
  const timeline=normalizeTimeline({...source,clips:source.clips.map(clip=>({...clip,...(clip.assetId?{assetId:ids.get(clip.assetId)!}:{}),...(clip.scene?.media?{scene:{...clip.scene,media:clip.scene.media.map(item=>({...item,assetId:ids.get(item.assetId)??item.assetId}))}}:{})}))});
  await writeProject(ctx,projectId,{timeline});return projectId;
}});
