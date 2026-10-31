import {validatePinnedClaudeModel,type ClaudeModelSelection} from '../lib/ai/claude-model';
import { READ_ONLY_RUN_PREFIX, readRunTab } from './lib/run_ids';
import type {MutationCtx, QueryCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {aiWorkflow} from './lib/workflows';
import {cancelTurn} from './assistantWorkflow';
import {agentRunnerConfigured,startRunnerTurn,stopRunnerTurn} from './agentRunner';
import type {WorkflowId} from '@convex-dev/workflow';
import { describeLiveEdit } from '../lib/editor/live-edit';
import { equalTimelineValue } from '../lib/editor/timeline-equality';
import { hydrateAsset, storeAnalysis } from './lib/asset_analysis';
import { attachStockAudio, validateWaveform } from './assets';
import { recordAssetStorage } from './lib/storage_accounting';
import { writeProject,readProject,projectIdentity,projectRun } from './lib/project_data';
import { loadSceneCode, storeSceneCode, storedSceneCode } from './lib/scene_code';
import { activeTabOf, openTabFor, storedTabTimeline, tabsOf } from './timelineTabs';
import { withoutSceneCode } from '../lib/editor/scene-code';
import { billingEnabled, hasUltraPlan, requireEditorAccess } from './lib/billing_access';
import { abortStream, createThread, listStreams, listUIMessages, saveMessage, syncStreams, vPaginationResult, vStreamArgs } from "@convex-dev/agent";
import { vStreamDelta, vStreamMessage } from "@convex-dev/agent/validators";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireOwner, requireProject } from "./lib/auth";
import { commitTimeline, currentTimeline, rejectNewLayerOverlaps, validateTimeline } from "./lib/timeline";
import { TIMELINE_CONFLICT } from "../lib/editor/timeline-sync";
import { analysisMode, analysisRequestDocument, assetDocument, waveformValidator, beatsValidator, clipValidator, frameRequestValidator, videoRequestValidator, projectDocument, timelineValidator } from "./schema";
import { validateFrameInspectionInput } from '../lib/media-analysis/frame-inspection';
import { validateVideoInspectionInput } from '../lib/media-analysis/video-inspection';
import { normalizeTimeline } from '../lib/editor/types';
import {savePublicationReceipt} from './lib/publicationReceipt';
import { enqueueMediaTask, cancelMediaTask, detachAnalysisRequest } from './mediaTasks';
import { consumeAssistantRequest, requireMediaTaskCapacity } from './lib/account_limits';
import { assertEditorModelConfigured, claudeModelSwitcherEnabled, defaultEditorModelChoice, defaultEditorReasoningEffort, resolveClaudeModel, withEditorReasoning, withEditorSpeed } from '../lib/ai/claude-model';
import { claudeModelChoiceValidator, legacyCompatibleModelChoiceValidator, editorReasoningEffortValidator, editorSpeedModeValidator } from './lib/claude_model';
import { allowedClaudeModelChoices, ANTHROPIC_EDIT_CHOICES, enforceClaudeModelPolicy } from '../lib/ai/claude-model-policy';
import { assistantRecovery } from './lib/assistant_recovery';
import { MEDIA_ACTIVITY_LABELS } from '../lib/media-analysis/activity';
import { editingWorkflowActive } from './lib/assistant_workflow';
const providerReason = "Configure OPENAI_API_KEY (GPT-6.1 Sol, GPT-6 Astra) or ANTHROPIC_API_KEY (Sonnet 5.5, Opus 5.5) in Convex to edit.";
function configured() {
  try{assertEditorModelConfigured(resolveClaudeModel());return true;}catch{return false;}
}
/** Manual model, reasoning and speed choices: Ultra accounts, or a deployment
 * that opens them to everyone (development sets EDITOR_MODEL_CHOICE_OPEN). */
/** Opus and Sonnet cost too much to run in the editor chat on Pro (trial included): they run through MCP, on the user's own Claude. In-app only without billing (development) or on Ultra. */
async function claudeInApp(ctx: QueryCtx | MutationCtx, ownerId: string) {
  return !billingEnabled() || await hasUltraPlan(ctx, ownerId);
}
/** Every plan picks its model; Claude models only where claudeInApp allows. Null when the switcher is off. */
async function editorModelChoices(ctx: QueryCtx | MutationCtx, ownerId: string) {
  if (!claudeModelSwitcherEnabled()) return null;
  const choices = allowedClaudeModelChoices();
  return await claudeInApp(ctx, ownerId) ? choices : choices.filter(choice => !ANTHROPIC_EDIT_CHOICES.some(item => item === choice));
}
async function canChooseEditorModel(ctx: QueryCtx | MutationCtx, ownerId: string, modelChoice?: string) {
  const choices = await editorModelChoices(ctx, ownerId);
  return !!choices && (modelChoice === undefined || choices.some(choice => choice === modelChoice));
}
export const status = query({ args: { projectId: v.id("projects") }, returns: v.object({ configured: v.boolean(), modelSwitcher: v.optional(v.boolean()), allowedModels: v.optional(v.array(claudeModelChoiceValidator)), claudeViaMcp: v.optional(v.boolean()), defaultModelChoice:v.optional(claudeModelChoiceValidator), defaultReasoningEffort:v.optional(editorReasoningEffortValidator), running: v.boolean(), externalAgent: v.union(v.object({ name: v.string(), until: v.number(), running: v.boolean() }), v.null()), editing: v.boolean(), workflowActive: v.boolean(), error: v.union(v.string(), v.null()), reason: v.union(v.string(), v.null()), activity: v.union(v.string(), v.null()), activitySource: v.union(v.string(), v.null()), activityProgress: v.union(v.number(), v.null()), activityStartedAt: v.union(v.number(), v.null()), budgetUsed: v.optional(v.number()), effortSwitcher: v.optional(v.boolean()), liveEffort: v.optional(editorReasoningEffortValidator) }), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), project = await projectRun(ctx,args.projectId,ownerId);
  const requests = project.aiRunning && project.aiRunId ? await ctx.db.query('analysisRequests').withIndex('by_projectId_runId', q => q.eq('projectId', project._id).eq('aiRunId', project.aiRunId!)).take(16) : [];
  const active = requests.find(request => request.status === 'pending' || request.status === 'running');
  const task = active?.taskId ? await ctx.db.get(active.taskId) : null;
  const source = active ? await ctx.db.get(active.assetId) : null;
  const labels = { transcribe: 'Listening to your footage…', understand: 'Analyzing footage…', shots: 'Finding shot changes…', beats: 'Finding the rhythm…', track: 'Following the subject…', reference: 'Breaking down the reference…', frames: 'Inspecting the moment…', video: 'Analyzing footage…' };
  let defaultModelChoice;try{defaultModelChoice=defaultEditorModelChoice();}catch{}
  const ready=configured();
  const editing=!!project.aiRunning&&(project.aiEditing??project.aiUndoRecorded??false);
  // Run-scoped analysis remains evidence of the editing workflow while the
  // model plans its next step; a plain reply never acquires this workflow lock.
  const workflowActive=await editingWorkflowActive(ctx,project,requests.length>0);
  // The row outlives its run so the development effort switcher can show the last pick.
  const budgetRow=await ctx.db.query('aiBudgets').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();
  const budget=project.aiRunning&&project.aiRunId?budgetRow:null;
  const activity=active?task?.status==='retrying'||task?.status==='queued'&&(task.attempt>1)?'Retrying analysis…':task?.status==='queued'?'Queued for analysis…':task?.activity?MEDIA_ACTIVITY_LABELS[task.activity]:labels[active.mode]:editing?'Applying edits…':null;
  return { configured: ready, ...(defaultModelChoice?{defaultModelChoice}:{}), defaultReasoningEffort: defaultEditorReasoningEffort(), ...(await editorModelChoices(ctx, ownerId).then(choices => choices ? { modelSwitcher: true, allowedModels: [...choices] } : {})), ...(await claudeInApp(ctx, ownerId) ? {} : { claudeViaMcp: true }), running: project.aiRunning ?? false, externalAgent: project.aiAgentName && (project.aiRunning && project.aiRunId?.startsWith('mcp-') || (project.aiAgentActiveUntil ?? 0) > Date.now()) ? { name: project.aiAgentName, until: project.aiAgentActiveUntil ?? 0, running: !!project.aiRunning && !!project.aiRunId?.startsWith('mcp-') } : null, editing, workflowActive, error: project.aiError ?? null, reason: ready ? null : providerReason, activity, activityProgress: null, activityStartedAt: active ? task?.activityStartedAt ?? task?.attemptStartedAt ?? active.createdAt : null, activitySource: source?.ownerId === project.ownerId && source.projectId === project._id ? source.fileName : null, ...(budget&&budget.runId===project.aiRunId?{budgetUsed:budget.used}:{}), ...(budgetRow?.effort?{liveEffort:budgetRow.effort}:{}), ...(process.env.EDITOR_EFFORT_SWITCHER==='true'&&await canChooseEditorModel(ctx, ownerId)?{effortSwitcher:true}:{}) };
}});
const livePreviewValidator = v.object({runId:v.string(),baseRevision:v.number(),timeline:timelineValidator,label:v.string(),changedClipIds:v.array(v.string()),removedClips:v.array(clipValidator),at:v.number(),sequence:v.number(),updatedAt:v.number()});
/** `sceneCode: 'refs'` keeps scene code by hash for editors that load each code once. */
export const livePreview = query({args:{projectId:v.id('projects'),sceneCode:v.optional(v.literal('refs'))},returns:v.union(v.null(),livePreviewValidator),handler:async(ctx,{projectId,sceneCode})=>{
  const run=await projectRun(ctx,projectId,await requireOwner(ctx));
  if(!run.aiRunning)return null;
  const project=(await ctx.db.get(projectId))!;
  const preview=await ctx.db.query('aiTimelinePreviews').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  if(!preview||preview.ownerId!==project.ownerId||preview.runId!==run.aiRunId||preview.baseRevision!==(project.revision??0))return null;
  const {_id,_creationTime,ownerId,projectId:_,...result}=preview;
  if(sceneCode==='refs')return result;
  return {...result,timeline:await loadSceneCode(ctx,result.timeline),removedClips:(await loadSceneCode(ctx,{clips:result.removedClips})).clips};
}});
async function clearLivePreview(ctx:import('./_generated/server').MutationCtx,projectId:import('./_generated/dataModel').Id<'projects'>){
  const preview=await ctx.db.query('aiTimelinePreviews').withIndex('by_project',q=>q.eq('projectId',projectId)).unique();
  if(preview)await ctx.db.delete(preview._id);
}
export const send = mutation({ args: { projectId: v.id("projects"), prompt: v.string(), modelChoice: v.optional(legacyCompatibleModelChoiceValidator), reasoningEffort: v.optional(editorReasoningEffortValidator), speedMode: v.optional(editorSpeedModeValidator), attachedAssetIds:v.optional(v.array(v.id('assets'))), selectedClipId: v.optional(v.string()), selectedClipIds: v.optional(v.array(v.string())), playhead: v.optional(v.number()), timelineId: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx); await requireEditorAccess(ctx, ownerId); const project = await requireProject(ctx, args.projectId, ownerId);
  if ((args.modelChoice !== undefined || args.reasoningEffort !== undefined || args.speedMode !== undefined) && !await canChooseEditorModel(ctx, ownerId, args.modelChoice)) throw new ConvexError(args.modelChoice === 'opus' || args.modelChoice === 'sonnet' ? 'Opus and Sonnet run through MCP on your plan: connect Claude Code or Claude Desktop to Revline.' : 'This AI model is not available.');
  let pinnedModel;
  try { pinnedModel = withEditorSpeed(withEditorReasoning(enforceClaudeModelPolicy(resolveClaudeModel(args.modelChoice)), args.reasoningEffort), args.speedMode); assertEditorModelConfigured(pinnedModel); } catch (error) { throw new ConvexError((error as Error).message); }
  if(args.attachedAssetIds){
    if(args.attachedAssetIds.length>20||new Set(args.attachedAssetIds).size!==args.attachedAssetIds.length)throw new ConvexError('Attach up to 20 unique media files.');
    for(const id of args.attachedAssetIds){const asset=await ctx.db.get(id);if(!asset||asset.ownerId!==ownerId||asset.projectId!==project._id)throw new ConvexError('Attached media does not belong to this project.');}
  }
  const clipIds = new Set((await requestTimeline(ctx, project, args.timelineId)).clips.map(clip => clip.id));
  if(project.aiRunning&&!sentFromOtherTab(project,args.timelineId)){const preview=await ctx.db.query('aiTimelinePreviews').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();if(preview?.ownerId===ownerId&&preview.runId===project.aiRunId)for(const clip of preview.timeline.clips)clipIds.add(clip.id);}
  if (args.selectedClipId !== undefined && !clipIds.has(args.selectedClipId)) throw new ConvexError("Selected clip does not belong to this project");
  if (args.selectedClipIds) {
    if (args.selectedClipIds.length > 200) throw new ConvexError("Select at most 200 clips");
    if (new Set(args.selectedClipIds).size !== args.selectedClipIds.length) throw new ConvexError("Selected clips must be unique");
    if (args.selectedClipIds.some(id => !clipIds.has(id))) throw new ConvexError("Selected clips must belong to this project");
  }
  if (args.playhead !== undefined && (!Number.isFinite(args.playhead) || args.playhead < 0)) throw new ConvexError("Playhead must be a finite, nonnegative time");
  if (!configured()) throw new ConvexError(providerReason);
  const prompt = args.prompt.trim(); if (!prompt || prompt.length > 8000) throw new ConvexError("Write a prompt between 1 and 8000 characters");
  const queued=await ctx.db.query('assistantQueue').withIndex('by_project',q=>q.eq('projectId',project._id)).first();
  if(project.aiRunning||queued){
    const pending=await ctx.db.query('assistantQueue').withIndex('by_project',q=>q.eq('projectId',project._id)).take(10);
    if(pending.length>=10)throw new ConvexError('You can queue up to 10 messages. Remove one before adding more.');
    await consumeAssistantRequest(ctx,ownerId);
    const {prompt:_,projectId:__,modelChoice:___,reasoningEffort:____,speedMode:_____,...context}=args;
    await ctx.db.insert('assistantQueue',{projectId:project._id,ownerId,prompt,pinnedModel,...context,createdAt:Date.now()});
    if(!project.aiRunning&&!project.aiQueuePaused)await ctx.scheduler.runAfter(0,internal.assistant.drainQueue,{projectId:project._id,ownerId});
    return null;
  }
  await consumeAssistantRequest(ctx,ownerId);
  return beginRequest(ctx,project,prompt,pinnedModel,args);
}});
type QueuedContext=Pick<Doc<'assistantQueue'>,'attachedAssetIds'|'selectedClipId'|'selectedClipIds'|'playhead'|'timelineId'>;
const sentFromOtherTab=(project:Doc<'projects'>,timelineId?:string)=>!!timelineId&&timelineId!==activeTabOf(project);
/** The timeline of the tab a request was sent from: the open tab, or another one the user was looking at. */
async function requestTimeline(ctx:MutationCtx,project:Doc<'projects'>,timelineId?:string){
  if(!sentFromOtherTab(project,timelineId))return currentTimeline(project);
  if(!tabsOf(project).some(tab=>tab.id===timelineId))throw new ConvexError('That timeline no longer exists. Open a timeline tab and send again.');
  return await storedTabTimeline(ctx,project,timelineId!)??currentTimeline(project);
}
async function beginRequest(ctx:MutationCtx,sent:Doc<'projects'>,prompt:string,pinnedModel:ClaudeModelSelection,request:QueuedContext):Promise<null>{
  // The turn works on the tab the user sent from. It opens here, in the transaction that takes the run lock,
  // and no other tab can open until the turn ends, whatever another agent or editor does meanwhile.
  const switching=sentFromOtherTab(sent,request.timelineId)&&tabsOf(sent).some(tab=>tab.id===request.timelineId);
  if(switching)await openTabFor(ctx,sent.ownerId,{projectId:sent._id,timelineId:request.timelineId!});
  const project=switching?(await readProject(ctx,sent._id))!:sent;
  const ownerId=project.ownerId;
  const threadId = project.threadId ?? await createThread(ctx, components.agent, { userId: ownerId, title: project.title });
  const { messageId } = await saveMessage(ctx, components.agent, { threadId, userId: ownerId, prompt });
  const recovery = project.aiRecovery ?? (project.aiError ? assistantRecovery(project, 'failed', project.aiError) : undefined);
  const runId = `${Date.now()}-${Math.random()}`;
  await clearLivePreview(ctx,project._id);
  await writeProject(ctx,project._id, { threadId, aiQueuePaused:false, aiRunning: true, aiEditing: false, aiError: undefined, aiRunId: runId, aiAnalysisUsage:{runId,enqueued:0}, aiUndoRecorded: false, aiCheckpointRevision: undefined, aiRequest:{prompt,messageId,startedRevision:project.revision??0}, aiRecovery:recovery });
  const turn = { projectId: project._id, ownerId, runId, threadId, promptMessageId: messageId, pinnedModel,...(request.attachedAssetIds?{attachedAssetIds:request.attachedAssetIds}:{}), ...(recovery?{recovery}:{}), ...(request.selectedClipId ? { selectedClipId: request.selectedClipId } : {}), ...(request.selectedClipIds ? { selectedClipIds: request.selectedClipIds } : {}), ...(request.playhead !== undefined ? { playhead: request.playhead } : {}) };
  // Long turns run on the Cloudflare agent runner; without one, inside Convex's ten-minute action limit.
  if (agentRunnerConfigured()) { await startRunnerTurn(ctx, turn); return null; }
  const workflowId=await aiWorkflow.start(ctx, internal.assistantWorkflow.runTurn, turn,{startAsync:true,onComplete:internal.assistantWorkflow.settle,context:{projectId:project._id,ownerId,runId}});
  await writeProject(ctx,project._id,{aiWorkflowId:workflowId}); return null;
}

/** The agent stores large tool images in file storage and leaves a URL object behind, which a query cannot
 * return; send its address as text instead. */
function plainValues<T>(value: T): T {
  if (value instanceof URL) return value.href as T;
  if (Array.isArray(value)) return value.map(plainValues) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValues(item)])) as T;
  return value;
}

export const messages = query({
  args: { projectId: v.id("projects"), threadId: v.string(), paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs },
  // AI SDK UI parts are polymorphic; agent validates and converts their stored representation.
  returns: v.object({ ...vPaginationResult(v.any()).fields, streams: v.union(v.object({ kind: v.literal("list"), messages: v.array(vStreamMessage) }), v.object({ kind: v.literal("deltas"), deltas: v.array(vStreamDelta) })) }),
  handler: async (ctx, args) => {
    const project = await projectIdentity(ctx,args.projectId,await requireOwner(ctx));
    if (args.paginationOpts.numItems < 0 || args.paginationOpts.numItems > 100 || (args.paginationOpts.numItems === 0 && !args.streamArgs)) throw new ConvexError("Message pages must contain between 1 and 100 messages");
    if (project.threadId && args.threadId !== project.threadId) throw new ConvexError("Conversation not found");
    if (!project.threadId) return { page: [], isDone: true, continueCursor: "", streams: args.streamArgs?.kind === "deltas" ? { kind: "deltas" as const, deltas: [] } : { kind: "list" as const, messages: [] } };
    const page = args.paginationOpts.numItems === 0 ? { page: [], isDone: true, continueCursor: "" } : await listUIMessages(ctx, components.agent, { threadId: project.threadId, paginationOpts: args.paginationOpts });
    const streams = await syncStreams(ctx, components.agent, { threadId: project.threadId, streamArgs: args.streamArgs });
    return { ...page, page: plainValues(page.page), streams: streams ?? { kind: "list" as const, messages: [] } };
  },
});
const runArgs = { projectId: v.id("projects"), ownerId: v.string(), runId: v.string() };
export const stop = mutation({ args: { projectId: v.id('projects') }, returns: v.null(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx));
  if (!project.aiRunning) return null;
  if (project.threadId) {
    const streams = await listStreams(ctx, components.agent, { threadId: project.threadId, includeStatuses: ['streaming'] });
    for (const stream of streams) await abortStream(ctx, components.agent, { streamId: stream.streamId, reason: 'Stopped by the user' });
  }
  if (project.aiRunId) {
    const requests = await ctx.db.query('analysisRequests').withIndex('by_projectId_runId', q => q.eq('projectId', project._id).eq('aiRunId', project.aiRunId!)).take(16);
    for (const request of requests) { if (request.taskId) await cancelMediaTask(ctx, request.taskId); await ctx.db.delete(request._id); }
  }
  const reviews=await ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',project._id)).order('desc').take(2);
  for(const review of reviews)if(review.runId===project.aiRunId&&review.status==='queued'){if(review.taskId)await cancelMediaTask(ctx,review.taskId);await ctx.db.patch(review._id,{status:'failed',error:'Stopped by the user.'});}
  await clearLivePreview(ctx,project._id);
  // Already-saved edits remain undoable; invalidating the run blocks every later checkpoint.
  if(project.aiWorkflowId)await cancelTurn(ctx,project.aiWorkflowId as WorkflowId);
  if(project.aiRunId)await stopRunnerTurn(ctx,project.aiRunId);
  await writeProject(ctx,project._id, { aiRunning: false, aiEditing: false, aiRunId: undefined, aiWorkflowId:undefined, aiQueuePaused:true, aiError: undefined, aiRecovery:assistantRecovery(project,'stopped','Stopped by the user. Saved edits remain.'),aiRequest:undefined });
  return null;
}});
/** Begin the timeline lock only when a mutating tool has a real change to make. */
/** The effort the run is thinking at right now, for the development effort switcher. */
export const recordEffort = internalMutation({ args: { ...runArgs, effort: editorReasoningEffortValidator }, returns: v.null(), handler: async (ctx, args) => {
  const project = await projectRun(ctx,args.projectId,args.ownerId);
  if (!project.aiRunning || project.aiRunId !== args.runId) return null;
  const row = await ctx.db.query('aiBudgets').withIndex('by_project', q => q.eq('projectId', args.projectId)).unique();
  if (row) await ctx.db.patch(row._id, { runId: args.runId, ...(row.runId === args.runId ? {} : { used: 0 }), effort: args.effort, updatedAt: Date.now() });
  else await ctx.db.insert('aiBudgets', { projectId: args.projectId, runId: args.runId, used: 0, effort: args.effort, updatedAt: Date.now() });
  return null;
}});
export const recordBudget = internalMutation({ args: { ...runArgs, used: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const project = await projectRun(ctx,args.projectId,args.ownerId);
  if (!project.aiRunning || project.aiRunId !== args.runId || !Number.isFinite(args.used)) return null;
  const used = Math.min(1, Math.max(0, args.used)), row = await ctx.db.query('aiBudgets').withIndex('by_project', q => q.eq('projectId', args.projectId)).unique();
  if (row) await ctx.db.patch(row._id, { runId: args.runId, used, updatedAt: Date.now() });
  else await ctx.db.insert('aiBudgets', { projectId: args.projectId, runId: args.runId, used, updatedAt: Date.now() });
  return null;
}});
export const beginEditing = internalMutation({ args: runArgs, returns: v.null(), handler: async (ctx, args) => {
  const project = await projectRun(ctx,args.projectId,args.ownerId);
  if (!project.aiRunning || project.aiRunId !== args.runId) throw new ConvexError('AI run is no longer active');
  if (!project.aiEditing) await writeProject(ctx,project._id,{aiEditing:true});
  return null;
}});
export const isRunActive = internalQuery({ args: runArgs, returns: v.boolean(), handler: async (ctx, args) => {
  const project = await projectRun(ctx,args.projectId,args.ownerId).catch(()=>null);
  return !!project && project.ownerId === args.ownerId && project.aiRunId === args.runId && project.aiRunning === true;
}});
export const getRun = internalQuery({args:runArgs,returns:v.object({project:projectDocument,assets:v.array(assetDocument)}),handler:async(ctx,args)=>{
  const run=await projectRun(ctx,args.projectId,args.ownerId);if(!args.runId.startsWith(READ_ONLY_RUN_PREFIX)&&(run.aiRunId!==args.runId||!run.aiRunning))throw new ConvexError('AI run is no longer active');
  const project=(await ctx.db.get(args.projectId))!;
  const assets=await ctx.db.query('assets').withIndex('by_ownerId_projectId',q=>q.eq('ownerId',args.ownerId).eq('projectId',args.projectId)).take(200);
  // A read of a named tab (MCP timelineId) serves that tab's stored timeline without opening it.
  const tab=args.runId.startsWith(READ_ONLY_RUN_PREFIX)?readRunTab(args.runId):undefined;
  if(tab&&tab!==activeTabOf(project)){const stored=await storedTabTimeline(ctx,project,tab);if(!stored)throw new ConvexError('That timeline no longer exists.');return {project:{...project,...run,activeTimelineId:tab,timeline:await loadSceneCode(ctx,stored)},assets};}
  return {project:{...project,...run,timeline:await loadSceneCode(ctx,currentTimeline(project))},assets};
}});
export const getRunTimeline=internalQuery({args:runArgs,returns:v.object({timeline:timelineValidator,revision:v.number()}),handler:async(ctx,args)=>{
  const run=await projectRun(ctx,args.projectId,args.ownerId);if(run.aiRunId!==args.runId||!run.aiRunning)throw new ConvexError('AI run is no longer active');
  const project=(await ctx.db.get(args.projectId))!;return {timeline:await loadSceneCode(ctx,currentTimeline(project)),revision:project.revision??0};
}});
export const getRunAsset=internalQuery({args:{...runArgs,assetId:v.string()},returns:assetDocument,handler:async(ctx,args)=>{
  const run=await projectRun(ctx,args.projectId,args.ownerId);if(run.aiRunId!==args.runId||!run.aiRunning)throw new ConvexError('AI run is no longer active');
  const id=ctx.db.normalizeId('assets',args.assetId),asset=id?await ctx.db.get(id):null;
  if(!asset||asset.ownerId!==args.ownerId||asset.projectId!==args.projectId)throw new ConvexError('Media not found');return hydrateAsset(ctx,asset);
}});
/** The assistant's addSoundEffect attaches the shared catalog sound to this project before placing it. */
export const attachRunStockAudio=internalMutation({args:{...runArgs,catalogId:v.string()},returns:assetDocument,handler:async(ctx,args)=>{
  const run=await projectRun(ctx,args.projectId,args.ownerId);if(run.aiRunId!==args.runId||!run.aiRunning)throw new ConvexError('AI run is no longer active');
  return hydrateAsset(ctx,await attachStockAudio(ctx,args.ownerId,args.projectId,args.catalogId));
}});
/** Register a sound the assistant rendered and uploaded; storage counts like an upload, with no analysis tasks. */
export const saveGeneratedSound=internalMutation({args:{...runArgs,r2Key:v.string(),fileName:v.string(),size:v.number(),duration:v.number(),waveform:waveformValidator,recipe:v.optional(v.string()),beats:v.optional(beatsValidator),contentType:v.optional(v.union(v.literal('audio/wav'),v.literal('audio/mpeg')))},returns:assetDocument,handler:async(ctx,args)=>{
  const run=await projectRun(ctx,args.projectId,args.ownerId);if(run.aiRunId!==args.runId||!run.aiRunning)throw new ConvexError('AI run is no longer active');
  if(!args.r2Key.startsWith(`media/${args.ownerId}/${args.projectId}/`))throw new ConvexError('Generated sound key is outside this project');
  const count=await ctx.db.query('assets').withIndex('by_ownerId_projectId',q=>q.eq('ownerId',args.ownerId).eq('projectId',args.projectId)).take(200);
  if(count.length>=200)throw new ConvexError('A project supports up to 200 media files');
  validateWaveform(args.waveform);
  const id=await ctx.db.insert('assets',{ownerId:args.ownerId,projectId:args.projectId,kind:'audio',fileName:args.fileName,r2Key:args.r2Key,contentType:args.contentType??'audio/wav',size:args.size,duration:args.duration,waveform:args.waveform,...(args.recipe?{soundRecipe:args.recipe}:{}),createdAt:Date.now()});
  // A music bed knows its beats exactly: they are saved as its beat map, like a measured one.
  const asset=args.beats?await storeAnalysis(ctx,(await ctx.db.get(id))!,{beats:args.beats}):(await ctx.db.get(id))!;
  await recordAssetStorage(ctx,asset);
  return hydrateAsset(ctx,asset);
}});
export const apply = internalMutation({ args: { ...runArgs, expectedRevision: v.number(), timeline: timelineValidator,publication:v.optional(v.object({threadId:v.string(),promptMessageId:v.string()})) }, returns: v.number(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId, false);
  if (project.aiRunId !== args.runId || !project.aiRunning) throw new ConvexError("AI run is no longer active");
  if(args.publication&&project.threadId!==args.publication.threadId)throw new ConvexError('Publication conversation does not match this project.');
  // A stale revision is refused below; compare overlaps only against the base this draft was built on.
  if((project.revision??0)===args.expectedRevision)rejectNewLayerOverlaps(currentTimeline(project),args.timeline);
  const receipt=async(revision:number)=>{
    const previous=await ctx.db.query('aiTimelinePreviews').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();
    // The preview stores scene code by hash like the project; compare and describe in that form.
    const timeline=await storeSceneCode(ctx,normalizeTimeline(args.timeline),storedSceneCode(previous?.timeline));
    const unchanged=previous?.runId===args.runId&&equalTimelineValue(previous.timeline,timeline);
    const change=unchanged?{label:previous.label,changedClipIds:previous.changedClipIds,removedClips:previous.removedClips,at:previous.at}:describeLiveEdit(previous?.runId===args.runId?previous.timeline:(await withoutSceneCode(currentTimeline(project))).timeline,timeline);
    const values={projectId:project._id,ownerId:args.ownerId,runId:args.runId,baseRevision:revision,timeline,...change,sequence:(previous?.runId===args.runId?previous.sequence:0)+(unchanged?0:1),updatedAt:Date.now()};
    if(previous)await ctx.db.replace(previous._id,values);else await ctx.db.insert('aiTimelinePreviews',values);
    if(args.publication)await savePublicationReceipt(ctx,args.ownerId,{version:1,kind:'timeline-publication',status:'saved',...args.publication,runId:args.runId,stagedRevision:args.expectedRevision,revision});
    return revision;
  };
  if (project.aiUndoRecorded && project.aiCheckpointRevision === args.expectedRevision) {
    if ((project.revision ?? 0) !== args.expectedRevision) throw new ConvexError(TIMELINE_CONFLICT);
    const timeline = await validateTimeline(ctx, project, args.timeline);
    const revision = args.expectedRevision + 1;
    await writeProject(ctx,project._id, { timeline, aspectRatio: timeline.aspectRatio, revision, aiCheckpointRevision: revision, updatedAt: Date.now() }); return receipt(revision);
  }
  const revision = await commitTimeline(ctx, project, args.timeline, args.expectedRevision);
  await writeProject(ctx,project._id, { aiUndoRecorded: true, aiCheckpointRevision: revision }); return receipt(revision);
}});
/** Undo only stored history before this model turn publishes its own checkpoints. */
export const undoLatestEdit=internalMutation({args:{...runArgs,expectedRevision:v.number()},returns:v.object({undone:v.boolean(),revision:v.number(),timeline:timelineValidator}),handler:async(ctx,args)=>{
  const project=await requireProject(ctx,args.projectId,args.ownerId,true);
  if(project.aiRunId!==args.runId||!project.aiRunning)throw new ConvexError('AI run is no longer active');
  if(project.aiUndoRecorded)throw new ConvexError('Undo the latest saved edit before making changes in this turn.');
  if((project.revision??0)!==args.expectedRevision)throw new ConvexError('The timeline changed elsewhere. Inspect it before undoing.');
  const history=(project.history??[]).map(normalizeTimeline),previous=history.pop();
  if(!previous)return {undone:false,revision:project.revision??0,timeline:currentTimeline(project)};
  const timeline=await validateTimeline(ctx,project,previous),revision=args.expectedRevision+1;
  await writeProject(ctx,project._id,{timeline,aspectRatio:timeline.aspectRatio,history,revision,aiEditing:true,aiCheckpointRevision:undefined,updatedAt:Date.now()});
  return {undone:true,revision,timeline};
}});
// Destructive turns validate each private draft without exposing intermediate deletions.
// The final apply repeats these checks atomically before publishing the replacement.
export const validateDraft = internalQuery({ args: { ...runArgs, expectedRevision: v.number(), timeline: timelineValidator }, returns: v.null(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId);
  if (project.aiRunId !== args.runId || !project.aiRunning) throw new ConvexError('AI run is no longer active');
  if ((project.revision ?? 0) !== args.expectedRevision) throw new ConvexError('The timeline changed elsewhere. Your replacement was not saved.');
  await validateTimeline(ctx, project, args.timeline);
  rejectNewLayerOverlaps(currentTimeline(project), args.timeline);
  return null;
}});
/** A read-only client projection. This never publishes a draft or adds undo history. */
export const previewDraft = internalMutation({args:{...runArgs,expectedRevision:v.number(),timeline:timelineValidator},returns:v.null(),handler:async(ctx,args)=>{
  const project=await requireProject(ctx,args.projectId,args.ownerId);
  if(!project.aiRunning||project.aiRunId!==args.runId)throw new ConvexError('AI run is no longer active');
  if((project.revision??0)!==args.expectedRevision)throw new ConvexError('The timeline changed elsewhere. Your replacement was not saved.');
  const timeline=await validateTimeline(ctx,project,args.timeline);
  rejectNewLayerOverlaps(currentTimeline(project),timeline);
  const previous=await ctx.db.query('aiTimelinePreviews').withIndex('by_project',q=>q.eq('projectId',project._id)).unique();
  const current=previous?.runId===args.runId&&previous.baseRevision===args.expectedRevision?previous:null;
  const stored=await storeSceneCode(ctx,timeline,storedSceneCode(previous?.timeline));
  if(current&&equalTimelineValue(current.timeline,stored))return null;
  const values={projectId:project._id,ownerId:args.ownerId,runId:args.runId,baseRevision:args.expectedRevision,timeline:stored,...describeLiveEdit(current?.timeline??(await withoutSceneCode(currentTimeline(project))).timeline,stored),sequence:(current?.sequence??0)+1,updatedAt:Date.now()};
  if(previous)await ctx.db.replace(previous._id,values);else await ctx.db.insert('aiTimelinePreviews',values);
  return null;
}});
export const finish = internalMutation({ args: { ...runArgs, error: v.optional(v.string()), savedEdits:v.optional(v.number()),publication:v.optional(v.object({threadId:v.string(),promptMessageId:v.string(),stagedRevision:v.number(),status:v.union(v.literal('failed'),v.literal('aborted'))})) }, returns: v.null(), handler: async (ctx, args) => {
  const project = await readProject(ctx,args.projectId);
  // A stopped action may finish after a new run starts. Its receipt belongs to
  // the original prompt; it must never stop or overwrite the newer run.
  if(args.publication&&project?.ownerId===args.ownerId&&project.threadId===args.publication.threadId)await savePublicationReceipt(ctx,args.ownerId,{version:1,kind:'timeline-publication',runId:args.runId,...args.publication});
  if (project?.ownerId === args.ownerId && project.aiRunId === args.runId) {
    await clearLivePreview(ctx,project._id);
    const requests = await ctx.db.query("analysisRequests").withIndex("by_projectId_runId", q => q.eq("projectId", args.projectId).eq("aiRunId", args.runId)).take(16);
    for (const request of requests) await detachAnalysisRequest(ctx,request);
    // A recovery may finish with verification alone. Use persisted review
    // receipts, not the assistant's prose, to retire the unfinished status.
    const reviews=!args.error&&project.aiRecovery&&!project.aiUndoRecorded?(await ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',project._id)).order('desc').take(8)).filter(review=>review.ownerId===project.ownerId&&review.runId===args.runId&&review.revision===(project.revision??0)&&review.status==='completed'):[];
    const recoveryChecked=reviews.length>0&&reviews.every(review=>review.result?.revision===(project.revision??0)&&review.result.observations.length>0&&review.result.observations.every(observation=>observation.verdict==='pass')&&review.result.checks.every(check=>check.timingPass&&check.pixelPass!==false&&check.returnPass!==false&&check.textSafe!==false));
    await writeProject(ctx,project._id, { aiRunning: false, aiEditing: false, aiReturnTimelineId: undefined, aiError: args.error?.slice(0, 1000), aiRecovery:args.error?assistantRecovery(project,'failed',args.error,args.savedEdits):project.aiUndoRecorded||recoveryChecked?undefined:project.aiRecovery,aiRequest:undefined });
    // An MCP call that borrowed another tab hands the user's tab back.
    const returnTo=project.aiReturnTimelineId;
    if(returnTo&&returnTo!==activeTabOf(project)&&tabsOf(project).some(tab=>tab.id===returnTo))await openTabFor(ctx,project.ownerId,{projectId:project._id,timelineId:returnTo});
    if(!project.aiQueuePaused)await ctx.scheduler.runAfter(0,internal.assistant.drainQueue,{projectId:project._id,ownerId:project.ownerId});
  }
  return null;
}});

export const requestAnalysis = internalMutation({ args: { ...runArgs, assetId: v.string(), mode: analysisMode, frameRequest: v.optional(frameRequestValidator), videoRequest: v.optional(videoRequestValidator) }, returns: v.id("analysisRequests"), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, args.ownerId);
  if (!project.aiRunning || project.aiRunId !== args.runId) throw new ConvexError("AI run is no longer active");
  const assetId = ctx.db.normalizeId("assets", args.assetId); const asset = assetId ? await ctx.db.get(assetId) : null;
  if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId || asset.kind === "image" || ((args.mode === "understand" || args.mode === 'reference' || args.mode === "shots" || args.mode === "track" || args.mode === 'frames' || args.mode === 'video') && asset.kind !== "video")) throw new ConvexError("Choose suitable media from this project");
  if (args.mode === 'frames') {
    if (!args.frameRequest || !asset.duration) throw new ConvexError('Choose a video window and a focused visual question.');
    try { validateFrameInspectionInput(args.frameRequest, asset.duration); } catch (error) { throw new ConvexError((error as Error).message); }
  } else if (args.frameRequest) throw new ConvexError('Frame questions require a frame inspection.');
  if (args.mode === 'video') {
    if (!args.videoRequest || !asset.duration) throw new ConvexError('Choose a video source window and a question.');
    try { validateVideoInspectionInput(args.videoRequest, asset.duration); } catch (error) { throw new ConvexError((error as Error).message); }
  } else if (args.videoRequest) throw new ConvexError('Video questions require a native video inspection.');
  const requests = await ctx.db.query("analysisRequests").withIndex("by_projectId_runId", q => q.eq("projectId", project._id).eq("aiRunId", args.runId)).take(16);
  if(!project.aiEditing)await writeProject(ctx,project._id,{aiEditing:true});
  const requested = args.mode === 'video' ? args.videoRequest : args.mode === 'frames' ? args.frameRequest : undefined;
  if(requested){
    const repeated=requests.find(request=>{
      const inspection = args.mode === 'video' ? request.videoRequest : request.frameRequest;
      return request.assetId===asset._id&&request.mode===args.mode&&request.status!=='failed'&&inspection?.question===requested.question&&inspection.start===requested.start&&inspection.end===requested.end;
    });
    if(repeated)return repeated._id;
  }
  const requestId = await ctx.db.insert("analysisRequests", { ownerId: args.ownerId, projectId: project._id, assetId: asset._id, aiRunId: args.runId, mode: args.mode, ...(args.frameRequest ? { frameRequest: args.frameRequest } : {}), ...(args.videoRequest ? { videoRequest: args.videoRequest } : {}), status: "pending", createdAt: Date.now(), expiresAt: Date.now() + (args.mode === 'reference' ? 480_000 : 240_000) });
  const taskId = await enqueueMediaTask(ctx, { ownerId: args.ownerId, projectId: project._id, assetId: asset._id, kind: args.mode, analysisRequestId: requestId, ...(args.frameRequest ? { frameRequest: args.frameRequest } : {}), ...(args.videoRequest ? { videoRequest: args.videoRequest } : {}) },async()=>{
    // Rows are deleted when callers finish, but the original run's capacity
    // must survive that cleanup and every durable continuation segment.
    const enqueued=project.aiAnalysisUsage?.runId===args.runId?project.aiAnalysisUsage.enqueued:requests.length;
    if(enqueued>=15)throw new ConvexError('Too many analysis requests in one AI run');
    // An accepted run may analyse beside upload preparation, up to the ceiling.
    await requireMediaTaskCapacity(ctx,args.ownerId,1,{ceiling:2});
    await writeProject(ctx,project._id,{aiAnalysisUsage:{runId:args.runId,enqueued:enqueued+1}});
  });
  await ctx.db.patch(requestId, { taskId });
  return requestId;
}});
export const analysisRequest = internalQuery({ args: { ...runArgs, requestId: v.id("analysisRequests") }, returns: analysisRequestDocument, handler: async (ctx, args) => {
  const project = await projectRun(ctx,args.projectId,args.ownerId); const request = await ctx.db.get(args.requestId);
  if (!project.aiRunning || project.aiRunId !== args.runId || !request || request.ownerId !== args.ownerId || request.projectId !== project._id || request.aiRunId !== args.runId) throw new ConvexError("AI analysis request is no longer active");
  return request;
}});
export const clearAnalysis = internalMutation({ args: { ...runArgs, requestId: v.id("analysisRequests") }, returns: v.null(), handler: async (ctx, args) => {
  const request = await ctx.db.get(args.requestId);
  if (request?.ownerId === args.ownerId && request.projectId === args.projectId && request.aiRunId === args.runId) {
    const project=await projectRun(ctx,args.projectId,args.ownerId);
    if(project.aiRunning&&project.aiRunId===args.runId&&!project.aiEditing)await writeProject(ctx,args.projectId,{aiEditing:true});
    await detachAnalysisRequest(ctx,request);
  }
  return null;
}});

/** The current saved user message, never an older conversational timestamp. */
export const currentPrompt = internalQuery({
  args: { ...runArgs, threadId: v.string(), promptMessageId: v.string() }, returns: v.string(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId);
    if (!project.aiRunning || project.aiRunId !== args.runId || project.threadId !== args.threadId) throw new ConvexError('AI run is no longer active');
    const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [args.promptMessageId] });
    if (!prompt || prompt.threadId !== args.threadId || prompt.message?.role !== 'user') throw new ConvexError('The current editing prompt is unavailable');
    const content = prompt.message.content;
    return typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join('\n');
  },
});


export const queued=query({args:{projectId:v.id('projects')},returns:v.object({paused:v.boolean(),messages:v.array(v.object({id:v.id('assistantQueue'),prompt:v.string(),error:v.optional(v.string())}))}),handler:async(ctx,{projectId})=>{
  const project=await projectRun(ctx,projectId,await requireOwner(ctx));
  const rows=await ctx.db.query('assistantQueue').withIndex('by_project',q=>q.eq('projectId',projectId)).take(10);
  return {paused:!!project.aiQueuePaused,messages:rows.map(row=>({id:row._id,prompt:row.prompt,...(row.error?{error:row.error}:{})}))};
}});
export const removeQueued=mutation({args:{projectId:v.id('projects'),id:v.id('assistantQueue')},returns:v.null(),handler:async(ctx,args)=>{
  const ownerId=await requireOwner(ctx);await requireProject(ctx,args.projectId,ownerId);
  const row=await ctx.db.get(args.id);
  if(!row)return null;
  if(row.ownerId!==ownerId||row.projectId!==args.projectId)throw new ConvexError('Queued message not found.');
  await ctx.db.delete(row._id);return null;
}});
export const resumeQueue=mutation({args:{projectId:v.id('projects')},returns:v.null(),handler:async(ctx,{projectId})=>{
  const ownerId=await requireOwner(ctx);await requireProject(ctx,projectId,ownerId);await requireEditorAccess(ctx,ownerId);
  await writeProject(ctx,projectId,{aiQueuePaused:false});
  await ctx.scheduler.runAfter(0,internal.assistant.drainQueue,{projectId,ownerId});return null;
}});
export const drainQueue=internalMutation({args:{projectId:v.id('projects'),ownerId:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const raw=await ctx.db.get(args.projectId);
  if(!raw||raw.deleting||raw.ownerId!==args.ownerId)return null;
  const project=(await readProject(ctx,args.projectId))!;
  if(project.aiRunning||project.aiQueuePaused)return null;
  const row=await ctx.db.query('assistantQueue').withIndex('by_project',q=>q.eq('projectId',args.projectId)).first();
  if(!row)return null;
  try{
    await ctx.runMutation(internal.assistant.startQueued,{...args,id:row._id});
  }catch{
    await ctx.db.patch(row._id,{error:'This queued request could not start. Check your access and attached footage, then resume the queue.'});
    await writeProject(ctx,project._id,{aiQueuePaused:true});
  }
  return null;
}});


/** Nested mutation makes starting and removing the head one atomic operation. */
export const startQueued=internalMutation({args:{projectId:v.id('projects'),ownerId:v.string(),id:v.id('assistantQueue')},returns:v.null(),handler:async(ctx,args)=>{
  const project=await requireProject(ctx,args.projectId,args.ownerId);
  if(project.aiRunning||project.aiQueuePaused)return null;
  const row=await ctx.db.query('assistantQueue').withIndex('by_project',q=>q.eq('projectId',args.projectId)).first();
  if(!row||row._id!==args.id||row.ownerId!==args.ownerId)return null;
    await requireEditorAccess(ctx,args.ownerId);
    // A queued choice the plan no longer allows (Opus in-app on Pro) falls back to the default.
    const queued=validatePinnedClaudeModel(row.pinnedModel);
    const chosen=queued.modelChoice!==undefined||queued.reasoningEffort!==undefined||queued.speedMode!==undefined;
    const pinnedModel=chosen&&!await canChooseEditorModel(ctx,args.ownerId,queued.modelChoice)?enforceClaudeModelPolicy(resolveClaudeModel()):queued;assertEditorModelConfigured(pinnedModel);
    enforceClaudeModelPolicy(pinnedModel);
    for(const id of row.attachedAssetIds??[]){const asset=await ctx.db.get(id);if(!asset||asset.projectId!==project._id||asset.ownerId!==args.ownerId)throw new ConvexError('Attached footage is no longer available. Remove this queued message and send an updated request.');}
    const ids=new Set((await requestTimeline(ctx,project,row.timelineId).catch(()=>currentTimeline(project))).clips.map(clip=>clip.id));
    const selectedClipIds=row.selectedClipIds?.filter(id=>ids.has(id));
    await beginRequest(ctx,project,row.prompt,pinnedModel,{...row,selectedClipId:row.selectedClipId&&ids.has(row.selectedClipId)?row.selectedClipId:undefined,selectedClipIds});
    await ctx.db.delete(row._id);
  return null;
}});
