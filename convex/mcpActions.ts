"use node";
import { v } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { createEditorToolkit } from './lib/editorToolkit';
import { mediaDownloadUrl } from './lib/media_storage';
import { readRunId } from './lib/run_ids';
import { completeUpload, openUpload, signPartUrl } from './r2';

// The editor's own AI tools, exposed over MCP. planEffects/previewRender keep
// review plans for the length of one in-app turn, which an MCP call does not have.
// Choice cards only exist in the editor's chat; MCP clients ask in their own way.
// An MCP call still runs in one Convex action; stop before its ten-minute limit with a clear message.
const CALL_LIMIT_MS = 9 * 60_000;
const RUN_SCOPED_TOOLS = new Set(['planEffects', 'previewRender', 'getFrames', 'askUser', 'askBrandKit']);
const projectIdField = z.string().min(1).describe('Revline project ID from listProjects or getProject.');

const PROJECT_TOOLS = {
  listProjects: { description: 'List your Revline video projects, newest first, with their IDs and editor links. Start here to find the project to edit.', inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }) },
  getProject: { description: 'Overview of one project: its timeline tabs (which one is open), aspect ratio, duration, revision, editor link and its media (asset IDs, kinds, durations, which analyses are saved). Then call inspectTimeline with the same projectId to read clips before editing.', inputSchema: z.object({ projectId: projectIdField }) },
  createProject: { description: 'Create an empty project. Add footage with uploadMedia (a local file) or importVideoLink.', inputSchema: z.object({ title: z.string().min(1).max(120), aspectRatio: z.enum(['landscape', 'vertical', 'square']) }) },
  renameProject: { description: 'Rename a project.', inputSchema: z.object({ projectId: projectIdField, title: z.string().min(1).max(120) }) },
  duplicateProject: { description: 'Copy a whole project (every timeline tab and its media) into a new project, e.g. to try another version without touching the original. Returns the new projectId.', inputSchema: z.object({ projectId: projectIdField, title: z.string().min(1).max(120).optional() }) },
  deleteProject: { description: 'Permanently delete a project with its timelines, chat and exports. Only when the user explicitly asks to delete it; confirm must be true. Not possible during an edit or render.', inputSchema: z.object({ projectId: projectIdField, confirm: z.literal(true) }) },
  importVideoLink: { description: 'Import a video from a link (YouTube and other supported sites) into a project, or into a new project when projectId is omitted. Returns a taskId to poll with getMediaTask.', inputSchema: z.object({ url: z.string().url(), projectId: projectIdField.optional() }) },
  uploadMedia: { description: 'Upload a local video, image or audio file into a project. Read its exact byte size, and for video/image its pixel width and height and for video/audio its duration in seconds (e.g. ffprobe). Returns a shell script: run it in a terminal and pass the JSON it prints as parts to finishUpload. The upload URLs last one hour.', inputSchema: z.object({ projectId: projectIdField, filePath: z.string().min(1).describe('Local path of the file, used only to write the upload script.'), fileName: z.string().min(1).max(255), contentType: z.string().regex(/^(video|image|audio)\/[\w.+-]+$/).describe('MIME type, e.g. video/mp4, video/quicktime, image/png, audio/mpeg.'), size: z.number().int().positive().describe('Exact file size in bytes.'), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), duration: z.number().positive().optional() }) },
  finishUpload: { description: 'Finish an uploadMedia upload with the parts JSON its script printed. Adds the file to the project media and starts processing; place it on the timeline with addMedia.', inputSchema: z.object({ uploadId: z.string().min(1), parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) })).min(1) }) },
  listTimelines: { description: 'List the project\'s timeline tabs: each is a separate video with its own aspect ratio, clips and undo. Editing tools act on the open (active) one.', inputSchema: z.object({ projectId: projectIdField }) },
  openTimeline: { description: 'Open another timeline tab so editing tools act on it. It also switches the editor tab the user sees. Not possible while an edit is running.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1) }) },
  createTimeline: { description: 'Create a new timeline tab (a separate video sharing this project\'s media), blank or as a copy of the open one, optionally in another aspect ratio, and open it.', inputSchema: z.object({ projectId: projectIdField, from: z.enum(['blank', 'duplicate']), name: z.string().min(1).max(60).optional(), aspectRatio: z.enum(['landscape', 'vertical', 'square']).optional() }) },
  renameTimeline: { description: 'Rename a timeline tab (its name also labels its exports).', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1), name: z.string().min(1).max(60) }) },
  deleteTimeline: { description: 'Delete a timeline tab and its undo history; media stays in the project. A project keeps at least one timeline. Only when the user asks.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1) }) },
  getMediaTask: { description: 'Status and progress of an import or media-processing task.', inputSchema: z.object({ taskId: z.string().min(1) }) },
  exportVideo: { description: 'Render the saved timeline to MP4: the open tab, or another tab with timelineId (from listTimelines). Call once per timeline to export several; they queue and render in turn. 2160 (4K) needs the Ultra plan. Returns a jobId to poll with getExport.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1).optional(), resolution: z.union([z.literal(720), z.literal(1080), z.literal(2160)]).optional(), fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(), quality: z.enum(['draft', 'standard', 'high']).optional() }) },
  getFrames: { description: 'Look at the edit: render 1 to 6 frames of the saved timeline at the given timeline seconds, composited exactly as the export draws them (footage, text, effects). Use it to check framing, captions and effects after editing. Takes about 10-30 seconds.', inputSchema: z.object({ projectId: projectIdField, timelineId: z.string().min(1).optional().describe('The timeline tab to render (from listTimelines); without it, the open tab.'), times: z.array(z.number().min(0)).min(1).max(6) }) },
  listExports: { description: 'Recent exports of a project, newest first: queued and rendering ones with progress, and finished ones with a temporary download link. current is false when the timeline changed after the export started.', inputSchema: z.object({ projectId: projectIdField, limit: z.number().int().min(1).max(20).optional() }) },
  getExport: { description: 'Status of an export; a completed export includes a temporary download link.', inputSchema: z.object({ jobId: z.string().min(1) }) },
} as const;
type ProjectToolName = keyof typeof PROJECT_TOOLS;

type JsonSchema = Record<string, unknown> & { properties?: Record<string, unknown>; required?: string[] };
const toJsonSchema = (schema: z.ZodType) => { const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema; return json; };

/** Editing tools act on one project, so each gains a required projectId. */
function withProjectId(schema: JsonSchema): JsonSchema {
  return { ...schema, type: 'object', properties: { projectId: toJsonSchema(projectIdField), timelineId: toJsonSchema(timelineIdField), ...(schema.properties ?? {}) }, required: ['projectId', ...(schema.required ?? []).filter(name => name !== 'projectId')] };
}
/** Which timeline tab a call works on. Without it, the call uses the project's open tab, which other agents may switch. */
const timelineIdField = z.string().min(1).optional().describe('The timeline tab to work on (from listTimelines). Pass it whenever several agents may edit this project: the edit then always lands in this tab, whichever tab is open. Without it, the call acts on the open tab.');

type EditorTool = { description?: string; inputSchema: z.ZodType; execute: (input: unknown, options: unknown) => Promise<unknown> };
// Tool definitions are pure closures; only their execution touches ctx or the run.
function editorTools(ctx: ActionCtx, options: Parameters<typeof createEditorToolkit>[1]) {
  const toolkit = createEditorToolkit(ctx, options);
  return { toolkit, tools: Object.fromEntries(Object.entries(toolkit.tools).filter(([name]) => !RUN_SCOPED_TOOLS.has(name))) as unknown as Record<string, EditorTool> };
}

const catalogOptions = (): Parameters<typeof createEditorToolkit>[1] => ({
  run: { projectId: 'catalog' as Id<'projects'>, ownerId: 'catalog', runId: 'catalog' },
  project: { timeline: { clips: [], fps: 30, aspectRatio: 'landscape' }, revision: 0, aspectRatio: 'landscape' } as unknown as Doc<'projects'>,
  assets: [], recovering: false, initialPlans: [], selectedClipIds: [], abortSignal: new AbortController().signal,
});

export const listTools = internalAction({ args: {}, returns: v.array(v.object({ name: v.string(), description: v.string(), inputSchema: v.any() })), handler: async (ctx): Promise<{ name: string; description: string; inputSchema: unknown }[]> => {
  const options = catalogOptions();
  const { tools } = editorTools(ctx, options);
  return [
    ...Object.entries(PROJECT_TOOLS).map(([name, tool]) => ({ name, description: tool.description, inputSchema: toJsonSchema(tool.inputSchema) })),
    ...Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description ?? name, inputSchema: withProjectId(toJsonSchema(tool.inputSchema)) })),
  ];
}});

const callResult = v.object({ text: v.string(), isError: v.boolean(), images: v.optional(v.array(v.object({ data: v.string(), mimeType: v.string() }))) });
type CallResult = { text: string; isError: boolean; images?: { data: string; mimeType: string }[] };
const result = (value: unknown, isError = false): CallResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), isError });
const failed = (value: unknown) => !!value && typeof value === 'object' && (value as { success?: unknown }).success === false;
const message = (error: unknown) => {
  const data = (error as { data?: unknown })?.data;
  return (typeof data === 'string' ? data : data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : error instanceof Error ? error.message : String(error)).slice(0, 2000);
};

export const callTool = internalAction({ args: { ownerId: v.string(), agentName: v.optional(v.string()), name: v.string(), arguments: v.any() }, returns: callResult, handler: async (ctx, args): Promise<CallResult> => {
  const input = args.arguments && typeof args.arguments === 'object' ? args.arguments as Record<string, unknown> : {};
  // The editor shows the agent as working across its whole request, not only during each call.
  const projectId = typeof input.projectId === 'string' && args.name !== 'deleteProject' ? input.projectId : undefined;
  const touch = () => projectId ? ctx.runMutation(internal.mcp.touchAgent, { ownerId: args.ownerId, projectId, ...(args.agentName ? { agentName: args.agentName } : {}) }).catch(() => null) : null;
  await touch();
  try {
    if (args.name in PROJECT_TOOLS) return await callProjectTool(ctx, args.ownerId, args.name as ProjectToolName, input);
    return await callEditorTool(ctx, args.ownerId, args.name, input, args.agentName);
  } catch (error) { return result(message(error), true); }
  finally { await touch(); }
}});

async function callProjectTool(ctx: ActionCtx, ownerId: string, name: ProjectToolName, raw: Record<string, unknown>): Promise<CallResult> {
  const parsed = PROJECT_TOOLS[name].inputSchema.safeParse(raw);
  if (!parsed.success) return result(`Invalid arguments: ${z.prettifyError(parsed.error)}`, true);
  const input = parsed.data as Record<string, never>;
  switch (name) {
    case 'listProjects': return result(await ctx.runQuery(internal.mcp.listProjects, { ownerId, ...input }));
    case 'getProject': return result(await ctx.runQuery(internal.mcp.projectOverview, { ownerId, projectId: input.projectId }));
    case 'createProject': return result(await ctx.runMutation(internal.mcp.createProject, { ownerId, title: input.title, aspectRatio: input.aspectRatio }));
    case 'importVideoLink': return result(await ctx.runMutation(internal.mcp.importVideo, { ownerId, url: input.url, ...(input.projectId ? { projectId: input.projectId } : {}) }));
    case 'uploadMedia': return result(await startUpload(ctx, ownerId, input as unknown as z.infer<typeof PROJECT_TOOLS.uploadMedia.inputSchema>));
    case 'finishUpload': {
      const uploadId = input.uploadId as string;
      const lease = await ctx.runQuery(internal.r2.getLease, { uploadId: uploadId as Id<'r2Uploads'>, ownerId });
      const assetId = await completeUpload(ctx, lease, [...(input.parts as { partNumber: number; etag: string }[])].sort((a, b) => a.partNumber - b.partNumber));
      return result({ assetId, projectId: lease.projectId, note: lease.kind === 'image' ? 'The image is ready. Place it with addMedia.' : 'Processing has started. Place it with addMedia now; getProject shows when its analysis is saved.' });
    }
    case 'listTimelines': return result(await ctx.runQuery(internal.mcp.listTimelines, { ownerId, projectId: input.projectId }));
    case 'openTimeline': return result(await ctx.runMutation(internal.mcp.openTimeline, { ownerId, projectId: input.projectId, timelineId: input.timelineId }));
    case 'createTimeline': return result(await ctx.runMutation(internal.mcp.createTimeline, { ownerId, projectId: input.projectId, from: input.from, ...(input.name ? { name: input.name } : {}), ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}) }));
    case 'renameProject': return result(await ctx.runMutation(internal.mcp.renameProject, { ownerId, projectId: input.projectId, title: input.title }));
    case 'duplicateProject': return result(await ctx.runMutation(internal.mcp.duplicateProject, { ownerId, projectId: input.projectId, ...(input.title ? { title: input.title } : {}) }));
    case 'deleteProject': return result(await ctx.runMutation(internal.mcp.deleteProject, { ownerId, projectId: input.projectId }));
    case 'renameTimeline': return result(await ctx.runMutation(internal.mcp.renameTimeline, { ownerId, projectId: input.projectId, timelineId: input.timelineId, name: input.name }));
    case 'deleteTimeline': return result(await ctx.runMutation(internal.mcp.deleteTimeline, { ownerId, projectId: input.projectId, timelineId: input.timelineId }));
    case 'getMediaTask': return result(await ctx.runQuery(internal.mcp.mediaTask, { ownerId, taskId: input.taskId }));
    case 'exportVideo': return result(await ctx.runMutation(internal.mcp.startExport, { ownerId, projectId: input.projectId, ...(input.timelineId ? { timelineId: input.timelineId } : {}), resolution: input.resolution ?? 1080, fps: input.fps ?? 30, quality: input.quality ?? 'high' }));
    case 'getFrames': {
      const snapshotId = await ctx.runMutation(internal.mcp.requestFrames, { ownerId, projectId: input.projectId, times: input.times, ...(input.timelineId ? { timelineId: input.timelineId } : {}) });
      const deadline = Date.now() + 170_000;
      while (Date.now() < deadline) {
        const state = await ctx.runQuery(internal.mcp.frames, { ownerId, snapshotId });
        if (state.status === 'failed') { await ctx.runMutation(internal.mcp.discardFrames, { snapshotId }); return result(`Frames could not be rendered: ${state.error ?? 'unknown error'}`, true); }
        if (state.status === 'completed') {
          await ctx.runMutation(internal.mcp.discardFrames, { snapshotId });
          const frames = state.frames as { time: number; image: string }[];
          return { ...result({ revision: state.revision, frames: frames.map(frame => ({ time: frame.time })), note: 'Images follow in time order, 720p composited frames of the saved timeline.' }), images: frames.map(frame => ({ data: frame.image, mimeType: 'image/jpeg' })) };
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      return result('Rendering frames is taking longer than expected. Try again in a minute.', true);
    }
    case 'listExports': {
      const jobs = await ctx.runQuery(internal.mcp.listExports, { ownerId, projectId: input.projectId, limit: input.limit ?? 10 }) as { output: { storageId?: Id<'_storage'>; r2Key?: string; fileName: string } | null }[];
      return result(await Promise.all(jobs.map(async ({ output, ...job }) => { const downloadUrl = output ? await mediaDownloadUrl(ctx, { storageId: output.storageId, r2Key: output.r2Key }, output.fileName) : null; return { ...job, ...(downloadUrl ? { downloadUrl } : {}) }; })));
    }
    case 'getExport': {
      const { output, ...job } = await ctx.runQuery(internal.mcp.exportJob, { ownerId, jobId: input.jobId });
      const downloadUrl = output ? await mediaDownloadUrl(ctx, { storageId: output.storageId, r2Key: output.r2Key }, output.fileName) : null;
      return result({ ...job, ...(downloadUrl ? { downloadUrl } : {}) });
    }
  }
}

const MAX_MCP_UPLOAD_PARTS = 200;
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Opens the same multipart upload the editor uses and writes a script that PUTs each part and prints the parts JSON. */
async function startUpload(ctx: ActionCtx, ownerId: string, input: z.infer<typeof PROJECT_TOOLS.uploadMedia.inputSchema>) {
  const kind = input.contentType.split('/')[0] as 'video' | 'image' | 'audio';
  if (kind !== 'audio' && (!input.width || !input.height)) throw new Error('width and height are required for video and image files.');
  if (kind !== 'image' && !input.duration) throw new Error('duration is required for video and audio files.');
  const upload = await openUpload(ctx, { projectId: input.projectId as Id<'projects'>, fileName: input.fileName, contentType: input.contentType, kind, size: input.size, ...(input.duration ? { duration: input.duration } : {}), ...(kind !== 'audio' ? { width: input.width, height: input.height } : {}) }, ownerId);
  if (upload.partCount > MAX_MCP_UPLOAD_PARTS) throw new Error(`Files over ${MAX_MCP_UPLOAD_PARTS * upload.partSize / 2 ** 30} GB must be uploaded in the editor.`);
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

// Pure reads: they neither stage edits nor start analysis, so they skip the project lock and
// run alongside in-app or MCP edits. inspectAssetAnalysis can refresh a transcript and
// inspectVideo/inspectFrames bill analysis to a run, so they still take the lock.
// Blueprint tools never touch the timeline, so they skip the project lock while the worker renders.
const READ_ONLY_TOOLS = new Set(['inspectTimeline', 'inspectClip', 'readSkill', 'measureScreen', 'compareScreen', 'saveBlueprint', 'listBlueprints', 'getBlueprint']);
/** A tool output's labeled images become MCP image content after the text. */
function withImages(output: unknown, isError: boolean): CallResult {
  if (!output || typeof output !== 'object' || !Array.isArray((output as { images?: unknown }).images)) return result(output, isError);
  const { images, ...rest } = output as { images: { label: string; data: string; mimeType: string }[] };
  return { ...result({ ...rest, images: images.map(image => image.label) }, isError), images: images.map(image => ({ data: image.data, mimeType: image.mimeType })) };
}

async function readEditorTool(ctx: ActionCtx, ownerId: string, rawProjectId: string, name: string, input: unknown, timelineId?: string): Promise<CallResult> {
  try {
    const projectId = await ctx.runQuery(internal.mcp.readRun, { ownerId, projectId: rawProjectId });
    // A named tab is read from its stored timeline, on every reload the tool makes; the open tab stays as it is.
    const run = { projectId, ownerId, runId: readRunId(timelineId) };
    const { project, assets } = await ctx.runQuery(internal.assistant.getRun, run);
    const abortSignal = AbortSignal.timeout(CALL_LIMIT_MS);
    const { tools } = editorTools(ctx, { run, project, assets, recovering: false, initialPlans: [], selectedClipIds: [], abortSignal, planlessEffects: true });
    const tool = tools[name];
    const output = await tool.execute.call({ ...tool, ctx }, input, { toolCallId: crypto.randomUUID(), messages: [], abortSignal });
    return withImages(output, failed(output));
  } catch (error) { return result(message(error), true); }
}

async function callEditorTool(ctx: ActionCtx, ownerId: string, name: string, raw: Record<string, unknown>, agentName?: string): Promise<CallResult> {
  const { projectId: rawProjectId, timelineId: rawTimelineId, ...rawInput } = raw;
  if (typeof rawProjectId !== 'string' || !rawProjectId) return result('projectId is required. Call listProjects to find it.', true);
  if (rawTimelineId !== undefined && (typeof rawTimelineId !== 'string' || !rawTimelineId)) return result('timelineId must be a timeline id from listTimelines.', true);
  const timelineId = rawTimelineId as string | undefined;
  // Validate before locking the project, against the same schema the run will use.
  const known = editorTools(ctx, catalogOptions()).tools[name];
  if (!known) return result(`Unknown tool ${name}.`, true);
  const parsed = known.inputSchema.safeParse(rawInput);
  if (!parsed.success) return result(`Invalid arguments: ${z.prettifyError(parsed.error)}`, true);

  if (READ_ONLY_TOOLS.has(name)) return readEditorTool(ctx, ownerId, rawProjectId, name, parsed.data, timelineId);
  // The tab switch and the edit lock happen in one transaction, so no other agent's tab switch can land in between.
  const { projectId, runId } = await ctx.runMutation(internal.mcp.beginRun, { ownerId, projectId: rawProjectId, ...(agentName ? { agentName } : {}), ...(timelineId ? { timelineId } : {}) });
  const run = { projectId, ownerId, runId };
  const controller = new AbortController(), deadline = AbortSignal.timeout(CALL_LIMIT_MS);
  const abortSignal = AbortSignal.any([controller.signal, deadline]);
  // Stop in the editor ends the run; abort promptly like an in-app turn.
  const watch = setInterval(() => { void ctx.runQuery(internal.assistant.isRunActive, run).then(active => { if (!active) controller.abort(); }).catch(() => controller.abort()); }, 2000);
  try {
    const { project, assets } = await ctx.runQuery(internal.assistant.getRun, run);
    const { toolkit, tools } = editorTools(ctx, { run, project, assets, recovering: false, initialPlans: [], selectedClipIds: [], abortSignal, planlessEffects: true });
    const tool = tools[name];
    const output = await tool.execute.call({ ...tool, ctx }, parsed.data, { toolCallId: crypto.randomUUID(), messages: [], abortSignal });
    // A destructive edit is staged privately; publish it as this call's one saved edit.
    const published = failed(output) ? false : await toolkit.editSession.complete('stop');
    return result(published && output && typeof output === 'object' ? { ...output, applied: true, saved: true, staged: false, revision: toolkit.editSession.revision } : output, failed(output));
  } catch (error) {
    return result(abortSignal.aborted && !deadline.aborted ? 'Stopped in the editor before this edit finished. Saved edits remain.' : message(error), true);
  } finally {
    clearInterval(watch);
    await ctx.runMutation(internal.assistant.finish, run);
  }
}
