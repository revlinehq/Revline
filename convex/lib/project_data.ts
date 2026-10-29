import { ConvexError } from 'convex/values';
import type { Doc,Id } from '../_generated/dataModel';
import type { MutationCtx,QueryCtx } from '../_generated/server';
import { equalTimelineValue } from '../../lib/editor/timeline-equality';
import { HISTORY_KEY_VERSION, timelineHistoryKey } from '../../lib/editor/timeline-history-key';
import { normalizeTimeline, type Timeline } from '../../lib/editor/types';
import { boundedEntries, HISTORY_LIMIT, serializedBytes } from './timeline';
type Context=MutationCtx|QueryCtx;
/** A history snapshot; `id` marks a stored row that can be kept as-is. Stored entries come from the
 * history index without their timeline (load it with `historyTimelines` where it is compared). */
export type HistoryEntry={timeline?:Timeline;id?:Id<'timelineRevisions'>;key?:string;bytes?:number};
type HistoryPlan=(previous:HistoryEntry[])=>Promise<HistoryEntry[]>;
type IndexedRevision=Doc<'timelineHistoryIndex'>['entries'][number];
const aiKeys=['aiQueuePaused','aiWorkflowId','aiRunning','aiEditing','aiError','aiRunId','aiUndoRecorded','aiCheckpointRevision','aiAnalysisUsage','aiRequest','aiRecovery','aiAgentName','aiAgentActiveUntil'] as const;
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
export async function readProject(ctx:Context,projectId:Id<'projects'>,includeHistory=false):Promise<Doc<'projects'>|null> {
  const project=await ctx.db.get(projectId);if(!project)return null;
  const run=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const revisions=includeHistory&&project.history===undefined?await ctx.db.query('timelineRevisions').withIndex('by_project_sequence',q=>q.eq('projectId',projectId)).order('desc').take(HISTORY_LIMIT):[];
  // Legacy fields support rollout and old saved fixtures until their next write.
  return {...project,...aiFields(run??{}),...aiFields(project),history:includeHistory?project.history??revisions.reverse().map(row=>row.timeline):undefined};
}
/** Undo snapshots are up to 10 full timelines; this small row lists them (id, fingerprint, size) so
 * writes and the editor's subscription never re-read every snapshot. */
export function readHistoryIndex(ctx:Context,projectId:Id<'projects'>) {
  return ctx.db.query('timelineHistoryIndex').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
}
/** The stored history in order. Projects saved before the index existed read their rows once. */
async function storedHistory(ctx:Context,projectId:Id<'projects'>):Promise<(IndexedRevision&{timeline?:Timeline})[]> {
  const index=await readHistoryIndex(ctx,projectId);
  if(index)return index.entries.map(entry=>({...entry,key:index.keyVersion===HISTORY_KEY_VERSION?entry.key:''}));
  const rows=(await ctx.db.query('timelineRevisions').withIndex('by_project_sequence',q=>q.eq('projectId',projectId)).order('desc').take(HISTORY_LIMIT+1)).reverse();
  return Promise.all(rows.map(async row=>({id:row._id,sequence:row.sequence,timeline:row.timeline,bytes:serializedBytes(row.timeline),key:row.keyVersion===HISTORY_KEY_VERSION&&row.key?row.key:await timelineHistoryKey(row.timeline)})));
}
/** Load the snapshots of stored entries that a plan compares by value. */
export async function historyTimelines(ctx:Context,entries:HistoryEntry[]):Promise<(HistoryEntry&{timeline:Timeline})[]> {
  return Promise.all(entries.map(async entry=>{
    if(entry.timeline)return {...entry,timeline:entry.timeline};
    const row=entry.id&&await ctx.db.get(entry.id);if(!row)throw new ConvexError('Undo history changed. Try again.');
    return {...entry,timeline:row.timeline};
  }));
}
/** Replace history with whole snapshots. One forward scan keeps stored rows
 * that match in order; common edits (pop, filter) compare each row once. */
function replaceHistory(ctx:Context,history:Timeline[]):HistoryPlan {
  return async stored=>{const previous=await historyTimelines(ctx,stored);let from=0;return history.map(input=>{
    const timeline=normalizeTimeline(input);
    for(let index=from;index<previous.length;index++)if(equalTimelineValue(previous[index].timeline,timeline)){from=index+1;return previous[index];}
    return {timeline};
  });};
}
async function writeHistory(ctx:MutationCtx,project:Doc<'projects'>,plan:HistoryPlan) {
  const rows=await storedHistory(ctx,project._id);
  const previous:HistoryEntry[]=project.history!==undefined?project.history.map(timeline=>({timeline})):rows.slice(-HISTORY_LIMIT).map(row=>({id:row.id,key:row.key||undefined,bytes:row.bytes,...(row.timeline?{timeline:row.timeline}:{})}));
  // Kept rows must stay in sequence order ahead of every inserted snapshot.
  const order=new Map(rows.map((row,index)=>[row.id,index]));let last=-1,fresh=false;
  const next:HistoryEntry[]=[];
  for(const entry of boundedEntries(await plan(previous))){
    const index=entry.id===undefined?undefined:order.get(entry.id);
    if(!fresh&&index!==undefined&&index>last){last=index;next.push(entry);continue;}
    // A stored snapshot moved out of order is written again, so read it before its row goes.
    fresh=true;next.push({timeline:(await historyTimelines(ctx,[entry]))[0].timeline,key:entry.key,bytes:entry.bytes});
  }
  const kept=new Set(next.flatMap(entry=>entry.id?[entry.id]:[]));
  for(const row of rows)if(!kept.has(row.id))await ctx.db.delete(row.id);
  let sequence=rows.at(-1)?.sequence??0;
  const byId=new Map(rows.map(row=>[row.id,row]));
  const entries:IndexedRevision[]=[];
  for(const entry of next){
    const stored=entry.id&&byId.get(entry.id);
    if(stored){entries.push({id:stored.id,sequence:stored.sequence,key:stored.key||await timelineHistoryKey((await historyTimelines(ctx,[entry]))[0].timeline),bytes:stored.bytes});continue;}
    const timeline=entry.timeline!,key=entry.key??await timelineHistoryKey(timeline);
    const id=await ctx.db.insert('timelineRevisions',{projectId:project._id,ownerId:project.ownerId,sequence:++sequence,timeline,key,keyVersion:HISTORY_KEY_VERSION});
    entries.push({id,sequence,key,bytes:entry.bytes??serializedBytes(timeline)});
  }
  const index=await readHistoryIndex(ctx,project._id);
  if(index)await ctx.db.replace(index._id,{projectId:project._id,keyVersion:HISTORY_KEY_VERSION,entries});else await ctx.db.insert('timelineHistoryIndex',{projectId:project._id,keyVersion:HISTORY_KEY_VERSION,entries});
}
export async function syncProjectCatalog(ctx:MutationCtx,project:Doc<'projects'>) {
  const existing=await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();
  const values={projectId:project._id,ownerId:project.ownerId,title:project.title,aspectRatio:project.aspectRatio,createdAt:project.createdAt,updatedAt:project.updatedAt,clipCount:project.timeline?.clips.length??0,aiRunning:!!project.aiRunning,deleting:project.deleting};
  if(!existing){await ctx.db.insert('projectCatalog',values);return;}
  // Every open project list re-runs when a catalog row changes. Write only when something the list
  // shows changed; a newer updatedAt alone is written at most once a minute.
  const shown=(['title','aspectRatio','clipCount','aiRunning','deleting'] as const).some(key=>existing[key]!==values[key]);
  const stale=values.updatedAt!==existing.updatedAt&&(values.updatedAt??0)-(existing.updatedAt??0)>=60_000;
  if(shown||stale||values.ownerId!==existing.ownerId)await ctx.db.patch(existing._id,values);
}
/** One write seam separates run state/history while preserving the public project shape.
 * `planHistory` derives the next history from the stored one without a second read. */
export async function writeProject(ctx:MutationCtx,projectId:Id<'projects'>,patch:Partial<Omit<Doc<'projects'>,'_id'|'_creationTime'>>,planHistory?:HistoryPlan) {
  const raw=await ctx.db.get(projectId);if(!raw)throw new ConvexError('Project not found');
  const existing=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const previous={...raw,...aiFields(existing??{}),...aiFields(raw)},next={...previous,...patch};
  const aiPatch=Object.fromEntries(aiKeys.map(key=>[key,next[key]]));
  if(!existing)await ctx.db.insert('aiRuns',{projectId,ownerId:raw.ownerId,...aiFields(next)});else if(aiKeys.some(key=>Object.hasOwn(patch,key)||Object.hasOwn(raw,key)))await ctx.db.patch(existing._id,aiPatch);
  if(planHistory||Object.hasOwn(patch,'history')||raw.history!==undefined)await writeHistory(ctx,raw,planHistory??replaceHistory(ctx,patch.history??raw.history??[]));
  const plain={...patch,history:undefined,...Object.fromEntries(aiKeys.map(key=>[key,undefined]))};
  // Every write to the project document re-runs each open editor's project queries; skip no-op patches
  // (AI state alone lives on aiRuns) unless legacy fields still need clearing from the document.
  const changes=Object.entries(plain).filter(([key,value])=>value!==undefined||Object.hasOwn(raw,key));
  if(changes.length)await ctx.db.patch(projectId,Object.fromEntries(changes));
  const access=await ctx.db.query('projectAccess').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const identity={projectId,ownerId:raw.ownerId,historyStored:true,threadId:next.threadId,deleting:next.deleting,timelineTabs:next.timelineTabs??[],activeTimelineId:next.activeTimelineId};
  const tabsChanged=JSON.stringify(access?.timelineTabs)!==JSON.stringify(identity.timelineTabs)||access?.activeTimelineId!==identity.activeTimelineId;
  if(access){if(!access.historyStored||access.threadId!==next.threadId||access.deleting!==next.deleting||tabsChanged)await ctx.db.patch(access._id,identity);}else await ctx.db.insert('projectAccess',identity);
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
