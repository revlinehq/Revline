"use node";
import { retryAbortedTransaction } from './lib/retry_aborted_transaction';
import { safely } from './lib/safely';
import { snapshotFrames } from '../lib/ai/snapshot-frames';
import { argumentKey } from '../lib/ai/step-timing';
import { MAX_SHEET_FRAMES, evenly } from '../lib/ai/frame-sampling';
import { LANES, laneToolAllowed, laneToolError, capabilityTools, toolCapabilities } from '../lib/ai/lanes';
import { checkInstructions, requestChecks, taskCheckLevel } from '../lib/ai/lanes/checks';
import { LANE_IDS } from '../lib/ai/lanes/types';
import { SKILL_TOOLS } from '../lib/ai/lanes/base-tools';
import { initialLaneSelection, MCP_SELECTION_TOOLS, reelRequested } from '../lib/ai/lanes/selection';
import { parseEditorCommand } from '../lib/ai/slash-commands';
import type { LaneTask } from './lib/run_types';
import { v } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { createEditorToolkit, EXPORT_SETTINGS_INPUT } from './lib/editorToolkit';
import { toolBehavior } from '../lib/ai/tool-definitions';
import { mediaDownloadUrl } from './lib/media_storage';
import { newMcpTaskId, readRunId } from './lib/run_ids';
import { CALL_LIMIT_MS } from './lib/mcp_limits';
import { completeUpload, openUpload, signPartUrl } from './r2';
import { startLocalUpload, mediaKind } from './mcpUploads';

// The editor's own AI tools, exposed over MCP. planEffects/previewRender keep
// review plans for the length of one in-app turn, which an MCP call does not have.
// Choice cards only exist in the editor's chat; MCP clients ask in their own way.
const projectIdField = z.string().min(1).describe('Revline project ID from listProjects or getProject.');
// These shared tools resolve their target from an owner-checked upload/job ID,
// not a lane task. Their IDs must never be interpreted as lane task IDs.
const RESOURCE_TOOLS = new Set(['finishUpload', 'getMediaTask', 'getExport', 'cancelExport']);
/** The agent's own reports: callable with or without a task, in any lane. */
const REPORT_TOOLS = new Set(['reportIssue', 'reportLimitation']);

const PROJECT_TOOLS = {
  startTask:{description:'Start one task in a timeline. Keep the returned taskId for subsequent calls. A style is optional; shared edits work immediately after startTask. /clip and a user-selected lane take precedence. Call finish before claiming an edit complete.',inputSchema:z.object({projectId:projectIdField,timelineId:z.string().min(1).optional(),request:z.string().trim().min(1).max(8000),lane:z.enum(LANE_IDS).optional(),reason:z.string().trim().min(5).max(300).optional(),taskType:z.enum(['edit','question']).optional()}).refine(value=>!value.lane||!!value.reason,{message:'An explicit lane needs a reason.'})},
  setLane:{description:'Optionally choose the primary workflow when the deliverable changes. Use loadCapability for supporting work. Pass taskId from startTask, or projectId and timelineId. Switch when the kind of work changes. Preserves failed finish attempts. Refresh tools/list after a style change.',inputSchema:z.object({projectId:projectIdField.optional(),timelineId:z.string().min(1).optional(),taskId:z.string().min(1).optional(),lane:z.enum(LANE_IDS),reason:z.string().trim().min(5).max(300),taskType:z.enum(['edit','question'])}).refine(value=>!!value.taskId||!!value.projectId&&!!value.timelineId,{message:'Pass taskId from startTask, or projectId and timelineId.'})},
  listProjects: { description: 'List your Revline video projects, newest first, with their IDs and editor links. Start here to find the project to edit.', inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }) },
  getProject: { description: 'Overview of one project: its timeline tabs (which one is open), aspect ratio, duration, revision, editor link and its media (asset IDs, kinds, durations, which analyses are saved). Then call inspectTimeline with the same projectId to read clips before editing.', inputSchema: z.object({ projectId: projectIdField }) },
  createProject: { description: 'Create an empty project. Add footage with uploadMedia (a local file), importVideoLink, or copyMedia (media from another of your projects).', inputSchema: z.object({ title: z.string().min(1).max(120), aspectRatio: z.enum(['landscape', 'vertical', 'square']) }) },
  renameProject: { description: 'Rename a project.', inputSchema: z.object({ projectId: projectIdField, title: z.string().min(1).max(120) }) },
  duplicateProject: { description: 'Copy a whole project (every timeline tab and its media) into a new project, e.g. to try another version without touching the original. Returns the new projectId.', inputSchema: z.object({ projectId: projectIdField, title: z.string().min(1).max(120).optional() }) },
  deleteProject: { description: 'Permanently delete a project with its timelines, chat and exports. Only when the user explicitly asks to delete it; confirm must be true. Not possible during an edit or render.', inputSchema: z.object({ projectId: projectIdField, confirm: z.literal(true) }) },
  importVideoLink: { description: 'Import a video from a link into a project, or into a new project when projectId is omitted. Supported: YouTube, Twitch (a VOD at twitch.tv/videos/<id>, also while its broadcast is still live, or a clip link), TikTok videos, Instagram reels and video posts, Kick recordings, X posts, Dailymotion, Streamable, Loom, or a direct link to a video file (Facebook, Vimeo and Rumble refuse server downloads: ask for the file). One import brings in at most 3 hours. For anything longer (a multi-hour stream VOD), or when only part is needed, pass start and end in SOURCE seconds of the original video: only that part is downloaded, which is much faster, and several ranges import as separate sources. Pad a range a few seconds on each side, then trim to the exact words after transcribing. The imported file starts at 0 at the range start; only a Twitch range longer than 3 minutes starts on the keyframe before it, up to 2 seconds early, so take exact times from its transcript. A live channel link, a private, subscriber-only or signed-in video cannot be imported: say so and ask for the file (uploadMedia). Returns a taskId to poll with getMediaTask; a failed task says why and what to do instead.', inputSchema: z.object({ url: z.string().url(), projectId: projectIdField.optional(), start: z.coerce.number().min(0).optional().describe('SOURCE second of the original video to start from; needs end.'), end: z.coerce.number().positive().optional().describe('SOURCE second to stop at, after start.') }) },
  uploadMedia: { description: 'Upload a local video, image or audio file into a project. No file metadata is required. Returns a shell script that reads size, dimensions and duration itself, uploads the file, and prints the arguments for finishUpload. Run it with sh on the machine holding the file (Node 22+ and ffprobe required), then pass its JSON to finishUpload. Upload access lasts one hour. Callers that already know all metadata may still supply it; that legacy script prints a parts array instead.', inputSchema: z.object({ projectId: projectIdField, filePath: z.string().min(1).describe('Local path of the file, used only to write the upload script.'), fileName: z.string().min(1).max(255), contentType: z.string().regex(/^(?:(video|image|audio)\/[\w.+-]+|model\/gltf-binary)$/).describe('MIME type, e.g. video/mp4, video/quicktime, image/png, audio/mpeg.'), size: z.number().int().positive().optional().describe('Optional known byte size. Omit metadata to let the upload script read it.'), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration: z.number().positive().optional() }) },
  copyMedia: { description: 'Copy media you already have in another of your Revline projects into this project, without uploading it again. Find the source assetIds with getProject on the other project. Only your own projects; returns the new assetId for each, to place with addMedia.', inputSchema: z.object({ projectId: projectIdField.describe('The project to copy the media into.'), assetIds: z.array(z.string().min(1)).min(1).max(20).describe('Asset IDs from another of your projects (getProject lists them).') }) },
  finishUpload: { description: 'Finish an uploadMedia upload with the uploadId and parts from the JSON its script printed. Optional projectId must match the upload’s project. Adds the file to the project media and starts processing; place it on the timeline with addMedia.', inputSchema: z.object({ projectId: projectIdField.optional(), uploadId: z.string().min(1), parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) })).min(1) }) },
  listTimelines: { description: 'List the project\'s timeline tabs: each is a separate video with its own aspect ratio, clips and undo. Editing tools act on the open (active) one.', inputSchema: z.object({ projectId: projectIdField }) },
  openTimeline: { description: 'Open another timeline tab so editing tools act on it. It also switches the editor tab the user sees. Not possible while an edit is running.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1) }) },
  createTimeline: { description: 'Create and open a new timeline tab, blank or as a copy of the tab identified by timelineId or taskId, optionally in another aspect ratio.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1).optional(), from: z.enum(['blank', 'duplicate']), name: z.string().min(1).max(60).optional(), aspectRatio: z.enum(['landscape', 'vertical', 'square']).optional() }) },
  renameTimeline: { description: 'Rename a timeline tab (its name also labels its exports).', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1), name: z.string().min(1).max(60) }) },
  deleteTimeline: { description: 'Delete a timeline tab and its undo history; media stays in the project. A project keeps at least one timeline. Only when the user asks.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1) }) },
  getMediaTask: { description: 'Status and progress of an import or media-processing task.', inputSchema: z.object({ taskId: z.string().min(1) }) },
  exportVideo: { description: 'Render the saved timeline to MP4: the open tab, or another tab with timelineId (from listTimelines). Call once per timeline to export several; they queue and render in turn. 2160 (4K) needs the Studio plan. Returns a jobId to poll with getExport.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1).optional(), ...EXPORT_SETTINGS_INPUT }) },
  getFrames: { description: 'If a read returns pending, follow nextAction with its checkId to retrieve the same frozen render. Look at the edit: frames of the saved timeline at the given timeline seconds, composited exactly as the export draws them (footage, text, effects). Two or more times come back as ONE small contact sheet with the time under each tile, up to 16 per call; more are thinned to 16 evenly spaced ones and the result says so. Scan sparse, then zoom: pick the changed spots (a cut edge is the frame before it and the frame after), never consecutive frames to watch a clip; the transcript and saved analysis say where to look. One time alone returns a larger preview frame for detail. Use it to check framing, captions and effects after editing. Takes about 10-30 seconds. With revision (from listRevisions), it renders the timeline as it was at that saved revision: look at an earlier version the user refers to before bringing it back with restoreClip.', inputSchema: z.object({ checkId: z.string().min(1).optional().describe('Resume the pending frame read returned by this tool; retain its original arguments.'), resolution:z.union([z.literal(720),z.literal(1080)]).optional().describe('Default: small tiles on a sheet, or a preview for one time. 720 returns separate preview frames (up to 6 times). 1080 returns one full-size composition frame without resizing; use only for precise layout inspection.'), projectId: projectIdField, timelineId: z.string().min(1).optional().describe('The timeline tab to render (from listTimelines); without it, the open tab.'), times: z.array(z.number().min(0)).min(1).max(120), revision: z.number().int().min(0).optional().describe('A saved revision from listRevisions to render instead of the current timeline.') }) },
  listExports: { description: 'Recent exports of a project, newest first: queued and rendering ones with progress, and finished ones with a temporary download link. current is false when the timeline changed after the export started.', inputSchema: z.object({ projectId: projectIdField, limit: z.number().int().min(1).max(20).optional() }) },
  getExport: { description: 'Status of an export; a completed export includes a temporary download link.', inputSchema: z.object({ jobId: z.string().min(1) }) },
  cancelExport: { description: 'Stop a queued or rendering export by its jobId (from exportVideo or listExports), the same as Cancel in the editor. Use it when an export is stuck or no longer wanted: a stuck export holds the render queue, so frame and sound checks and the next export wait behind it. Only the render stops; saved edits and finished exports are untouched, so it needs no confirmation. Optional projectId must be the export\'s project.', inputSchema: z.object({ jobId: z.string().min(1), projectId: projectIdField.optional() }) },
} as const;
type ProjectToolName = keyof typeof PROJECT_TOOLS;

type JsonSchema = Record<string, unknown> & { properties?: Record<string, unknown>; required?: string[] };
const toJsonSchema = (schema: z.ZodType) => { const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema; return json; };

/** Editing tools receive an explicit project/timeline, or a task that pins both. */
function withProjectId(schema: JsonSchema): JsonSchema {
  return { ...schema, type: 'object', properties: { projectId: toJsonSchema(projectIdField), timelineId: toJsonSchema(timelineIdField), taskId: toJsonSchema(z.string().min(1).optional().describe('Task ID from startTask. Resolves the project, lane and timeline even when conversations share or omit an MCP session. Pass taskId or explicit projectId and timelineId.')), ...(schema.properties ?? {}) }, required: (schema.required ?? []).filter(name => name !== 'projectId') };
}
/** Lane calls require an explicit timeline or a task that pins one. */
const timelineIdField = z.string().min(1).optional().describe('The timeline tab to work on (from listTimelines). Pass timelineId or taskId from startTask; the call never follows another agent’s open tab.');

type EditorTool = { description?: string; inputSchema: z.ZodType; execute: (input: unknown, options: unknown) => Promise<unknown> };
// Tool definitions are pure closures; only their execution touches ctx or the run.
function editorTools(ctx: ActionCtx, options: Parameters<typeof createEditorToolkit>[1]) {
  const toolkit = createEditorToolkit(ctx, options);
  return { toolkit, tools: Object.fromEntries(Object.entries(toolkit.tools).filter(([name]) => toolBehavior(name)?.mcp !== 'hidden' && name!=='switchLane')) as unknown as Record<string, EditorTool> };
}

// The MCP catalog drops hidden tools and switchLane. finish ends every task, so it must never be one of them: checked
// when the module loads, so such a change fails the deploy (issue #357).
if (toolBehavior('finish')?.mcp === 'hidden') throw new Error('finish must stay in the MCP tool list: every task ends with it.');
const catalogOptions = (): Parameters<typeof createEditorToolkit>[1] => ({
  run: { projectId: 'catalog' as Id<'projects'>, ownerId: 'catalog', runId: 'catalog' },
  project: { timeline: { clips: [], fps: 60, aspectRatio: 'landscape' }, revision: 0, aspectRatio: 'landscape' } as unknown as Doc<'projects'>,
  assets: [], recovering: false, initialPlans: [], selectedClipIds: [], abortSignal: new AbortController().signal,
});

export const listTools = internalAction({ args: {}, returns: v.array(v.object({ name: v.string(), description: v.string(), inputSchema: v.any(), _meta: v.optional(v.any()) })), handler: async (ctx): Promise<{ name: string; description: string; inputSchema: unknown; _meta?: unknown }[]> => {
  const options = catalogOptions();
  const { tools } = editorTools(ctx, options);
  // The catalog is the same for every session. A tag names what enables the tool; calls enforce it.
  const description = (name: string, text: string) => {
    return `${laneToolAllowed('edit', name) ? '[Shared editing]' : `[Needs: ${toolCapabilities(name).slice(0, 3).join(' | ')}]`} ${text}`;
  };
  return [
    ...Object.entries(PROJECT_TOOLS).map(([name, tool]) => {
      const inputSchema=toJsonSchema(tool.inputSchema);
      if(name!=='startTask'&&inputSchema.properties?.projectId) inputSchema.properties.taskId=toJsonSchema(z.string().min(1).optional().describe('Task ID from startTask; resolves this project’s lane context and pins an omitted timelineId.'));
      return { name, description: description(name,tool.description), inputSchema };
    }),
    ...Object.entries(tools).filter(([name])=>!(name in PROJECT_TOOLS)&&(LANE_IDS.some(lane=>laneToolAllowed(lane,name))||Object.values(SKILL_TOOLS).some(names=>names.includes(name)))).map(([name, tool]) => ({ name, description: description(name,tool.description ?? name), inputSchema: withProjectId(toJsonSchema(tool.inputSchema)) })),
  ];
}});

const callResult = v.object({ text: v.string(), isError: v.boolean(), ended: v.optional(v.boolean()), images: v.optional(v.array(v.object({ data: v.string(), mimeType: v.string() }))), structuredContent: v.optional(v.any()) });
type CallResult = { text: string; isError: boolean; ended?: boolean; images?: { data: string; mimeType: string }[]; structuredContent?: Record<string, unknown> };
const result = (value: unknown, isError = false): CallResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), isError });
const failed = (value: unknown) => !!value && typeof value === 'object' && (value as { success?: unknown }).success === false;
const message = (error: unknown) => {
  const data = (error as { data?: unknown })?.data;
  return (typeof data === 'string' ? data : data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : error instanceof Error ? error.message : String(error)).slice(0, 2000);
};

function toolFailureMessage(text: string): string {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return text; }
  const parsed = z.object({ error: z.union([z.string(), z.object({ message: z.string() })]).optional(), message: z.string().optional(), reason: z.string().optional() }).safeParse(value);
  if (!parsed.success) return 'Revline tool returned an unsuccessful result';
  return typeof parsed.data.error === 'string' ? parsed.data.error : parsed.data.error?.message ?? parsed.data.message ?? parsed.data.reason ?? 'Revline tool returned an unsuccessful result';
}

const AI_METERED_TOOLS=new Set(['analyzeMedia','findHighlights','generateSound']);
export const callTool = internalAction({ args: { ownerId: v.string(), agentName: v.optional(v.string()), agentClientId:v.optional(v.id('mcpConnections')), connectionId:v.optional(v.string()), name: v.string(), arguments: v.any() }, returns: callResult, handler: async (ctx, args): Promise<CallResult> => {
  const startedAt=Date.now();
  // The task whose working badge this call raised, and the task this call ends. Settled in finally, so thrown failures count.
  let busyTask: string | undefined, endedTask: string | undefined, timedTask: string | undefined;
  try {
  const input = args.arguments && typeof args.arguments === 'object' ? args.arguments as Record<string, unknown> : {};
  const projectTool=args.name in PROJECT_TOOLS;
  const taskScoped=!['startTask','getMediaTask'].includes(args.name);
  if(input.projectId!==undefined&&(typeof input.projectId!=='string'||!input.projectId))return result('projectId must be a project ID from listProjects.',true);
  if(input.timelineId!==undefined&&(typeof input.timelineId!=='string'||!input.timelineId))return result('timelineId must be a timeline ID from listTimelines.',true);
  if(taskScoped&&input.taskId!==undefined&&(typeof input.taskId!=='string'||!input.taskId))return result('taskId must be the task ID returned by startTask.',true);
  const session=args.name==='startTask'?null:await ctx.runQuery(internal.lanes.mcpSession,{
    ownerId:args.ownerId,...(args.connectionId?{connectionId:args.connectionId}:{}),
    ...(typeof input.projectId==='string'?{projectId:input.projectId}:{}),
    ...(typeof input.timelineId==='string'?{timelineId:input.timelineId}:{}),
    ...(taskScoped&&typeof input.taskId==='string'?{taskId:input.taskId}:{}),
  }) as Doc<'mcpLaneSessions'>|null;
  // finish always ends the task's live session, passed or not; its result still records the attempt honestly, and any
  // later call on the task reopens it (touchTaskAgent) so the agent can fix the failures and finish again.
  if(session)timedTask=session.taskId;
  if(session&&args.name==='finish')endedTask=session.taskId;
  if(taskScoped&&input.taskId&&!session)return result('Task not found for this owner and project. Use the taskId and projectId returned by startTask.',true);
  // Only an explicit task ID may supply omitted targets. A connection's last
  // task must never choose the project or timeline of an edit.
  if(taskScoped&&input.taskId&&session){input.projectId??=session.projectId;input.timelineId??=session.timelineId;}
  const agentName=(args.agentClientId?args.agentName:session?.agentName??args.agentName)??'MCP client';
  const agentClientId=args.agentClientId??session?.agentClientId;
  const sessionLane=session?.lane??'edit';
  if(!session&&!MCP_SELECTION_TOOLS.has(args.name)&&!RESOURCE_TOOLS.has(args.name)&&!REPORT_TOOLS.has(args.name))return result('Pass the taskId from startTask, or start a task for this target with startTask(projectId, timelineId, request). A style is optional; shared editing tools are available immediately.',true);
  const task = session ? await ctx.runQuery(internal.lanes.task, {ownerId:args.ownerId,projectId:session.projectId,taskId:session.taskId}) as LaneTask|null : null;
  const lane=task?.lane??sessionLane;
  if(!laneToolAllowed(lane,args.name,task?.capabilities))return result(laneToolError(lane,args.name),true);
  // Tools that run a model on Revline's side count toward the plan's AI allowance; past it they are refused.
  if(AI_METERED_TOOLS.has(args.name)){const refusal=await ctx.runQuery(internal.usage.aiRefusal,{ownerId:args.ownerId});if(refusal)return result(refusal,true);}
  if(args.name==='startTask'){
    const parsed=PROJECT_TOOLS.startTask.inputSchema.safeParse(input);
    if(!parsed.success)return result(z.prettifyError(parsed.error),true);
    const request=parsed.data,projectId=await ctx.runQuery(internal.mcp.readRun,{ownerId:args.ownerId,projectId:request.projectId});
    const {project}=await ctx.runQuery(internal.assistant.getRun,{ownerId:args.ownerId,projectId,runId:readRunId(request.timelineId)});
    const timelineId=request.timelineId??project.activeTimelineId??project.timelineTabs?.[0]?.id??'main';
    const stored=await ctx.runQuery(internal.lanes.forTab,{ownerId:args.ownerId,projectId,timelineId});
    const command=parseEditorCommand(request.request),selection=initialLaneSelection(command,stored?.lane,stored?.manual,request.lane,!command&&reelRequested(request.request,project.timeline)),taskId=newMcpTaskId();
    const laneChosen=true,checks=requestChecks(request.request,command),checkLevel=taskCheckLevel(checks);
    await ctx.runMutation(internal.lanes.begin,{ownerId:args.ownerId,projectId,taskId,timelineId,...selection,reason:request.reason??selection.reason,laneChosen,required:command?.name==='clip'||laneChosen&&request.taskType!=='question',...checks});
    // Earlier tasks on this tab that never called finish stop showing as working until they call again.
    await ctx.runMutation(internal.lanes.setMcpSession,{ownerId:args.ownerId,connectionId:args.connectionId??`task:${taskId}`,projectId,taskId,timelineId,lane:selection.lane,laneChosen,supersede:true});
    await ctx.runMutation(internal.mcp.touchAgent,{ownerId:args.ownerId,projectId,taskId,agentName,startedAt,...(agentClientId?{agentClientId}:{})});
    busyTask=taskId;
    return result({projectId,taskId,timelineId,lane:selection.lane,currentLane:selection.lane,lockedLane:selection.lockedLane,checkLevel,instructions:LANES[selection.lane].instructions,checks:checkInstructions(selection.lane,checkLevel),next:'Shared editing tools are ready. Style selection is optional. tools/list already holds every tool; load only the supporting capabilities you need, and a [Needs: …] tool runs once its lane or capability is loaded. Keep projectId and taskId on calls. Finish actual editing tasks before claiming completion.'});
  }
  if(args.name==='setLane'){
    if(!session)return result('Call startTask with projectId, timelineId and the user request first.',true);
    const parsed=PROJECT_TOOLS.setLane.inputSchema.safeParse(input);if(!parsed.success)return result(z.prettifyError(parsed.error),true);
    const timelineId=parsed.data.timelineId??session.timelineId;
    await ctx.runMutation(internal.lanes.switchLane,{ownerId:args.ownerId,projectId:session.projectId,taskId:session.taskId,timelineId,lane:parsed.data.lane,reason:parsed.data.reason,taskType:parsed.data.taskType});
    await ctx.runMutation(internal.lanes.setMcpSession,{ownerId:args.ownerId,connectionId:session.connectionId,projectId:session.projectId,taskId:session.taskId,timelineId,lane:parsed.data.lane,laneChosen:true});
    await ctx.runMutation(internal.mcp.touchAgent,{ownerId:args.ownerId,projectId:session.projectId,taskId:session.taskId,agentName,startedAt,...(agentClientId?{agentClientId}:{})});
    busyTask=session.taskId;
    const checkLevel=taskCheckLevel(task);
    return result({projectId:session.projectId,taskId:session.taskId,timelineId,lane:parsed.data.lane,checkLevel,checks:checkInstructions(parsed.data.lane,checkLevel),next:'The lane’s tools now run; tools/list is unchanged. Read needed workflow skills; finish the primary deliverable before reporting completion.'});
  }
  if(args.name==='exportVideo'){
    // A paid export never rests on an inferred task: a sessionless call names the task the user confirmed it in.
    if(session&&!args.connectionId&&!input.taskId)return result('Pass the taskId of the task in which the user confirmed this export.',true);
    const task=session?await ctx.runQuery(internal.lanes.task,{ownerId:args.ownerId,projectId:session.projectId,taskId:session.taskId}) as LaneTask|null:null;
    if(!task?.exportConfirmed)return result('Export needs explicit user confirmation. Start the task with the user’s export request only after they confirm.',true);
  }
  if((!projectTool||['getFrames','exportVideo','createTimeline'].includes(args.name))&&!REPORT_TOOLS.has(args.name)){
    if(!input.projectId||!input.timelineId)return result('Pass projectId and timelineId explicitly, or taskId from startTask to pin both.',true);
  }
  if(session&&['createTimeline','renameTimeline','deleteTimeline'].includes(args.name))await ctx.runMutation(internal.lanes.requireFinish,{ownerId:args.ownerId,projectId:session.projectId,taskId:session.taskId});
  // The editor shows the agent as working while a call runs and briefly after (settled in finally); the ten-minute
  // lease keeps the task open between calls. touchAgent rewrites the lease only once less than half is left.
  const projectId = typeof input.projectId === 'string' && args.name !== 'deleteProject' ? input.projectId : undefined;
  if (projectId) { await ctx.runMutation(internal.mcp.touchAgent, { ownerId: args.ownerId, projectId, agentName, startedAt, ...(session?{taskId:session.taskId}:{}), ...(agentClientId?{agentClientId}:{}) }).catch(() => null); if (session) busyTask = session.taskId; }
  try {
    const output = args.name in PROJECT_TOOLS
      ? await callProjectTool(ctx, args.ownerId, args.name as ProjectToolName, input)
      : await callEditorTool(ctx, args.ownerId, args.name, input, agentName, args.name==='reportIssue'?undefined:session??undefined);
    if(session&&output.ended)endedTask=session.taskId;
    if(session&&!output.isError&&['createTimeline','openTimeline'].includes(args.name)){
      const opened=JSON.parse(output.text) as {timelineId?:string;opened?:string|boolean};
      const target=opened.timelineId??(typeof opened.opened==='string'?opened.opened:undefined);
      if(target){
        await ctx.runMutation(internal.lanes.switchLane,{ownerId:args.ownerId,projectId:session.projectId,taskId:session.taskId,timelineId:target,lane:session.lane,reason:'Continuing the current MCP task in another timeline'});
        await ctx.runMutation(internal.lanes.setMcpSession,{ownerId:args.ownerId,connectionId:session.connectionId,projectId:session.projectId,taskId:session.taskId,timelineId:target,lane:session.lane,laneChosen:session.laneChosen});
      }
    }
    if (output.isError) await ctx.runMutation(internal.incidents.reportMcp, { ownerId: args.ownerId, projectId, toolName: args.name, message: toolFailureMessage(output.text) }).catch(() => {});
    // Looking at the saved timeline clears the task's queued changed frames, as the app's getFrames does.
    if (session && args.name === 'getFrames' && !output.isError && input.revision === undefined && input.projectId === session.projectId && typeof input.timelineId === 'string') {
      let read: { revision?: unknown; frames?: unknown } = {};
      try { read = JSON.parse(output.text); } catch { /* A non-JSON result renders no frames. */ }
      const frames = z.object({ revision: z.number(), frames: z.array(z.object({ time: z.number() })).min(1) }).safeParse(read);
      if (frames.success) await ctx.runMutation(internal.lanes.reviewFrames, { ownerId: args.ownerId, projectId: session.projectId, taskId: session.taskId, timelineId: input.timelineId, revision: frames.data.revision, times: frames.data.frames.map(frame => frame.time) });
    }
    if (!output.isError && ['loadCapability','readSkill'].includes(args.name) && typeof input.name === 'string') {
      const loaded = z.record(z.string(), z.unknown()).parse(JSON.parse(output.text));
      return result({ ...loaded, tools: capabilityTools(input.name), next: 'These tools are already in tools/list and now run for this task. The primary task and its completion checks are unchanged.' });
    }
    return output;
  } catch (error) { await ctx.runMutation(internal.incidents.reportMcp, { ownerId: args.ownerId, projectId, toolName: args.name, message: message(error), stack: error instanceof Error ? error.stack : undefined }).catch(() => {}); return result(message(error), true); }
  } catch(error){return result(message(error),true);}
  finally{
    // Where an MCP task's time went: the tool name and how long the call took, nothing of what was asked (lib/ai/step-timing.ts).
    timedTask??=busyTask??endedTask;
    if(timedTask&&/^[A-Za-z]{1,48}$/.test(args.name))await ctx.runMutation(internal.runTimings.record,{runId:timedTask,source:'mcp',steps:[{step:0,kind:'tool',name:args.name,at:startedAt,ms:Date.now()-startedAt,key:argumentKey(args.arguments)}]}).catch(()=>null);
    if(endedTask)await ctx.runMutation(internal.mcpConnections.endTask,{ownerId:args.ownerId,taskId:endedTask}).catch(()=>null);
    else if(busyTask)await ctx.runMutation(internal.mcpConnections.settleTaskAgent,{ownerId:args.ownerId,taskId:busyTask,startedAt}).catch(()=>null);
  }
}});

async function callProjectTool(ctx: ActionCtx, ownerId: string, name: ProjectToolName, raw: Record<string, unknown>): Promise<CallResult> {
  const parsed = PROJECT_TOOLS[name].inputSchema.safeParse(raw);
  if (!parsed.success) return result(`Invalid arguments: ${z.prettifyError(parsed.error)}`, true);
  const input = parsed.data as Record<string, never>;
  switch (name) {
    case 'startTask': case 'setLane': throw new Error('Lane tools require the task dispatcher.');
    case 'listProjects': return result(await ctx.runQuery(internal.mcp.listProjects, { ownerId, ...input }));
    case 'getProject': return result(await ctx.runQuery(internal.mcp.projectOverview, { ownerId, projectId: input.projectId }));
    case 'createProject': return result(await ctx.runMutation(internal.mcp.createProject, { ownerId, title: input.title, aspectRatio: input.aspectRatio }));
    case 'importVideoLink': return result(await ctx.runMutation(internal.mcp.importVideo, { ownerId, url: input.url, ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.start !== undefined ? { start: input.start } : {}), ...(input.end !== undefined ? { end: input.end } : {}) }));
    case 'uploadMedia': return result(await startUpload(ctx, ownerId, input as unknown as z.infer<typeof PROJECT_TOOLS.uploadMedia.inputSchema>));
    case 'finishUpload': {
      const uploadId = input.uploadId as string;
      const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: uploadId as Id<'r2Uploads'>, ownerId });
      if(input.projectId&&input.projectId!==lease.projectId)return result('This upload belongs to another project. Pass its original projectId and uploadId.',true);
      const assetId = await completeUpload(ctx, lease, [...(input.parts as { partNumber: number; etag: string }[])].sort((a, b) => a.partNumber - b.partNumber));
      return result({ assetId, projectId: lease.projectId, note: lease.kind === 'image' ? 'The image is ready. Place it with addMedia.' : 'Processing has started. Place it with addMedia now; getProject shows when its analysis is saved.' });
    }
    case 'copyMedia': return result(await ctx.runMutation(internal.mcp.copyMedia, { ownerId, projectId: input.projectId, assetIds: input.assetIds }));
    case 'listTimelines': return result(await ctx.runQuery(internal.mcp.listTimelines, { ownerId, projectId: input.projectId }));
    case 'openTimeline': return result(await ctx.runMutation(internal.mcp.openTimeline, { ownerId, projectId: input.projectId, timelineId: input.timelineId }));
    case 'createTimeline': return result(await ctx.runMutation(internal.mcp.createTimeline, { ownerId, projectId: input.projectId, timelineId: input.timelineId, from: input.from, ...(input.name ? { name: input.name } : {}), ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}) }));
    case 'renameProject': return result(await ctx.runMutation(internal.mcp.renameProject, { ownerId, projectId: input.projectId, title: input.title }));
    case 'duplicateProject': return result(await ctx.runMutation(internal.mcp.duplicateProject, { ownerId, projectId: input.projectId, ...(input.title ? { title: input.title } : {}) }));
    case 'deleteProject': return result(await ctx.runMutation(internal.mcp.deleteProject, { ownerId, projectId: input.projectId }));
    case 'renameTimeline': return result(await ctx.runMutation(internal.mcp.renameTimeline, { ownerId, projectId: input.projectId, timelineId: input.timelineId, name: input.name }));
    case 'deleteTimeline': return result(await ctx.runMutation(internal.mcp.deleteTimeline, { ownerId, projectId: input.projectId, timelineId: input.timelineId }));
    case 'getMediaTask': return result(await ctx.runQuery(internal.mcp.mediaTask, { ownerId, taskId: input.taskId }));
    case 'exportVideo': return result(await ctx.runMutation(internal.mcp.startExport, { ownerId, projectId: input.projectId, ...(input.timelineId ? { timelineId: input.timelineId } : {}), resolution: input.resolution ?? 1080, fps: input.fps ?? 30, quality: input.quality ?? 'high' }));
    case 'getFrames': {
      const input = PROJECT_TOOLS.getFrames.inputSchema.parse(parsed.data);
      if (!input.timelineId) return result('Pass timelineId to pin the frame read to its timeline.', true);
      // Sparse by default: one sheet of at most 16 evenly spaced times. The thinning is deterministic, so a resumed read asks for the same frames.
      const asked = [...new Set(input.times)].sort((a, b) => a - b), times = input.resolution ? input.times : evenly(asked, MAX_SHEET_FRAMES), sheet = !input.resolution && times.length > 1;
      const thinned = !input.resolution && times.length < asked.length ? ` ${asked.length} times were asked for; one look returns at most ${MAX_SHEET_FRAMES}, so these are ${times.length} of them, evenly spaced. Ask again only for a narrower window you still need.` : '';
      const request = { ownerId, projectId: input.projectId, times, ...(input.resolution?{resolution:input.resolution}:{}), ...(input.timelineId ? { timelineId: input.timelineId } : {}), ...(input.revision !== undefined ? { revision: input.revision } : {}) };
      const snapshotId = input.checkId
        ? await ctx.runQuery(internal.mcp.resolveFrameRead, { ...request, timelineId: input.timelineId, checkId: input.checkId })
        : await retryAbortedTransaction(() => ctx.runMutation(internal.mcp.requestFrames, { ...request, ...(sheet ? { sheet: true } : {}) }));
      const deadline = Date.now() + 45_000;
      let revision = input.revision;
      const pending = (error?: string) => result({ status: 'pending', checkId: snapshotId, revision, ...(error ? { error } : {}), nextAction: { tool: 'getFrames', arguments: { ...input, checkId: snapshotId } }, note: 'Follow nextAction to retrieve this frozen frame read without starting another render. The request expires ten minutes after it started.' });
      while (Date.now() < deadline) {
        const state = await ctx.runQuery(internal.mcp.frames, { ownerId, snapshotId });
        revision = state.revision;
        if (state.status === 'failed') { await ctx.runMutation(internal.mcp.discardFrames, { snapshotId }); return result(`Frames could not be rendered: ${state.error ?? 'unknown error'}`, true); }
        if (state.status === 'completed') {
          let frames: Awaited<ReturnType<typeof snapshotFrames>>;
          try { frames = await snapshotFrames(state); }
          catch (error) { return pending(error instanceof Error ? error.message : 'The rendered frames could not load.'); }
          await ctx.runMutation(internal.mcp.discardFrames, { snapshotId });
          const of = state.atRevision !== undefined ? `the timeline as it was at revision ${state.atRevision}` : 'the saved timeline', onSheet = sheet && frames.length === 1;
          return { ...result({ revision: state.revision, ...(state.atRevision !== undefined ? { atRevision: state.atRevision } : {}), frames: onSheet ? times.map(time => ({ time: Math.round(time * 1000) / 1000 })) : frames.map(frame => ({ time: frame.time, ...(frame.width?{width:frame.width,height:frame.height}:{}) })), note: `${onSheet ? `One contact sheet of ${times.length} composited frames of ${of} follows, left to right, top to bottom, each labeled with its time.` : `Images follow in time order, ${input.resolution===1080?'1080p':'Preview'} composited frames of ${of}.`}${thinned}` }), images: frames.map(frame => ({ data: frame.image, mimeType: 'image/jpeg' })) };
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      return pending();
    }
    case 'listExports': {
      const jobs = await ctx.runQuery(internal.mcp.listExports, { ownerId, projectId: input.projectId, limit: input.limit ?? 10 }) as { output: { storageId?: Id<'_storage'>; r2Key?: string; fileName: string } | null }[];
      return result(await Promise.all(jobs.map(async ({ output, ...job }) => { const downloadUrl = output ? await mediaDownloadUrl(ctx, { storageId: output.storageId, r2Key: output.r2Key }, output.fileName) : null; return { ...job, ...(downloadUrl ? { downloadUrl } : {}) }; })));
    }
    case 'cancelExport': return result(await ctx.runMutation(internal.mcp.cancelExport, { ownerId, jobId: input.jobId, ...(input.projectId ? { projectId: input.projectId } : {}) }));
    case 'getExport': {
      const { output, ...job } = await ctx.runQuery(internal.mcp.exportJob, { ownerId, jobId: input.jobId });
      const downloadUrl = output ? await mediaDownloadUrl(ctx, { storageId: output.storageId, r2Key: output.r2Key }, output.fileName) : null;
      return result({ ...job, ...(downloadUrl ? { downloadUrl } : {}) });
    }
  }
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Opens the same multipart upload the editor uses and writes a script that PUTs each part and prints the parts JSON. */
async function startUpload(ctx: ActionCtx, ownerId: string, input: z.infer<typeof PROJECT_TOOLS.uploadMedia.inputSchema>) {
  const kind = mediaKind(input.contentType);
  if (kind === 'model') return startLocalUpload(ctx, { ownerId, projectId: input.projectId, fileName: input.fileName, contentType: input.contentType }, input.filePath);
  if (input.size === undefined || kind !== 'audio' && (!input.width || !input.height) || kind !== 'image' && !input.duration) return startLocalUpload(ctx, { ownerId, projectId: input.projectId, fileName: input.fileName, contentType: input.contentType }, input.filePath);
  const upload = await openUpload(ctx, { projectId: input.projectId as Id<'projects'>, fileName: input.fileName, contentType: input.contentType, kind, size: input.size, ...(input.duration ? { duration: input.duration } : {}), ...(kind !== 'audio' ? { width: input.width, height: input.height } : {}) }, ownerId);
  const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: upload.uploadId, ownerId });
  const lines = ['#!/bin/sh', 'set -e', `f=${shellQuote(input.filePath)}`, 'echo "["'];
  for (let partNumber = 1; partNumber <= upload.partCount; partNumber++) {
    const offset = (partNumber - 1) * upload.partSize, length = Math.min(upload.partSize, input.size - offset);
    const url = await signPartUrl(lease, partNumber);
    lines.push(`tail -c +${offset + 1} "$f" | head -c ${length} | curl -sS --fail -X PUT -H 'Content-Type: application/octet-stream' --data-binary @- ${shellQuote(url)}`);
    if (partNumber < upload.partCount) lines.push('echo ","');
  }
  lines.push('echo "]"');
  return { uploadId: upload.uploadId, partCount: upload.partCount, script: lines.join('\n'), next: 'Run the script with sh, then call finishUpload with this uploadId and the JSON array it printed as parts.' };
}

/** A tool output's labeled images become MCP image content after the text. */
function withImages(output: unknown, isError: boolean): CallResult {
  if (!output || typeof output !== 'object' || !Array.isArray((output as { images?: unknown }).images)) return result(output, isError);
  const { images, ...rest } = output as { images: { label: string; data: string; mimeType: string }[] };
  return { ...result({ ...rest, images: images.map(image => image.label) }, isError), images: images.map(image => ({ data: image.data, mimeType: image.mimeType })) };
}

async function mcpLaneOptions(ctx: ActionCtx, ownerId: string, session?: Doc<'mcpLaneSessions'>) {
  if (!session) return {};
  const task = await ctx.runQuery(internal.lanes.task, { ownerId, projectId: session.projectId, taskId: session.taskId }) as LaneTask | null;
  return { lane: task?.lane ?? session.lane, laneChosen: true, capabilities: task?.capabilities, taskId: session.taskId, finishRequired: task?.required ?? true, checkLevel: taskCheckLevel(task) };
}

async function readEditorTool(ctx: ActionCtx, ownerId: string, rawProjectId: string, name: string, input: unknown, timelineId?: string, laneSession?:Doc<'mcpLaneSessions'>, agentName?: string): Promise<CallResult> {
  try {
    const projectId = await ctx.runQuery(internal.mcp.readRun, { ownerId, projectId: rawProjectId });
    // A named tab is read from its stored timeline, on every reload the tool makes; the open tab stays as it is.
    const run = { projectId, ownerId, runId: readRunId(timelineId) };
    const { project, assets } = await ctx.runQuery(internal.assistant.getRun, run);
    const abortSignal = AbortSignal.timeout(CALL_LIMIT_MS);
    const { tools } = editorTools(ctx, { run, project, assets, recovering: false, initialPlans: [], selectedClipIds: [], abortSignal, planlessEffects: true, agent: agentName, ...await mcpLaneOptions(ctx,ownerId,laneSession) });
    const tool = tools[name];
    const output = await tool.execute.call({ ...tool, ctx }, input, { toolCallId: crypto.randomUUID(), messages: [], abortSignal });
    return withImages(output, failed(output));
  } catch (error) { return result(message(error), true); }
}

async function callEditorTool(ctx: ActionCtx, ownerId: string, name: string, raw: Record<string, unknown>, agentName?: string, laneSession?:Doc<'mcpLaneSessions'>): Promise<CallResult> {
  // Clients with cached schemas may still send the retired editMode; it is dropped, never validated against a tool.
  const { projectId: rawProjectId, timelineId: rawTimelineId, taskId: _taskId, editMode: _legacyEditMode, ...rawInput } = raw;
  if (typeof rawProjectId !== 'string' || !rawProjectId) return result('projectId is required. Call listProjects to find it.', true);
  if (rawTimelineId !== undefined && (typeof rawTimelineId !== 'string' || !rawTimelineId)) return result('timelineId must be a timeline id from listTimelines.', true);
  const timelineId = rawTimelineId as string | undefined;
  // Validate before locking the project, against the same schema the run will use.
  const known = editorTools(ctx, catalogOptions()).tools[name];
  if (!known) return result(`Unknown tool ${name}.`, true);
  const parsed = known.inputSchema.safeParse(rawInput);
  if (!parsed.success) return result(`Invalid arguments: ${z.prettifyError(parsed.error)}`, true);

  if (toolBehavior(name)?.mcp === 'read') return readEditorTool(ctx, ownerId, rawProjectId, name, parsed.data, timelineId, laneSession,agentName);
  // The tab switch and the edit lock happen in one transaction, so no other agent's tab switch can land in between.
  const { projectId, runId } = await ctx.runMutation(internal.mcp.beginRun, { ownerId, projectId: rawProjectId, ...(agentName ? { agentName } : {}), ...(timelineId ? { timelineId } : {}) });
  const run = { projectId, ownerId, runId };
  const controller = new AbortController(), deadline = AbortSignal.timeout(CALL_LIMIT_MS);
  const abortSignal = AbortSignal.any([controller.signal, deadline]);
  // Stop in the editor ends the run; abort promptly like an in-app turn.
  // A failed status poll is not a Stop: the next poll decides, as in the in-app turn.
  const watch = setInterval(() => { void ctx.runQuery(internal.assistant.isRunActive, run).then(active => { if (!active) controller.abort(); }).catch(() => {}); }, 2000);
  try {
    const { project, assets } = await ctx.runQuery(internal.assistant.getRun, run);
    const { toolkit, tools } = editorTools(ctx, { run, project, assets, recovering: false, initialPlans: [], selectedClipIds: [], abortSignal, planlessEffects: true, ...await mcpLaneOptions(ctx,ownerId,laneSession) });
    const tool = tools[name];
    const rawOutput = await tool.execute.call({ ...tool, ctx }, parsed.data, { toolCallId: crypto.randomUUID(), messages: [], abortSignal });
    const output = rawOutput && typeof rawOutput === 'object' ? { ...rawOutput, checkLevel: toolkit.checkLevel() } : rawOutput;
    // A destructive edit is staged privately; publish it as this call's one saved edit.
    const published = failed(output) ? false : await toolkit.editSession.complete('stop');
    return withImages(published ? await toolkit.publicationResult(output) : output, failed(output));
  } catch (error) {
    const stopped=abortSignal.aborted&&!deadline.aborted;
    return {...result(stopped ? 'Stopped in the editor before this edit finished. Saved edits remain.' : message(error), true), ...(stopped?{ended:true}:{})};
  } finally {
    clearInterval(watch);
    // Releasing the lock must not replace this call's result: a saved edit reported as failed is retried and applied twice.
    // If the release itself fails, beginRun's scheduled finish frees the project.
    await safely('mcpFinish', () => ctx.runMutation(internal.assistant.finish, run));
  }
}
