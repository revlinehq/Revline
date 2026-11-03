import { parse } from 'convex-helpers/validators';
import { ConvexError, v, type Infer } from 'convex/values';
import { action, internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { mediaTaskCredentials, requireMediaTask } from './lib/media_task_auth';
import { referenceReadResult } from './schema';

export const readLease = internalQuery({ args: mediaTaskCredentials, returns: v.boolean(), handler: async (ctx,args) => {
  const saved=await ctx.db.get(args.taskId);
  if(saved?.status==='completed'&&saved.leaseToken===args.leaseToken)return false;
  const task=await requireMediaTask(ctx,args.taskId,args.leaseToken);
  if(task.kind!=='read'||!task.readId)throw new ConvexError('This lease cannot publish a reference reading.');
  return true;
}});

/** Store directly from the worker's response, so image/track bytes never enter a database row. */
export const completeRead = action({ args: {...mediaTaskCredentials,result:referenceReadResult}, returns: v.null(), handler: async (ctx,{result,...credentials}):Promise<null> => {
  if(!await ctx.runQuery(internal.mediaTaskResults.readLease,credentials))return null;
  const images=[result.image,...result.extraImages??[]].filter((value):value is string=>!!value);
  if(images.some(image=>!/^[A-Za-z0-9+/]+=*$/.test(image))||images.reduce((sum,image)=>sum+image.length,0)>900_000)throw new ConvexError('The frame sheet is too large to return.');
  const json=JSON.stringify(result);
  if(new TextEncoder().encode(json).byteLength>8_000_000)throw new ConvexError('The reference reading is too large.');
  const storageId=await ctx.storage.store(new Blob([json],{type:'application/json'}));
  try { await ctx.runMutation(internal.mediaTasks.completeRead,{...credentials,storageId}); }
  catch(error) { await ctx.storage.delete(storageId);throw error; }
  return null;
}});

/** Only the owner of the pending read can consume its file, and cleanup removes the file too. */
export const consumeRead = internalAction({ args: {ownerId:v.string(),readId:v.id('referenceReads')}, returns:referenceReadResult, handler: async (ctx,args):Promise<Infer<typeof referenceReadResult>> => {
  const read=await ctx.runQuery(internal.referenceReads.get,args);
  if(read.status!=='completed')throw new ConvexError('The reference reading is not complete.');
  if(read.result)return read.result;
  if(!read.resultStorageId)throw new ConvexError('The reference reading is unavailable.');
  const url=await ctx.storage.getUrl(read.resultStorageId);
  if(!url)throw new ConvexError('The reference reading is unavailable.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw new ConvexError('The reference reading could not load.');
  const result=parse(referenceReadResult,await response.json());
  await ctx.runMutation(internal.referenceReads.discard,{readId:args.readId});
  return result;
}});
