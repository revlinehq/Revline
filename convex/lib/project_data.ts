import { ConvexError } from 'convex/values';
import { isMcpRun } from './run_ids';
import type { Doc,Id } from '../_generated/dataModel';
import type { MutationCtx,QueryCtx } from '../_generated/server';
import { equalTimelineValue } from '../../lib/editor/timeline-equality';
import { HISTORY_KEY_VERSION, timelineHistoryKey } from '../../lib/editor/timeline-history-key';
import { normalizeTimeline, type Timeline } from '../../lib/editor/types';
import { boundedEntries, HISTORY_LIMIT, serializedBytes } from './timeline_history';
import { loadSceneCode, storeSceneCode, storedSceneCode } from './scene_code';
import { recordRevision, type RevisionNote } from './revision_log';
type Context=MutationCtx|QueryCtx;
/** A history snapshot; `id` marks a stored row that can be kept as-is. Stored entries come from the
 * history index without their timeline (load it with `historyTimelines` where it is compared). */
export type HistoryEntry={timeline?:Timeline;id?:Id<'timelineRevisions'>;key?:string;bytes?:number};
type HistoryPlan=(previous:HistoryEntry[])=>Promise<HistoryEntry[]>;
type IndexedRevision=Doc<'timelineHistoryIndex'>['entries'][number];
const aiKeys=['aiQueuePaused','aiWorkflowId','aiRunning','aiEditing','aiError','aiRunId','aiUndoRecorded','aiCheckpointRevision','aiAnalysisUsage','aiRequest','aiRecovery','aiAgentName','aiAgentActiveUntil','aiReturnTimelineId'] as const;
const payloadKeys=['aiRequest','aiRecovery'] as const;
const runKeys=aiKeys.filter(key=>key!=='aiRequest'&&key!=='aiRecovery');
type AI=Pick<Doc<'projects'>,typeof aiKeys[number]>;
function aiFields(project:AI):AI {return Object.fromEntries(aiKeys.filter(key=>project[key]!==undefined).map(key=>[key,project[key]]));}

export async function projectIdentity(ctx:Context,projectId:Id<'projects'>,ownerId?:string) {
  const identity=await ctx.db.query('projectAccess').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const legacy=identity?null:await ctx.db.get(projectId);
  const source=identity??legacy;
  if(!source||source.deleting||(ownerId!==undefined&&source.ownerId!==ownerId))throw new ConvexError('Project not found');
  return {_id:projectId,ownerId:source.ownerId,threadId:source.threadId,...(source.timelineTabs!==undefined?{timelineTabs:source.timelineTabs}:{}),...(source.activeTimelineId!==undefined?{activeTimelineId:source.activeTimelineId}:{})};
}
export async function projectRun(ctx:Context,projectId:Id<'projects'>,ownerId?:string) {
  const identity=await projectIdentity(ctx,projectId,ownerId);
  const run=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  return {...identity,...aiFields(run??(await ctx.db.get(projectId))!)};
}
/** Only run bookkeeping and a revision number; never a timeline, scene or prompt. */
export async function projectRunContext(ctx:Context,projectId:Id<'projects'>,ownerId?:string) {
  const run=await projectRun(ctx,projectId,ownerId);
  const metadata=await ctx.db.query('projectRunMetadata').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const legacy=metadata?null:await ctx.db.get(projectId);
  return {...run,...(legacy?{timelineTabs:legacy.timelineTabs,activeTimelineId:legacy.activeTimelineId}:{}),revision:metadata?.revision??legacy?.revision??0};
}
export async function runPayload(ctx:Context,projectId:Id<'projects'>) {
  return ctx.db.query('aiRunPayloads').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
}
/** Fast run-only writes leave timelines, history and prompt payloads out of the transaction. */
export async function writeRunState(ctx:MutationCtx,projectId:Id<'projects'>,patch:AI) {
  const identity=await projectIdentity(ctx,projectId);
  const row=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  // Upgrade legacy projects at the established write seam once.
  const metadata=await ctx.db.query('projectRunMetadata').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  if(!row||!metadata||row.aiRequest!==undefined||row.aiRecovery!==undefined){await writeProject(ctx,projectId,patch);return;}
  const changes=Object.fromEntries(runKeys.filter(key=>Object.hasOwn(patch,key)).map(key=>[key,patch[key]]));
  if(Object.keys(changes).length)await ctx.db.patch(row._id,changes);
  if(payloadKeys.some(key=>Object.hasOwn(patch,key))){
    const payload=await runPayload(ctx,projectId);
    const value=Object.fromEntries(payloadKeys.map(key=>[key,Object.hasOwn(patch,key)?patch[key]:payload?.[key]]));
    if(payload)await ctx.db.patch(payload._id,value);else if(Object.values(value).some(value=>value!==undefined))await ctx.db.insert('aiRunPayloads',{projectId,...value});
  }
  const next={...row,...patch};
  await syncProjectAgent(ctx,projectId,next);
  if(Object.hasOwn(patch,'aiRunning')){
    const catalog=await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
    if(catalog&&catalog.aiRunning!==!!next.aiRunning)await ctx.db.patch(catalog._id,{aiRunning:!!next.aiRunning});
  }
  return identity;
}
/** `sceneCode: false` keeps scene code as stored (by hash) for editors that load each code once. */
export async function readProject(ctx:Context,projectId:Id<'projects'>,includeHistory=false,sceneCode=true):Promise<Doc<'projects'>|null> {
  const project=await ctx.db.get(projectId);if(!project)return null;
  return hydrateProject(ctx,project,includeHistory,sceneCode);
}
/** The public project shape from a document already read, so a caller that checked the raw row does not read it twice. */
export async function hydrateProject(ctx:Context,project:Doc<'projects'>,includeHistory=false,sceneCode=true):Promise<Doc<'projects'>> {
  const projectId=project._id;
  const run=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const payload=await runPayload(ctx,projectId);
  const revisions=includeHistory&&project.history===undefined?await ctx.db.query('timelineRevisions').withIndex('by_project_sequence',q=>q.eq('projectId',projectId)).order('desc').take(HISTORY_LIMIT):[];
  // Legacy fields support rollout and old saved fixtures until their next write.
  const restore=(timeline:Timeline)=>sceneCode?loadSceneCode(ctx,timeline):timeline;
  const history=includeHistory?await Promise.all((project.history??revisions.reverse().map(row=>row.timeline)).map(restore)):undefined;
  return {...project,...aiFields(run??{}),...aiFields(payload??{}),...aiFields(project),timeline:project.timeline&&await restore(project.timeline),history};
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
  return Promise.all(rows.map(async row=>({id:row._id,sequence:row.sequence,timeline:await loadSceneCode(ctx,row.timeline),bytes:serializedBytes(row.timeline),key:row.keyVersion===HISTORY_KEY_VERSION&&row.key?row.key:await timelineHistoryKey(await loadSceneCode(ctx,row.timeline))})));
}
/** Load the snapshots of stored entries that a plan compares by value. */
export async function historyTimelines(ctx:Context,entries:HistoryEntry[]):Promise<(HistoryEntry&{timeline:Timeline})[]> {
  return Promise.all(entries.map(async entry=>{
    if(entry.timeline)return {...entry,timeline:entry.timeline};
    const row=entry.id&&await ctx.db.get(entry.id);if(!row)throw new ConvexError('Undo history changed. Try again.');
    return {...entry,timeline:await loadSceneCode(ctx,row.timeline)};
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
  const next:HistoryEntry[]=[],known=storedSceneCode(project.timeline);
  // Apply the history budget to the bytes actually stored, not hydrated scene code.
  const planned=await plan(previous);
  const sized=await Promise.all(planned.map(async entry=>entry.bytes!==undefined||!entry.timeline?entry:{...entry,bytes:serializedBytes(await storeSceneCode(ctx,entry.timeline,known))}));
  for(const entry of boundedEntries(sized)){
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
    // Fingerprints cover the full timeline, as the editor computes them; the row stores scene code by hash.
    const key=entry.key??await timelineHistoryKey(entry.timeline!),timeline=await storeSceneCode(ctx,entry.timeline!,known);
    const id=await ctx.db.insert('timelineRevisions',{projectId:project._id,ownerId:project.ownerId,sequence:++sequence,timeline,key,keyVersion:HISTORY_KEY_VERSION});
    entries.push({id,sequence,key,bytes:serializedBytes(timeline)});
  }
  const index=await readHistoryIndex(ctx,project._id);
  if(index)await ctx.db.replace(index._id,{projectId:project._id,keyVersion:HISTORY_KEY_VERSION,entries});else await ctx.db.insert('timelineHistoryIndex',{projectId:project._id,keyVersion:HISTORY_KEY_VERSION,entries});
}
type AgentState=Pick<Doc<'projects'>,'aiAgentName'|'aiAgentActiveUntil'|'aiRunning'|'aiRunId'>;
export function projectAgentSummary(project:AgentState) {
  return project.aiAgentName?{name:project.aiAgentName.replace(/\s*\([^)]*\)\s*$/,'')||project.aiAgentName,until:project.aiAgentActiveUntil??0,running:!!project.aiRunning&&isMcpRun(project.aiRunId)}:null;
}
/** The catalog never joins prompt/recovery rows just to show the connected agent. */
export async function syncProjectAgent(ctx:MutationCtx,projectId:Id<'projects'>,state:AgentState) {
  const row=await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const agentSummary=projectAgentSummary(state);
  if(row&&JSON.stringify(row.agentSummary)!==JSON.stringify(agentSummary))await ctx.db.patch(row._id,{agentSummary});
}
async function syncProjectCatalog(ctx:MutationCtx,project:Doc<'projects'>) {
  const existing=await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();
  const values={agentSummary:projectAgentSummary(project),projectId:project._id,ownerId:project.ownerId,title:project.title,aspectRatio:project.aspectRatio,createdAt:project.createdAt,updatedAt:project.updatedAt,clipCount:project.timeline?.clips.length??0,aiRunning:!!project.aiRunning,deleting:project.deleting};
  if(!existing){await ctx.db.insert('projectCatalog',values);return;}
  // Every open project list re-runs when a catalog row changes. Write only when something the list
  // shows changed; a newer updatedAt alone is written at most once a minute.
  const shown=(['title','aspectRatio','clipCount','aiRunning','deleting'] as const).some(key=>existing[key]!==values[key]);
  const stale=values.updatedAt!==existing.updatedAt&&(values.updatedAt??0)-(existing.updatedAt??0)>=60_000;
  if(shown||stale||values.ownerId!==existing.ownerId||JSON.stringify(existing.agentSummary)!==JSON.stringify(values.agentSummary))await ctx.db.patch(existing._id,values);
}
/** One write seam separates run state/history while preserving the public project shape.
 * `planHistory` derives the next history from the stored one without a second read. */
export async function writeProject(ctx:MutationCtx,projectId:Id<'projects'>,patch:Partial<Omit<Doc<'projects'>,'_id'|'_creationTime'>>,planHistory?:HistoryPlan,note?:RevisionNote) {
  const raw=await ctx.db.get(projectId);if(!raw)throw new ConvexError('Project not found');
  const existing=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  const payload=await runPayload(ctx,projectId);
  const previous={...raw,...aiFields(existing??{}),...aiFields(payload??{}),...aiFields(raw)},next={...previous,...patch};
  const aiPatch=Object.fromEntries(aiKeys.map(key=>[key,payloadKeys.some(name=>name===key)?undefined:next[key]]));
  if(!existing)await ctx.db.insert('aiRuns',{projectId,ownerId:raw.ownerId,...Object.fromEntries(runKeys.filter(key=>next[key]!==undefined).map(key=>[key,next[key]]))});else if(aiKeys.some(key=>Object.hasOwn(patch,key)||Object.hasOwn(raw,key))||payloadKeys.some(key=>Object.hasOwn(existing,key)))await ctx.db.patch(existing._id,aiPatch);
  if(!payload||payloadKeys.some(key=>Object.hasOwn(patch,key)||Object.hasOwn(existing??{},key)||Object.hasOwn(raw,key))){
    const value={projectId,aiRequest:next.aiRequest,aiRecovery:next.aiRecovery};
    if(payload)await ctx.db.patch(payload._id,value);else if(next.aiRequest!==undefined||next.aiRecovery!==undefined)await ctx.db.insert('aiRunPayloads',value);
  }
  const metadata=await ctx.db.query('projectRunMetadata').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  if(!metadata)await ctx.db.insert('projectRunMetadata',{projectId,revision:next.revision??0});else if(metadata.revision!==(next.revision??0))await ctx.db.patch(metadata._id,{revision:next.revision??0});
  if(planHistory||Object.hasOwn(patch,'history')||raw.history!==undefined)await writeHistory(ctx,raw,planHistory??replaceHistory(ctx,patch.history??raw.history??[]));
  const plain={...patch,...(patch.timeline?{timeline:await storeSceneCode(ctx,patch.timeline,storedSceneCode(raw.timeline))}:{}),history:undefined,...Object.fromEntries(aiKeys.map(key=>[key,undefined]))};
  // Every write to the project document re-runs each open editor's project queries; skip no-op patches
  // (AI state alone lives on aiRuns) unless legacy fields still need clearing from the document.
  // A new revision of the same tab is an edit; a tab switch (another tab's timeline arriving) is not.
  const tab=raw.activeTimelineId??raw.timelineTabs?.[0]?.id??'main';
  if(plain.timeline&&raw.timeline&&patch.revision!==undefined&&patch.revision!==raw.revision&&(next.activeTimelineId??tab)===tab)await recordRevision(ctx,previous,tab,raw.timeline,plain.timeline,patch.revision,note);
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
/** A cover from one asset: its thumbnail, the image itself, or a video's playable preview (shown at its first frame). */
export function projectCoverOf(asset:Doc<'assets'>):{coverKind:'video'|'image';coverStorageId?:Id<'_storage'>;coverR2Key?:string}|null {
  if(asset.thumbnailStorageId)return {coverKind:'image',coverStorageId:asset.thumbnailStorageId,coverR2Key:undefined};
  if(asset.kind==='image')return asset.storageId||asset.r2Key?{coverKind:'image',coverStorageId:asset.storageId,coverR2Key:asset.r2Key}:null;
  if(asset.kind==='video'){const key=asset.previewR2Key??asset.r2Key;return key?{coverKind:'video',coverStorageId:undefined,coverR2Key:key}:null;}
  return null;
}
export async function updateProjectCover(ctx:MutationCtx,asset:Doc<'assets'>) {
  if(asset.kind==='audio')return;
  const project=await readProject(ctx,asset.projectId);if(!project||project.deleting)return;
  const existing=await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',asset.projectId)).unique();
  if(!existing)await syncProjectCatalog(ctx,project);
  const catalog=existing??(await ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',asset.projectId)).unique())!;
  const cover=projectCoverOf(asset);
  // Media without a usable picture (a linked video before its thumbnail) keeps the current cover.
  if(cover)await ctx.db.patch(catalog._id,cover);
}
