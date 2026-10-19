import { ConvexError } from 'convex/values';
import type { Doc,Id } from '../_generated/dataModel';
import type { MutationCtx,QueryCtx } from '../_generated/server';
import { equalTimelineValue } from '../../lib/editor/timeline-equality';
import { boundedHistory } from './timeline';
type Context=MutationCtx|QueryCtx;
const aiKeys=['aiQueuePaused','aiWorkflowId','aiRunning','aiEditing','aiError','aiRunId','aiUndoRecorded','aiCheckpointRevision','aiRequest','aiRecovery'] as const;
type AI=Pick<Doc<'projects'>,typeof aiKeys[number]>;
function aiFields(project:AI):AI {return Object.fromEntries(aiKeys.filter(key=>project[key]!==undefined).map(key=>[key,project[key]]));}

export async function projectIdentity(ctx:Context,projectId:Id<'projects'>,ownerId?:string) {
  const identity=await ctx.db.query('projectAccess').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const legacy=identity?null:await ctx.db.get(projectId);
  const source=identity??legacy;
  if(!source||source.deleting||(ownerId!==undefined&&source.ownerId!==ownerId))throw new ConvexError('Project not found');
  return {_id:projectId,ownerId:source.ownerId,threadId:source.threadId};
}
export async function projectRun(ctx:Context,projectId:Id<'projects'>,ownerId?:string) {
  const identity=await projectIdentity(ctx,projectId,ownerId);
  const run=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  return {...identity,...aiFields(run??(await ctx.db.get(projectId))!)};
}
export async function readProject(ctx:Context,projectId:Id<'projects'>,includeHistory=true):Promise<Doc<'projects'>|null> {
  const project=await ctx.db.get(projectId);if(!project)return null;
  const run=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const revisions=includeHistory&&project.history===undefined?await ctx.db.query('timelineRevisions').withIndex('by_project_sequence',q=>q.eq('projectId',projectId)).order('desc').take(10):[];
  // Legacy fields support rollout and old saved fixtures until their next write.
  return {...project,...aiFields(run??{}),...aiFields(project),history:includeHistory?project.history??revisions.reverse().map(row=>row.timeline):undefined};
}
async function writeHistory(ctx:MutationCtx,project:Doc<'projects'>,history:NonNullable<Doc<'projects'>['history']>) {
  const next=boundedHistory(history),old=(await ctx.db.query('timelineRevisions').withIndex('by_project_sequence',q=>q.eq('projectId',project._id)).order('desc').take(11)).reverse();
  let bestStart=0,bestLength=0;
  for(let start=0;start<old.length;start++){let length=0;while(start+length<old.length&&length<next.length&&equalTimelineValue(old[start+length].timeline,next[length]))length++;if(length>bestLength){bestStart=start;bestLength=length;}}
  for(let index=0;index<old.length;index++)if(index<bestStart||index>=bestStart+bestLength)await ctx.db.delete(old[index]._id);
  let sequence=old.at(-1)?.sequence??0;
  for(const timeline of next.slice(bestLength))await ctx.db.insert('timelineRevisions',{projectId:project._id,ownerId:project.ownerId,sequence:++sequence,timeline});
}
export async function syncProjectCatalog(ctx:MutationCtx,project:Doc<'projects'>) {
  const existing=await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();
  const values={projectId:project._id,ownerId:project.ownerId,title:project.title,aspectRatio:project.aspectRatio,createdAt:project.createdAt,updatedAt:project.updatedAt,clipCount:project.timeline?.clips.length??0,aiRunning:!!project.aiRunning,deleting:project.deleting};
  if(existing)await ctx.db.patch(existing._id,values);else await ctx.db.insert('projectCatalog',values);
}
/** One write seam separates run state/history while preserving the public project shape. */
export async function writeProject(ctx:MutationCtx,projectId:Id<'projects'>,patch:Partial<Omit<Doc<'projects'>,'_id'|'_creationTime'>>) {
  const raw=await ctx.db.get(projectId);if(!raw)throw new ConvexError('Project not found');
  const existing=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const previous={...raw,...aiFields(existing??{}),...aiFields(raw)},next={...previous,...patch};
  const aiPatch=Object.fromEntries(aiKeys.map(key=>[key,next[key]]));
  if(!existing)await ctx.db.insert('aiRuns',{projectId,ownerId:raw.ownerId,...aiFields(next)});else if(aiKeys.some(key=>Object.hasOwn(patch,key)||Object.hasOwn(raw,key)))await ctx.db.patch(existing._id,aiPatch);
  if(Object.hasOwn(patch,'history')||raw.history!==undefined)await writeHistory(ctx,raw,patch.history??raw.history??[]);
  const plain={...patch,history:undefined,...Object.fromEntries(aiKeys.map(key=>[key,undefined]))};
  await ctx.db.patch(projectId,plain);
  const access=await ctx.db.query('projectAccess').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const identity={projectId,ownerId:raw.ownerId,historyStored:true,threadId:next.threadId,deleting:next.deleting};
  if(access){if(!access.historyStored||access.threadId!==next.threadId||access.deleting!==next.deleting)await ctx.db.patch(access._id,identity);}else await ctx.db.insert('projectAccess',identity);
  await syncProjectCatalog(ctx,next);
}
export async function createProject(ctx:MutationCtx,fields:Omit<Doc<'projects'>,'_id'|'_creationTime'>) {
  const id=await ctx.db.insert('projects',fields);await writeProject(ctx,id,{});return id;
}
export async function updateProjectCover(ctx:MutationCtx,asset:Doc<'assets'>) {
  if(asset.kind==='audio')return;
  const project=await readProject(ctx,asset.projectId);if(!project||project.deleting)return;
  const existing=await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',asset.projectId)).unique();
  if(!existing)await syncProjectCatalog(ctx,project);
  const catalog=existing??(await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',asset.projectId)).unique())!;
  await ctx.db.patch(catalog._id,{coverKind:asset.kind,coverStorageId:asset.thumbnailStorageId??(asset.kind==='image'?asset.storageId:undefined),coverR2Key:asset.kind==='image'?asset.r2Key:undefined});
}
