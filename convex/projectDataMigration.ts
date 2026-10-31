import { v } from 'convex/values';
import { internalMutation,internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { shareAnalysis } from './lib/asset_analysis';
import { writeProject,updateProjectCover,projectCoverOf } from './lib/project_data';
const key='project-data-v1';
export const initialize=internalMutation({args:{},returns:v.null(),handler:async ctx=>{
  for(const name of [key,'asset-data-v1']){const state=await ctx.db.query('projectDataMigration').withIndex('by_key',q=>q.eq('key',name)).unique();if(!state)await ctx.db.insert('projectDataMigration',{key:name,cursor:null,completed:false});}
  await ctx.scheduler.runAfter(0,internal.projectDataMigration.batch,{});await ctx.scheduler.runAfter(0,internal.projectDataMigration.assets,{});return null;
}});
export const batch=internalMutation({args:{},returns:v.null(),handler:async ctx=>{
  const state=await ctx.db.query('projectDataMigration').withIndex('by_key',q=>q.eq('key',key)).unique();if(!state||state.completed)return null;
  // One legacy document per page bounds reads even for maximum-size histories.
  const page=await ctx.db.query('projects').paginate({cursor:state.cursor,numItems:1});
  for(const project of page.page){await writeProject(ctx,project._id,{});const media=await ctx.db.query('assets').withIndex('by_ownerId_projectId',q=>q.eq('ownerId',project.ownerId).eq('projectId',project._id)).order('desc').take(5);const cover=media.find(asset=>asset.kind==='image'||asset.kind==='video');if(cover)await updateProjectCover(ctx,cover);}
  await ctx.db.patch(state._id,{cursor:page.continueCursor,completed:page.isDone});
  if(!page.isDone)await ctx.scheduler.runAfter(0,internal.projectDataMigration.batch,{});return null;
}});
export const assets=internalMutation({args:{},returns:v.null(),handler:async ctx=>{
  const state=await ctx.db.query('projectDataMigration').withIndex('by_key',q=>q.eq('key','asset-data-v1')).unique();if(!state||state.completed)return null;
  const page=await ctx.db.query('assets').paginate({cursor:state.cursor,numItems:1});for(const asset of page.page)await shareAnalysis(ctx,asset);
  await ctx.db.patch(state._id,{cursor:page.continueCursor,completed:page.isDone});if(!page.isDone)await ctx.scheduler.runAfter(0,internal.projectDataMigration.assets,{});return null;
}});
export const status=internalQuery({args:{},returns:v.object({projects:v.boolean(),assets:v.boolean()}),handler:async ctx=>{const read=async(name:string)=>!!(await ctx.db.query('projectDataMigration').withIndex('by_key',q=>q.eq('key',name)).unique())?.completed;return {projects:await read(key),assets:await read('asset-data-v1')};}});
/** Gives every project a cover again from its newest media with a picture; earlier, a linked video without a thumbnail blanked it. */
export const refreshCovers=internalMutation({args:{cursor:v.union(v.string(),v.null())},returns:v.null(),handler:async(ctx,args)=>{
  const page=await ctx.db.query('projectCatalog').paginate({cursor:args.cursor,numItems:50});
  for(const row of page.page){
    const media=await ctx.db.query('assets').withIndex('by_ownerId_projectId',q=>q.eq('ownerId',row.ownerId).eq('projectId',row.projectId)).order('desc').take(40);
    const cover=media.map(projectCoverOf).find(Boolean);
    if(cover)await ctx.db.patch(row._id,cover);
  }
  if(!page.isDone)await ctx.scheduler.runAfter(0,internal.projectDataMigration.refreshCovers,{cursor:page.continueCursor});return null;
}});
