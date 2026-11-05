import { v, ConvexError } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireProject } from './lib/auth';
const scope = {ownerId:v.string(),projectId:v.id('projects'),timelineId:v.string(),binding:v.string()};
export const create = internalMutation({args:{...scope,state:v.string()},returns:v.id('comparisonContinuations'),handler:async(ctx,args)=>{
  await requireProject(ctx,args.projectId,args.ownerId,false);
  const id=await ctx.db.insert('comparisonContinuations',{...args,createdAt:Date.now()});
  await ctx.scheduler.runAfter(10*60_000,internal.comparisonContinuations.expire,{id});
  return id;
}});
export const load = internalQuery({args:{...scope,receipt:v.string()},returns:v.any(),handler:async(ctx,args)=>{
  await requireProject(ctx,args.projectId,args.ownerId,false);
  const id=ctx.db.normalizeId('comparisonContinuations',args.receipt), row=id?await ctx.db.get(id):null;
  if(!row||row.ownerId!==args.ownerId||row.projectId!==args.projectId||row.timelineId!==args.timelineId||row.binding!==args.binding||Date.now()-row.createdAt>=10*60_000)throw new ConvexError('Comparison receipt expired or does not match this owner, project, timeline and request.');
  return row.state;
}});
export const save = internalMutation({args:{id:v.id('comparisonContinuations'),state:v.string()},returns:v.null(),handler:async(ctx,args)=>{await ctx.db.patch(args.id,{state:args.state});return null;}});
export const expire = internalMutation({args:{id:v.id('comparisonContinuations')},returns:v.null(),handler:async(ctx,args)=>{
  const row=await ctx.db.get(args.id);if(!row)return null;
  const state=JSON.parse(row.state) as {snapshots:string[],pending:{readId?:string}[]};
  for(const raw of state.snapshots){const snapshotId=ctx.db.normalizeId('frameSnapshots',raw);if(snapshotId)await ctx.scheduler.runAfter(0,internal.mcp.discardFrames,{snapshotId});}
  for(const item of state.pending){const readId=item.readId?ctx.db.normalizeId('referenceReads',item.readId):null;if(readId)await ctx.scheduler.runAfter(0,internal.referenceReads.discard,{readId});}
  await ctx.db.delete(row._id);return null;
}});
