import { ConvexError, v } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireOwner } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { storageControl } from './lib/media_storage';
import { forgetStorageObject, recordStorageObject } from './lib/storage_accounting';
import { partsValidator, partsComplete, signedPartUrl, validPartNumber } from './lib/upload_limits';
import { uploadPartSize } from '../lib/editor/limits';

const metadata = { fileName:v.string(), contentType:v.string(), kind:v.union(v.literal('video'),v.literal('audio'),v.literal('image')), size:v.number(), duration:v.optional(v.number()), width:v.optional(v.number()), height:v.optional(v.number()) };
const uploadArgs = { uploadId:v.id('cloudMedia') };
/** An upload that requests no part for this long was abandoned. Part URLs are valid for an hour. */
const IDLE_MS = 2 * 3600_000;
const MAX_AGE_MS = 24 * 3600_000;
const MAX_PENDING = 20;
/** Rows from before activity tracking count from their start. */
const abandoned = (row:Doc<'cloudMedia'>, now:number) => (row.activeAt ?? row.createdAt) + IDLE_MS <= now;
async function unfinishedUploads(ctx:QueryCtx|MutationCtx, ownerId:string) {
  const now=Date.now();
  return (await ctx.db.query('cloudMedia').withIndex('by_owner_completed',q=>q.eq('ownerId',ownerId).eq('completed',false)).take(100)).filter(row=>!row.aborting&&row.expiresAt>now);
}
export const authorize = internalQuery({args:{},returns:v.string(),handler:async ctx=>{
  const ownerId=await requireOwner(ctx);await requireEditorAccess(ctx,ownerId);return ownerId;
}});
export const reserve = internalMutation({args:{...metadata,ownerId:v.string(),r2Key:v.string(),uploadId:v.string(),partSize:v.number()},returns:v.id('cloudMedia'),handler:async(ctx,args)=>{
  await requireEditorAccess(ctx,args.ownerId);
  const now=Date.now();
  // Abandoned uploads stop counting at once; their scheduled cleanup frees the storage.
  const pending=(await unfinishedUploads(ctx,args.ownerId)).filter(row=>!abandoned(row,now));
  if(pending.length>=MAX_PENDING)throw new ConvexError(`You have ${MAX_PENDING} unfinished cloud uploads. Cancel some in Cloud storage, then try again.`);
  const id=await ctx.db.insert('cloudMedia',{...args,createdAt:now,activeAt:now,expiresAt:now+IDLE_MS,completed:false});
  await recordStorageObject(ctx,{...args,createdAt:now,pending:true});
  await ctx.scheduler.runAfter(IDLE_MS,internal.cloudMedia.cleanup,{uploadId:id});
  return id;
}});
export const start = action({args:metadata,returns:v.object({uploadId:v.id('cloudMedia'),partSize:v.number()}),handler:async(ctx,args):Promise<{uploadId:Id<'cloudMedia'>;partSize:number}>=>{
  const ownerId=await ctx.runQuery(internal.cloudMedia.authorize,{});
  const fileName=args.fileName.trim();
  if(!fileName||fileName.length>255||args.contentType.length>128||(!args.contentType.startsWith(`${args.kind}/`)&&!(args.kind==='audio'&&/^video\/(mp4|quicktime|webm)$/.test(args.contentType))))throw new ConvexError('Choose a supported video, audio or image file.');
  const partSize=uploadPartSize(args.size);
  if(!Number.isSafeInteger(args.size)||args.size<1||!partSize)throw new ConvexError('This file is empty or exceeds the cloud upload size limit.');
  if(args.duration!==undefined&&(!Number.isFinite(args.duration)||args.duration<=0||args.duration>86400))throw new ConvexError('Invalid media duration.');
  if(args.kind!=='image'&&args.duration===undefined)throw new ConvexError('This media has no readable duration.');
  if(args.kind!=='audio'&&[args.width,args.height].some(value=>!Number.isInteger(value)||!value||value<1||value>16384))throw new ConvexError('This media has no readable dimensions.');
  const r2Key=`media/${ownerId}/library/${crypto.randomUUID()}`;
  const opened=await storageControl({action:'create',key:r2Key,contentType:args.contentType});
  if(!opened.uploadId)throw new ConvexError('Could not open cloud storage.');
  const multipartId=opened.uploadId;
  try{return {uploadId:await ctx.runMutation(internal.cloudMedia.reserve,{...args,fileName,ownerId,r2Key,uploadId:multipartId,partSize}),partSize};}
  catch(error){await storageControl({action:'abort',key:r2Key,uploadId:multipartId}).catch(()=>{});throw error;}
}});
/** The signed-in owner's uploads that never finished, for cancelling from Cloud storage. */
export const unfinished = query({args:{},returns:v.array(v.object({uploadId:v.id('cloudMedia'),fileName:v.string(),size:v.number(),createdAt:v.number(),activeAt:v.number()})),handler:async ctx=>{
  const rows=await unfinishedUploads(ctx,await requireOwner(ctx));
  return rows.map(row=>({uploadId:row._id,fileName:row.fileName,size:row.size,createdAt:row.createdAt,activeAt:row.activeAt??row.createdAt})).sort((a,b)=>a.activeAt-b.activeAt);
}});
/** Each requested part keeps an upload alive, up to its maximum age. */
export const touch = internalMutation({args:uploadArgs,returns:v.null(),handler:async(ctx,args)=>{
  const row=await ctx.db.get(args.uploadId),now=Date.now();
  if(row&&!row.completed&&!row.aborting)await ctx.db.patch(row._id,{activeAt:now,expiresAt:Math.min(row.createdAt+MAX_AGE_MS,Math.max(row.expiresAt,now+IDLE_MS))});
  return null;
}});
export const lease = internalQuery({args:{...uploadArgs,cleanup:v.optional(v.boolean())},handler:async(ctx,args):Promise<Doc<'cloudMedia'>>=>{
  const ownerId=await requireOwner(ctx),row=await ctx.db.get(args.uploadId);
  if(!row||row.ownerId!==ownerId)throw new ConvexError('Cloud upload not found.');
  if(!args.cleanup){await requireEditorAccess(ctx,ownerId);if(row.aborting||(!row.completed&&row.expiresAt<=Date.now()))throw new ConvexError('Cloud upload expired or was cancelled.');}
  return row;
}});
export const partUrl = action({args:{...uploadArgs,partNumber:v.number()},returns:v.string(),handler:async(ctx,args):Promise<string>=>{
  const row=await ctx.runQuery(internal.cloudMedia.lease,{uploadId:args.uploadId});
  if(row.completed||!validPartNumber(args.partNumber,row.size,row.partSize))throw new ConvexError('Invalid upload part.');
  await ctx.runMutation(internal.cloudMedia.touch,{uploadId:row._id});
  return signedPartUrl({key:row.r2Key,uploadId:row.uploadId,size:row.size,partSize:row.partSize},args.partNumber);
}});
export const finish = internalMutation({args:{...uploadArgs,size:v.number(),contentType:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const row=await ctx.db.get(args.uploadId);
  if(!row||row.aborting||row.expiresAt<=Date.now())throw new ConvexError('Cloud upload expired or was cancelled.');
  await requireEditorAccess(ctx,row.ownerId);
  if(row.size!==args.size||row.contentType!==args.contentType)throw new ConvexError('Uploaded media does not match this file.');
  if(!row.completed){await ctx.db.patch(row._id,{completed:true});await recordStorageObject(ctx,{...row,pending:false});}
  return null;
}});
export const complete = action({args:{...uploadArgs,parts:partsValidator},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
  const row=await ctx.runQuery(internal.cloudMedia.lease,{uploadId:args.uploadId});
  if(row.completed)return null;
  if(!partsComplete(args.parts,row.size,row.partSize))throw new ConvexError('Upload parts are incomplete.');
  const file=await storageControl({action:'complete',key:row.r2Key,uploadId:row.uploadId,parts:args.parts});
  if(file.size===undefined||!file.contentType)throw new ConvexError('Cloud storage did not confirm the file.');
  await ctx.runMutation(internal.cloudMedia.finish,{uploadId:row._id,size:file.size,contentType:file.contentType});
  return null;
}});
/** The row to abort, or when an upload still receiving parts should be checked again. */
export const beginAbort = internalMutation({args:{...uploadArgs,force:v.optional(v.boolean())},handler:async(ctx,args):Promise<Doc<'cloudMedia'>|{retryAt:number}|null>=>{
  const row=await ctx.db.get(args.uploadId);
  if(!row||row.completed)return null;
  if(!args.force&&row.expiresAt>Date.now())return {retryAt:row.expiresAt};
  await ctx.db.patch(row._id,{aborting:true});return row;
}});
export const forget = internalMutation({args:uploadArgs,returns:v.null(),handler:async(ctx,args)=>{
  const row=await ctx.db.get(args.uploadId);
  if(row&&!row.completed&&row.aborting){await forgetStorageObject(ctx,row.ownerId,row);await ctx.db.delete(row._id);}return null;
}});
export const cleanup = internalAction({args:{...uploadArgs,force:v.optional(v.boolean()),attempt:v.optional(v.number())},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
  const row=await ctx.runMutation(internal.cloudMedia.beginAbort,{uploadId:args.uploadId,force:args.force});
  if(!row)return null;
  if('retryAt' in row){await ctx.scheduler.runAt(row.retryAt,internal.cloudMedia.cleanup,{uploadId:args.uploadId});return null;}
  try{
    await storageControl({action:'abort',key:row.r2Key,uploadId:row.uploadId});
    await storageControl({action:'delete',key:row.r2Key});
    await ctx.runMutation(internal.cloudMedia.forget,{uploadId:row._id});
  }catch(error){const attempt=args.attempt??0;if(attempt>=8)throw error;await ctx.scheduler.runAfter(Math.min(3600_000,60_000*2**attempt),internal.cloudMedia.cleanup,{uploadId:row._id,force:true,attempt:attempt+1});}
  return null;
}});
export const abort = action({args:uploadArgs,returns:v.null(),handler:async(ctx,args):Promise<null>=>{
  await ctx.runQuery(internal.cloudMedia.lease,{...args,cleanup:true});
  await ctx.runAction(internal.cloudMedia.cleanup,{...args,force:true});return null;
}});
