import { parse } from 'convex-helpers/validators';
import { ConvexError, v, type Infer } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { requireMediaTask } from './lib/media_task_auth';
import { mediaTaskCredentials } from './lib/media_task_contract';
import { referenceReadResult } from './schema';
import { AnalysisError } from '../lib/media-analysis/errors';
import { isTransientMediaError, retryMediaOperation } from '../lib/media-analysis/network';

export const readLease = internalQuery({ args: mediaTaskCredentials, returns: v.boolean(), handler: async (ctx,args) => {
  const saved=await ctx.db.get(args.taskId);
  if(saved?.status==='completed'&&saved.leaseToken===args.leaseToken)return false;
  const task=await requireMediaTask(ctx,args.taskId,args.leaseToken);
  if(task.kind!=='read'||!task.readId)throw new ConvexError('This lease cannot publish a reference reading.');
  return true;
}});

function readJson(result:Infer<typeof referenceReadResult>){
  const images=[result.image,...result.extraImages??[]].filter((value):value is string=>!!value);
  if(images.some(image=>!/^[A-Za-z0-9+/]+=*$/.test(image))||images.reduce((sum,image)=>sum+image.length,0)>900_000)throw new ConvexError('The frame sheet is too large to return.');
  const json=JSON.stringify(result);
  if(new TextEncoder().encode(json).byteLength>8_000_000)throw new ConvexError('The reference reading is too large.');
  return json;
}

/** Store directly from the worker's response, so image/track bytes never enter a database row. */
export const completeRead = action({ args: {...mediaTaskCredentials,result:referenceReadResult}, returns: v.null(), handler: async (ctx,{result,...credentials}):Promise<null> => {
  if(!await ctx.runQuery(internal.mediaTaskResults.readLease,credentials))return null;
  const json=readJson(result);
  const storageId=await ctx.storage.store(new Blob([json],{type:'application/json'}));
  try { await ctx.runMutation(internal.mediaTasks.completeRead,{...credentials,storageId}); }
  catch(error) { await ctx.storage.delete(storageId);throw error; }
  return null;
}});

/** Only the owner of the pending read can consume its file, and cleanup removes the file too. */
export const consumeRead = internalAction({ args: {ownerId:v.string(),readId:v.id('referenceReads'),retain:v.optional(v.boolean()),deadline:v.optional(v.number())}, returns:referenceReadResult, handler: async (ctx,args):Promise<Infer<typeof referenceReadResult>> => {
  const read=await ctx.runQuery(internal.referenceReads.get,{ownerId:args.ownerId,readId:args.readId});
  if(read.status!=='completed')throw new ConvexError('The reference reading is not complete.');
  if(read.result)return read.result;
  if(!read.resultStorageId)throw new ConvexError('The reference reading is unavailable.');
  const url=await ctx.storage.getUrl(read.resultStorageId);
  if(!url)throw new ConvexError('The reference reading is unavailable.');
  const load=async()=>{
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(30_000,(args.deadline??Infinity)-Date.now())))});
    if(!response.ok){await response.body?.cancel();throw new AnalysisError(`The reference reading could not load (HTTP ${response.status}).`,response.status);}
    return parse(referenceReadResult,await response.json());
  };
  let result: Infer<typeof referenceReadResult>;
  try { result=args.deadline ? await load() : await retryMediaOperation(load); }
  catch(error) {
    // Preserve transport classification across the action boundary without signed URLs.
    if(isTransientMediaError(error))throw new ConvexError({code:'REFERENCE_READ_DOWNLOAD_RETRY',message:'The saved reference reading could not be downloaded yet.'});
    throw new ConvexError({code:'REFERENCE_READ_INVALID',message:'The saved reference reading is invalid or unavailable. Start a new reading.'});
  }
  if(!args.retain)await ctx.runMutation(internal.referenceReads.discard,{readId:args.readId});
  return result;
}});

/** Compatibility for workers deployed before direct file publication. No user query reads
 * the scheduled payload; it is consumed once and never copied into the polled read row. */
async function legacyTarget(ctx:QueryCtx|MutationCtx,args:{taskId:import('./_generated/dataModel').Id<'mediaTasks'>;leaseToken:string}){
  const task=await ctx.db.get(args.taskId);
  if(!task||task.status!=='completed'||task.kind!=='read'||task.leaseToken!==args.leaseToken||!task.readId)return null;
  const read=await ctx.db.get(task.readId);
  return read&&read.taskId===task._id&&read.ownerId===task.ownerId&&read.projectId===task.projectId&&read.status==='queued'&&!read.resultStorageId?read:null;
}
export const legacyPending=internalQuery({args:mediaTaskCredentials,returns:v.boolean(),handler:async(ctx,args)=>!!await legacyTarget(ctx,args)});
export const finishLegacyRead=internalMutation({args:{...mediaTaskCredentials,storageId:v.optional(v.id('_storage')),failed:v.optional(v.boolean())},returns:v.boolean(),handler:async(ctx,args)=>{
  const read=await legacyTarget(ctx,args);if(!read)return false;
  if(args.storageId)await ctx.db.patch(read._id,{status:'completed',result:undefined,resultStorageId:args.storageId});
  else if(args.failed)await ctx.db.patch(read._id,{status:'failed',error:'The reference result could not be stored. Try the read again.'});
  else return false;
  return true;
}});
export const publishLegacyRead=internalAction({args:{...mediaTaskCredentials,result:referenceReadResult},returns:v.null(),handler:async(ctx,{result,...credentials}):Promise<null>=>{
  if(!await ctx.runQuery(internal.mediaTaskResults.legacyPending,credentials))return null;
  let storageId:import('./_generated/dataModel').Id<'_storage'>|undefined;
  try{
    storageId=await ctx.storage.store(new Blob([readJson(result)],{type:'application/json'}));
    if(!await ctx.runMutation(internal.mediaTaskResults.finishLegacyRead,{...credentials,storageId}))await ctx.storage.delete(storageId);
  }catch{
    if(storageId)await ctx.storage.delete(storageId);
    await ctx.runMutation(internal.mediaTaskResults.finishLegacyRead,{...credentials,failed:true});
  }
  return null;
}});
