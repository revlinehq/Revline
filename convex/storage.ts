import { normalizationAssetIds } from '../lib/editor/audio-normalization';
import { projectRun } from './lib/project_data';
import { ConvexError,v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query,mutation,type QueryCtx,type MutationCtx } from './_generated/server';
import type { Doc,Id } from './_generated/dataModel';
import { requireOwner } from './lib/auth';
import { accountingReady,activeExportGroups,emptyStorage,ownedObjectReferences,storageAccount,usedByActiveExport } from './lib/storage_accounting';
import { removeOwnedAsset } from './assets';
import { beginProjectDeletion } from './projects';
import { removeMediaAttachment,removeShareAssets } from './lib/shared_media';
import { removeOwnedExport } from './renders';
import { mediaUrl } from './lib/media_storage';
import { allTabTimelines } from './timelineTabs';
import { sceneMediaAssetIds } from '../lib/editor/scene-layers';
import { removeShareTabs } from './lib/shared_media';

const kind=v.union(v.literal('video'),v.literal('audio'),v.literal('image'),v.literal('model'),v.literal('export'));
const workspace=v.object({id:v.id('projects'),title:v.string()});
const item=v.object({id:v.id('storageObjects'),fileName:v.string(),kind,size:v.number(),createdAt:v.number(),workspaces:v.array(workspace),inUse:v.boolean(),canDelete:v.boolean(),protectedReason:v.union(v.string(),v.null()),thumbnailUrl:v.union(v.string(),v.null())});
export const summary=query({args:{},returns:v.object({usedBytes:v.number(),reservedBytes:v.number(),videoBytes:v.number(),audioBytes:v.number(),imageBytes:v.number(),modelBytes:v.number(),exportBytes:v.number(),fileCount:v.number(),ready:v.boolean()}),handler:async ctx=>{
  const ownerId=await requireOwner(ctx),[account,ready]=await Promise.all([storageAccount(ctx,ownerId),accountingReady(ctx)]);
  const values=Object.fromEntries(Object.keys(emptyStorage).map(key=>[key,account?.[key as keyof typeof emptyStorage]??0])) as typeof emptyStorage;
  return {...values,ready};
}});
type DescriptionReads={
  project:(id:Id<'projects'>)=>Promise<Doc<'projects'>|null>;
  run:(id:Id<'projects'>,ownerId:string)=>ReturnType<typeof projectRun>;
  activeExport:(ownerId:string,id:Id<'projects'>,assetIds:Set<string>)=>Promise<boolean>;
};
function cached<K,V>(cache:Map<K,Promise<V>>,key:K,load:()=>Promise<V>) {
  let pending=cache.get(key);if(!pending){pending=load();cache.set(key,pending);}return pending;
}
/** Reuse promises across concurrent rows in this query's immutable snapshot only. */
function listingReads(ctx:QueryCtx):DescriptionReads {
  const projects=new Map<Id<'projects'>,Promise<Doc<'projects'>|null>>();
  const runs=new Map<string,ReturnType<typeof projectRun>>();
  const exports=new Map<string,ReturnType<typeof activeExportGroups>>();
  const key=(ownerId:string,id:Id<'projects'>)=>JSON.stringify([ownerId,id]);
  return {
    project:id=>cached(projects,id,()=>ctx.db.get(id)),
    run:(id,ownerId)=>cached(runs,key(ownerId,id),()=>projectRun(ctx,id,ownerId)),
    activeExport:async(ownerId,id,assetIds)=>usedByActiveExport(ctx,ownerId,id,assetIds,await cached(exports,key(ownerId,id),()=>activeExportGroups(ctx,ownerId,id))),
  };
}
async function describe(ctx:QueryCtx|MutationCtx,row:Doc<'storageObjects'>,reads?:DescriptionReads) {
  const result={id:row._id,fileName:row.fileName,kind:row.kind,size:row.size,createdAt:row.createdAt,workspaces:[] as {id:Doc<'projects'>['_id'];title:string}[],inUse:false,canDelete:false,protectedReason:null as string|null,thumbnailUrl:null as string|null};
  if(row.kind==='export') {
    const job=row.jobId?await ctx.db.get(row.jobId):null;
    if(!job||job.ownerId!==row.ownerId){result.protectedReason='This export is unavailable';return result;}
    const project=await(reads?reads.project(job.projectId):ctx.db.get(job.projectId));if(project?.ownerId===row.ownerId)result.workspaces.push({id:project._id,title:project.title});
    result.canDelete=job.status==='completed'||job.status==='failed'||job.status==='cancelled';result.protectedReason=result.canDelete?null:'Export in progress';return result;
  }
  const refs=await ownedObjectReferences(ctx,row.ownerId,row);
  // Listing previews reuse the editor's small JPEG thumbnail; an image falls back to itself.
  const thumbnail=row.kind==='video'||row.kind==='image'?refs.attachments.find(asset=>asset.thumbnailStorageId)?.thumbnailStorageId:undefined;
  result.thumbnailUrl=thumbnail?await ctx.storage.getUrl(thumbnail):row.kind==='image'?await mediaUrl(ctx,row):null;
  if(refs.tooMany){result.protectedReason='Remove this media from its workspaces first';return result;}
  // Deleting media also deletes the projects whose edit uses it and any shared timeline pinning it.
  if(refs.shares.length)result.inUse=true;
  const projectIds=[...new Set(refs.attachments.map(asset=>asset.projectId))];
  for(const projectId of projectIds) {
    const project=await(reads?reads.project(projectId):ctx.db.get(projectId));if(!project||project.deleting||project.ownerId!==row.ownerId)continue;
    const sources=refs.attachments.filter(asset=>asset.projectId===projectId);
    const ids=new Set(sources.map(asset=>String(asset._id)));
    const timelines=await allTabTimelines(ctx,project);
    let used=timelines.some(timeline=>timeline.clips.some(clip=>clip.assetId&&ids.has(clip.assetId))||sceneMediaAssetIds(timeline).some(id=>ids.has(id))||normalizationAssetIds(timeline).some(id=>ids.has(id)));
    // Extracted audio is retained while a video using that linked source remains in the edit.
    if(!used&&sources.some(asset=>asset.kind==='audio')) {
      const linked=await Promise.all(sources.filter(asset=>asset.kind==='audio').map(asset=>ctx.db.query('assets').withIndex('by_owner_audio',q=>q.eq('ownerId',row.ownerId).eq('audioAssetId',asset._id)).take(201)));
      const videos=new Set(linked.flat().filter(asset=>asset.projectId===projectId).map(asset=>String(asset._id)));
      used=timelines.some(timeline=>timeline.clips.some(clip=>clip.assetId&&videos.has(clip.assetId))||sceneMediaAssetIds(timeline).some(id=>videos.has(id)));
    }
    if(used) {result.workspaces.push({id:project._id,title:project.title});result.inUse=true;}
    if((await(reads?reads.run(projectId,row.ownerId):projectRun(ctx,projectId,row.ownerId))).aiRunning)result.protectedReason='AI editing in progress';
    if(await(reads?reads.activeExport(row.ownerId,projectId,ids):usedByActiveExport(ctx,row.ownerId,projectId,ids)))result.protectedReason='Used by an active export';
  }
  result.canDelete=refs.attachments.length>0&&!result.protectedReason;return result;
}
export const files=query({args:{paginationOpts:paginationOptsValidator,kind:v.optional(kind),search:v.optional(v.string()),unused:v.optional(v.boolean()),sort:v.union(v.literal('largest'),v.literal('newest'))},returns:v.object({page:v.array(item),isDone:v.boolean(),continueCursor:v.string(),splitCursor:v.optional(v.union(v.string(),v.null())),pageStatus:v.optional(v.union(v.literal("SplitRecommended"),v.literal("SplitRequired"),v.null()))}),handler:async(ctx,args)=>{
  const ownerId=await requireOwner(ctx);if(args.paginationOpts.numItems<1||args.paginationOpts.numItems>40)throw new ConvexError('Load up to 40 files');
  const search=args.search?.trim()??'';if(search.length>120)throw new ConvexError('Search is too long');
  const base=ctx.db.query('storageObjects');
  const listing=search ? base.withSearchIndex('search_name',q=>{const query=q.search('fileName',search).eq('ownerId',ownerId).eq('auxiliary',false).eq('pending',false);return args.kind?query.eq('kind',args.kind):query;})
    : args.kind ? base.withIndex(args.sort==='largest'?'by_owner_kind_size':'by_owner_kind_created',q=>q.eq('ownerId',ownerId).eq('auxiliary',false).eq('pending',false).eq('kind',args.kind!)).order('desc')
    : base.withIndex(args.sort==='largest'?'by_owner_visible_size':'by_owner_visible_created',q=>q.eq('ownerId',ownerId).eq('auxiliary',false).eq('pending',false)).order('desc');
  const page=await listing.paginate(args.paginationOpts);
  const reads=listingReads(ctx),rows=await Promise.all(page.page.map(row=>describe(ctx,row,reads)));
  return {...page,page:args.unused?rows.filter(row=>row.canDelete&&!row.inUse):rows};
}});
export const remove=mutation({args:{fileIds:v.array(v.id('storageObjects'))},returns:v.array(v.id('projects')),handler:async(ctx,{fileIds})=>{
  const ownerId=await requireOwner(ctx);if(!fileIds.length||fileIds.length>20)throw new ConvexError('Delete between 1 and 20 files');
  const rows=await Promise.all([...new Set(fileIds)].map(id=>ctx.db.get(id)));
  const projects=new Set<Id<'projects'>>();
  for(const row of rows) {
    if(!row)continue;
    if(row.ownerId!==ownerId||row.pending||row.auxiliary)throw new ConvexError('File not found');
    const info=await describe(ctx,row);if(!info.canDelete)throw new ConvexError(info.protectedReason??'Remove this media from its workspace first');
    if(row.kind!=='export')for(const project of info.workspaces)projects.add(project.id);
  }
  // Validate the whole selection before hiding any project shared by several files.
  for(const projectId of projects){const project=await ctx.db.get(projectId);if(project)await beginProjectDeletion(ctx,ownerId,project);}
  for(const row of rows) {
    if(!row||!await ctx.db.get(row._id))continue;
    if(row.kind==='export')await removeOwnedExport(ctx,ownerId,row.jobId!);
    else {
      const refs=await ownedObjectReferences(ctx,ownerId,row);
      for(const asset of refs.attachments){
        const project=await ctx.db.get(asset.projectId);
        if(project&&project.ownerId!==ownerId)throw new ConvexError('Project not found');
        if(!project||project.deleting){
          if(project){projects.add(project._id);await beginProjectDeletion(ctx,ownerId,project);}
          await removeMediaAttachment(ctx,asset);
        }else await removeOwnedAsset(ctx,ownerId,asset._id);
      }
      for(const shareId of new Set(refs.shares.map(pin=>pin.shareId))){const share=await ctx.db.get(shareId);await removeShareAssets(ctx,shareId);await removeShareTabs(ctx,shareId);if(share?.cardStorageId)await ctx.storage.delete(share.cardStorageId);await ctx.db.delete(shareId);}
    }
  }
  return [...projects];
}});
