import { projectRun } from './lib/project_data';
import { ConvexError,v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query,mutation,type QueryCtx,type MutationCtx } from './_generated/server';
import type { Doc,Id } from './_generated/dataModel';
import { requireOwner } from './lib/auth';
import { accountingReady,activeExportGroups,emptyStorage,ownedObjectReferences,storageAccount,storageLimit,usedByActiveExport } from './lib/storage_accounting';
import { removeOwnedAsset } from './assets';
import { removeOwnedExport } from './renders';

const kind=v.union(v.literal('video'),v.literal('audio'),v.literal('image'),v.literal('export'));
const workspace=v.object({id:v.id('projects'),title:v.string()});
const item=v.object({id:v.id('storageObjects'),fileName:v.string(),kind,size:v.number(),createdAt:v.number(),workspaces:v.array(workspace),canDelete:v.boolean(),protectedReason:v.union(v.string(),v.null())});
export const summary=query({args:{},returns:v.object({usedBytes:v.number(),reservedBytes:v.number(),videoBytes:v.number(),audioBytes:v.number(),imageBytes:v.number(),exportBytes:v.number(),fileCount:v.number(),limitBytes:v.number(),ready:v.boolean()}),handler:async ctx=>{
  const ownerId=await requireOwner(ctx),[account,ready]=await Promise.all([storageAccount(ctx,ownerId),accountingReady(ctx)]);
  const values=Object.fromEntries(Object.keys(emptyStorage).map(key=>[key,account?.[key as keyof typeof emptyStorage]??0])) as typeof emptyStorage;
  return {...values,limitBytes:storageLimit(),ready};
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
  const result={id:row._id,fileName:row.fileName,kind:row.kind,size:row.size,createdAt:row.createdAt,workspaces:[] as {id:Doc<'projects'>['_id'];title:string}[],canDelete:false,protectedReason:null as string|null};
  if(row.kind==='export') {
    const job=row.jobId?await ctx.db.get(row.jobId):null;
    if(!job||job.ownerId!==row.ownerId){result.protectedReason='This export is unavailable';return result;}
    const project=await(reads?reads.project(job.projectId):ctx.db.get(job.projectId));if(project?.ownerId===row.ownerId)result.workspaces.push({id:project._id,title:project.title});
    result.canDelete=job.status==='completed'||job.status==='failed'||job.status==='cancelled';result.protectedReason=result.canDelete?null:'Export in progress';return result;
  }
  const refs=await ownedObjectReferences(ctx,row.ownerId,row);
  if(refs.tooMany){result.protectedReason='Remove this media from its workspaces first';return result;}
  if(refs.shares.length)result.protectedReason='Used by a shared timeline';
  const projectIds=[...new Set(refs.attachments.map(asset=>asset.projectId))];
  for(const projectId of projectIds) {
    const project=await(reads?reads.project(projectId):ctx.db.get(projectId));if(!project||project.ownerId!==row.ownerId)continue;
    const sources=refs.attachments.filter(asset=>asset.projectId===projectId);
    const ids=new Set(sources.map(asset=>String(asset._id)));
    let used=project.timeline?.clips.some(clip=>clip.assetId&&ids.has(clip.assetId));
    // Extracted audio is retained while a video using that linked source remains in the edit.
    if(!used&&sources.some(asset=>asset.kind==='audio')) {
      const linked=await Promise.all(sources.filter(asset=>asset.kind==='audio').map(asset=>ctx.db.query('assets').withIndex('by_owner_audio',q=>q.eq('ownerId',row.ownerId).eq('audioAssetId',asset._id)).take(201)));
      const videos=new Set(linked.flat().filter(asset=>asset.projectId===projectId).map(asset=>String(asset._id)));
      used=project.timeline?.clips.some(clip=>clip.assetId&&videos.has(clip.assetId));
    }
    if(used) {result.workspaces.push({id:project._id,title:project.title});result.protectedReason='Used in an edit';}
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
  return {...page,page:args.unused?rows.filter(row=>row.canDelete):rows};
}});
export const remove=mutation({args:{fileIds:v.array(v.id('storageObjects'))},returns:v.null(),handler:async(ctx,{fileIds})=>{
  const ownerId=await requireOwner(ctx);if(!fileIds.length||fileIds.length>20)throw new ConvexError('Delete between 1 and 20 files');
  const rows=await Promise.all([...new Set(fileIds)].map(id=>ctx.db.get(id)));
  for(const row of rows) {
    if(!row||row.ownerId!==ownerId||row.pending||row.auxiliary)throw new ConvexError('File not found');
    const info=await describe(ctx,row);if(!info.canDelete)throw new ConvexError(info.protectedReason??'Remove this media from its workspace first');
  }
  // Revalidation and removal are atomic; a concurrently changed edit cannot lose its source.
  for(const row of rows) {
    if(row!.kind==='export')await removeOwnedExport(ctx,ownerId,row!.jobId!);
    else {const refs=await ownedObjectReferences(ctx,ownerId,row!);for(const asset of refs.attachments)await removeOwnedAsset(ctx,ownerId,asset._id);}
  }
  return null;
}});
