import { removeFrameCacheBatch } from './frameCache';
import { deleteMediaTask } from './lib/media_task_data';
import { deleteProjectMemories } from './memories';
import { deleteRenderSnapshot } from './lib/render_snapshots';
import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { components,internal } from './_generated/api';
import { cancelMediaTask } from './lib/media_queue';
import { forgetStorageObject } from './lib/storage_accounting';
import { removeMediaAttachment,removeProjectShares } from './lib/shared_media';
import { HISTORY_LIMIT } from './lib/timeline_history';
import { deleteRevisionBatch } from './lib/revision_log';

/** Hiding the project blocks new work; each transaction reclaims a bounded page. */
export const batch=internalMutation({args:{projectId:v.id('projects'),ownerId:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const project=await ctx.db.get(args.projectId);
  if(!project||project.ownerId!==args.ownerId||!project.deleting)return null;
  const again=async()=>{const deletionJobId=await ctx.scheduler.runAfter(0,internal.projectDeletion.batch,args);await ctx.db.patch(project._id,{deletionJobId});};
  const tasks=await ctx.db.query('mediaTasks').withIndex('by_project_createdAt',q=>q.eq('projectId',project._id)).take(50);
  if(tasks.length){for(const task of tasks){await cancelMediaTask(ctx,task._id);await deleteMediaTask(ctx,task._id);}await again();return null;}
  if(await removeFrameCacheBatch(ctx,project._id)){await again();return null;}
  if(project.threadId){
    const views=await ctx.db.query('assistantMessageViews').withIndex('by_thread_order',q=>q.eq('threadId',project.threadId!)).take(50);
    if(views.length){for(const view of views)await ctx.db.delete(view._id);await again();return null;}
    const files=await ctx.db.query('assistantDisplayFiles').withIndex('by_thread',q=>q.eq('threadId',project.threadId!)).take(20);
    if(files.length){for(const row of files){for(const id of row.storageIds)await ctx.storage.delete(id);await ctx.db.delete(row._id);}await again();return null;}
    const thread=await ctx.db.query('assistantMessageThreads').withIndex('by_thread',q=>q.eq('threadId',project.threadId!)).unique();
    if(thread)await ctx.db.delete(thread._id);
  }
  const shares=await ctx.db.query('timelineShares').withIndex('by_project',q=>q.eq('projectId',project._id)).take(1);
  if(shares.length){await removeProjectShares(ctx,project._id);await again();return null;}
  const assets=await ctx.db.query('assets').withIndex('by_ownerId_projectId',q=>q.eq('ownerId',args.ownerId).eq('projectId',project._id)).take(20);
  if(assets.length){for(const asset of assets)await removeMediaAttachment(ctx,asset);await again();return null;}
  const jobs=await ctx.db.query('renderJobs').withIndex('by_ownerId_projectId',q=>q.eq('ownerId',args.ownerId).eq('projectId',project._id)).take(20);
  if(jobs.length){for(const job of jobs){await forgetStorageObject(ctx,args.ownerId,{r2Key:job.outputR2Key,storageId:job.outputStorageId});await deleteRenderSnapshot(ctx,job._id);if(job.outputStorageId)await ctx.storage.delete(job.outputStorageId);if(job.outputR2Key)await ctx.scheduler.runAfter(0,internal.r2.deleteObject,{key:job.outputR2Key});await ctx.db.delete(job._id);}await again();return null;}
  const tickets=await ctx.db.query('uploadTickets').withIndex('by_projectId',q=>q.eq('projectId',project._id)).take(50);
  if(tickets.length){for(const ticket of tickets){if(ticket.storageId&&!ticket.consumed){await ctx.storage.delete(ticket.storageId);await forgetStorageObject(ctx,args.ownerId,{storageId:ticket.storageId});}await ctx.db.delete(ticket._id);}await again();return null;}
  const requests=await ctx.db.query('analysisRequests').withIndex('by_projectId',q=>q.eq('projectId',project._id)).take(50);
  if(requests.length){for(const request of requests)await ctx.db.delete(request._id);await again();return null;}
  await deleteProjectMemories(ctx,args.ownerId,project._id);
  for(const table of ['clippingRuns','editingLaneTabs','editingLaneTasks','mcpLaneSessions','pixelTrackChunks','derivations','cutouts','referenceReads','frameSnapshotPayloads','frameSnapshotControls','frameSnapshots','mcpRunTimeouts','aiBudgets','compositionReviews','assistantPlans','assistantQueue','projectBriefs','assistantTurns','assistantTurnViews','mediaTaskProgress'] as const){const rows=await ctx.db.query(table).withIndex('by_project',q=>q.eq('projectId',project._id)).take(20);if(rows.length){for(const row of rows){if('resultStorageId' in row&&row.resultStorageId)await ctx.storage.delete(row.resultStorageId);if('scheduledId' in row){const scheduled=await ctx.db.system.get(row.scheduledId);if(scheduled?.state.kind==='pending')await ctx.scheduler.cancel(row.scheduledId);}await ctx.db.delete(row._id);}await again();return null;}}
  const completedUploads=await ctx.db.query('r2Uploads').withIndex('by_projectId_completed',q=>q.eq('projectId',project._id).eq('completed',true)).take(50);
  if(completedUploads.length){for(const upload of completedUploads)await ctx.db.delete(upload._id);await again();return null;}
  const uploads=await ctx.db.query('r2Uploads').withIndex('by_projectId_completed',q=>q.eq('projectId',project._id).eq('completed',false)).filter(q=>q.neq(q.field('cleanupScheduled'),true)).take(20);
  if(uploads.length){for(const upload of uploads){await ctx.db.patch(upload._id,{cleanupScheduled:true});await ctx.scheduler.runAfter(0,internal.r2.cleanupLease,{uploadId:upload._id});}await again();return null;}
  if(await deleteRevisionBatch(ctx,project._id)){await again();return null;}
  const tabs=await ctx.db.query('projectTimelines').withIndex('by_project_timeline',q=>q.eq('projectId',project._id)).take(10);
  if(tabs.length){for(const row of tabs)await ctx.db.delete(row._id);await again();return null;}
  const tabHistories=await ctx.db.query('projectTimelineHistories').withIndex('by_project_timeline',q=>q.eq('projectId',project._id)).take(10);
  if(tabHistories.length){for(const row of tabHistories)await ctx.db.delete(row._id);await again();return null;}
  if(project.threadId)await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync,{threadId:project.threadId});
  for(const table of ['timelineRevisions','timelineHistoryIndex','projectRunMetadata','aiRunPayloads','aiRuns','aiTimelinePreviews','projectAccess','projectCatalog'] as const){const rows=table==='timelineRevisions'?await ctx.db.query(table).withIndex('by_project_sequence',q=>q.eq('projectId',project._id)).take(HISTORY_LIMIT+1):await ctx.db.query(table).withIndex('by_project',q=>q.eq('projectId',project._id)).take(1);for(const row of rows)await ctx.db.delete(row._id);}
  await ctx.db.delete(project._id);return null;
}});
