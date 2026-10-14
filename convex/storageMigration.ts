import { v } from 'convex/values';
import { internalAction,internalMutation,internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { recordAssetStorage,recordStorageObject } from './lib/storage_accounting';
import { mediaUrl } from './lib/media_storage';
const stage=v.union(v.literal('assets'),v.literal('shareAssets'),v.literal('renderJobs'),v.literal('r2Uploads'),v.literal('uploadTickets'));
export const page=internalQuery({args:{stage,cursor:v.union(v.string(),v.null())},returns:v.any(),handler:async(ctx,args)=>{
  const result=await ctx.db.query(args.stage).withIndex('by_creation_time').paginate({cursor:args.cursor,numItems:20});
  // Only IDs and output metadata cross the action boundary; large analyses/timelines stay in the database.
  return {...result,page:result.page.map(row=>({_id:row._id,...('outputR2Key'in row?{r2Key:row.outputR2Key}:{}),...('outputStorageId'in row?{storageId:row.outputStorageId}:{}),...('outputSize'in row?{size:row.outputSize}:{})}))};
}});
export const apply=internalMutation({args:{stage,records:v.array(v.object({id:v.string(),size:v.optional(v.number())}))},returns:v.null(),handler:async(ctx,args)=>{
  for(const record of args.records){
    if(args.stage==='assets'){const id=ctx.db.normalizeId('assets',record.id),asset=id?await ctx.db.get(id):null;if(asset)await recordAssetStorage(ctx,asset,true);}
    if(args.stage==='shareAssets'){
      const id=ctx.db.normalizeId('shareAssets',record.id),pin=id?await ctx.db.get(id):null,share=pin?await ctx.db.get(pin.shareId):null;
      if(pin&&share){await ctx.db.patch(pin._id,{ownerId:share.ownerId});await recordStorageObject(ctx,{...pin,ownerId:share.ownerId,createdAt:share.createdAt},true);if(pin.thumbnailStorageId){const meta=await ctx.db.system.get(pin.thumbnailStorageId);if(meta)await recordStorageObject(ctx,{ownerId:share.ownerId,storageId:pin.thumbnailStorageId,kind:'image',size:meta.size,fileName:`${pin.fileName} thumbnail`,createdAt:share.createdAt,auxiliary:true},true);}}
    }
    if(args.stage==='renderJobs'){
      const id=ctx.db.normalizeId('renderJobs',record.id),job=id?await ctx.db.get(id):null;
      if(job&&(job.outputR2Key||job.outputStorageId)) {const metadata=job.outputStorageId?await ctx.db.system.get(job.outputStorageId):null,size=job.outputSize??metadata?.size??record.size??(job.outputStorageId?0:undefined);if(size===undefined)throw new Error('Export size is unavailable');await ctx.db.patch(job._id,{outputSize:size});await recordStorageObject(ctx,{ownerId:job.ownerId,r2Key:job.outputR2Key,storageId:job.outputStorageId,kind:'export',size,fileName:'Export.mp4',createdAt:job.createdAt,jobId:job._id},true);}
    }
    if(args.stage==='uploadTickets'){const id=ctx.db.normalizeId('uploadTickets',record.id),ticket=id?await ctx.db.get(id):null;if(ticket?.storageId&&!ticket.consumed){const file=await ctx.db.system.get(ticket.storageId);if(file)await recordStorageObject(ctx,{ownerId:ticket.ownerId,storageId:ticket.storageId,fileName:'Upload',kind:ticket.jobId?'export':file.contentType?.startsWith('video/')?'video':file.contentType?.startsWith('audio/')?'audio':'image',size:file.size,createdAt:ticket._creationTime,pending:true},true);await ctx.scheduler.runAfter(Math.max(0,ticket.expiresAt-Date.now()),internal.uploads.cleanup,{ticketId:ticket._id});}}
    if(args.stage==='r2Uploads'){const id=ctx.db.normalizeId('r2Uploads',record.id),lease=id?await ctx.db.get(id):null;if(lease&&!lease.completed)await recordStorageObject(ctx,{ownerId:lease.ownerId,r2Key:lease.key,fileName:lease.fileName,kind:lease.jobId?'export':lease.kind,size:lease.size,createdAt:lease._creationTime,pending:true},true);}
  }return null;
}});
export const ready=internalMutation({args:{},returns:v.null(),handler:async ctx=>{const row=await ctx.db.query('storageAccounting').withIndex('by_name',q=>q.eq('name','objects-v1')).unique();if(row)await ctx.db.patch(row._id,{ready:true});else await ctx.db.insert('storageAccounting',{name:'objects-v1',ready:true});return null;}});
/** Idempotent bounded backfill; no objects are downloaded or deleted. */
export const initialize=internalAction({args:{},returns:v.object({records:v.number()}),handler:async ctx=>{
  let records=0;
  for(const stage of ['assets','shareAssets','renderJobs','r2Uploads','uploadTickets'] as const){let cursor:string|null=null;let done=false;while(!done){
    const result: {page:{_id:string;r2Key?:string;storageId?:string;size?:number}[];continueCursor:string;isDone:boolean}=await ctx.runQuery(internal.storageMigration.page,{stage,cursor});
    const batch=[];
    for(const row of result.page){let size=row.size;if(stage==='renderJobs'&&row.r2Key&&size===undefined){const url=await mediaUrl(ctx,{r2Key:row.r2Key});const response=await fetch(url!,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15_000)});const length=response.headers.get('content-length');if(response.status===404)size=0;else{if(!response.ok||length===null||!Number.isSafeInteger(Number(length)))throw new Error('Could not read an existing export size');size=Number(length);}}batch.push({id:row._id,...(size!==undefined?{size}:{})});}
    await ctx.runMutation(internal.storageMigration.apply,{stage,records:batch});records+=batch.length;cursor=result.continueCursor;done=result.isDone;
  }}
  await ctx.runMutation(internal.storageMigration.ready,{});return {records};
}});
