"use node";
import { v } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { createEditorToolkit } from './lib/editorToolkit';
import { mediaDownloadUrl } from './lib/media_storage';
import { AssistantRunBudget } from '../lib/ai/run-budget';

// The editor's own AI tools, exposed over MCP. planEffects/previewRender keep
// review plans for the length of one in-app turn, which an MCP call does not have.
const RUN_SCOPED_TOOLS = new Set(['planEffects', 'previewRender']);
const projectIdField = z.string().min(1).describe('Revline project ID from listProjects or getProject.');

const PROJECT_TOOLS = {
  listProjects: { description: 'List your Revline video projects, newest first, with their IDs and editor links. Start here to find the project to edit.', inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }) },
  getProject: { description: 'Overview of one project: aspect ratio, duration, revision, editor link and its media (asset IDs, kinds, durations, which analyses are saved). Then call inspectTimeline with the same projectId to read clips before editing.', inputSchema: z.object({ projectId: projectIdField }) },
  createProject: { description: 'Create an empty project. Add footage with importVideoLink, or upload in the editor.', inputSchema: z.object({ title: z.string().min(1).max(120), aspectRatio: z.enum(['landscape', 'vertical', 'square']) }) },
  importVideoLink: { description: 'Import a video from a link (YouTube and other supported sites) into a project, or into a new project when projectId is omitted. Returns a taskId to poll with getMediaTask.', inputSchema: z.object({ url: z.string().url(), projectId: projectIdField.optional() }) },
  getMediaTask: { description: 'Status and progress of an import or media-processing task.', inputSchema: z.object({ taskId: z.string().min(1) }) },
  exportVideo: { description: 'Render the saved timeline to MP4. 2160 (4K) needs the Ultra plan. Returns a jobId to poll with getExport.', inputSchema: z.object({ projectId: projectIdField, resolution: z.union([z.literal(720), z.literal(1080), z.literal(2160)]).optional(), fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(), quality: z.enum(['draft', 'standard', 'high']).optional() }) },
  getFrames: { description: 'Look at the edit: render 1 to 6 frames of the saved timeline at the given timeline seconds, composited exactly as the export draws them (footage, text, effects). Use it to check framing, captions and effects after editing. Takes about 10-30 seconds.', inputSchema: z.object({ projectId: projectIdField, times: z.array(z.number().min(0)).min(1).max(6) }) },
  getExport: { description: 'Status of an export; a completed export includes a temporary download link.', inputSchema: z.object({ jobId: z.string().min(1) }) },
} as const;
type ProjectToolName = keyof typeof PROJECT_TOOLS;

type JsonSchema = Record<string, unknown> & { properties?: Record<string, unknown>; required?: string[] };
const toJsonSchema = (schema: z.ZodType) => { const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema; return json; };

/** Editing tools act on one project, so each gains a required projectId. */
function withProjectId(schema: JsonSchema): JsonSchema {
  return { ...schema, type: 'object', properties: { projectId: toJsonSchema(projectIdField), ...(schema.properties ?? {}) }, required: ['projectId', ...(schema.required ?? []).filter(name => name !== 'projectId')] };
}

type EditorTool = { description?: string; inputSchema: z.ZodType; execute: (input: unknown, options: unknown) => Promise<unknown> };
// Tool definitions are pure closures; only their execution touches ctx or the run.
function editorTools(ctx: ActionCtx, options: Parameters<typeof createEditorToolkit>[1]) {
  const toolkit = createEditorToolkit(ctx, options);
  return { toolkit, tools: Object.fromEntries(Object.entries(toolkit.tools).filter(([name]) => !RUN_SCOPED_TOOLS.has(name))) as unknown as Record<string, EditorTool> };
}

const catalogOptions = (): Parameters<typeof createEditorToolkit>[1] => ({
  run: { projectId: 'catalog' as Id<'projects'>, ownerId: 'catalog', runId: 'catalog' },
  project: { timeline: { clips: [], fps: 30, aspectRatio: 'landscape' }, revision: 0, aspectRatio: 'landscape' } as unknown as Doc<'projects'>,
  assets: [], recovering: false, initialPlans: [], selectedClipIds: [], abortSignal: new AbortController().signal, budget: new AssistantRunBudget(),
});

export const listTools = internalAction({ args: {}, returns: v.array(v.object({ name: v.string(), description: v.string(), inputSchema: v.any() })), handler: async (ctx): Promise<{ name: string; description: string; inputSchema: unknown }[]> => {
  const options = catalogOptions();
  try {
    const { tools } = editorTools(ctx, options);
    return [
      ...Object.entries(PROJECT_TOOLS).map(([name, tool]) => ({ name, description: tool.description, inputSchema: toJsonSchema(tool.inputSchema) })),
      ...Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description ?? name, inputSchema: withProjectId(toJsonSchema(tool.inputSchema)) })),
    ];
  } finally { options.budget.dispose(); }
}});

const callResult = v.object({ text: v.string(), isError: v.boolean(), images: v.optional(v.array(v.object({ data: v.string(), mimeType: v.string() }))) });
type CallResult = { text: string; isError: boolean; images?: { data: string; mimeType: string }[] };
const result = (value: unknown, isError = false): CallResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), isError });
const failed = (value: unknown) => !!value && typeof value === 'object' && (value as { success?: unknown }).success === false;
const message = (error: unknown) => {
  const data = (error as { data?: unknown })?.data;
  return (typeof data === 'string' ? data : data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : error instanceof Error ? error.message : String(error)).slice(0, 2000);
};

export const callTool = internalAction({ args: { ownerId: v.string(), name: v.string(), arguments: v.any() }, returns: callResult, handler: async (ctx, args): Promise<CallResult> => {
  const input = args.arguments && typeof args.arguments === 'object' ? args.arguments as Record<string, unknown> : {};
  try {
    if (args.name in PROJECT_TOOLS) return await callProjectTool(ctx, args.ownerId, args.name as ProjectToolName, input);
    return await callEditorTool(ctx, args.ownerId, args.name, input);
  } catch (error) { return result(message(error), true); }
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
    case 'getMediaTask': return result(await ctx.runQuery(internal.mcp.mediaTask, { ownerId, taskId: input.taskId }));
    case 'exportVideo': return result(await ctx.runMutation(internal.mcp.startExport, { ownerId, projectId: input.projectId, resolution: input.resolution ?? 1080, fps: input.fps ?? 30, quality: input.quality ?? 'high' }));
    case 'getFrames': {
      const snapshotId = await ctx.runMutation(internal.mcp.requestFrames, { ownerId, projectId: input.projectId, times: input.times });
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
    case 'getExport': {
      const { output, ...job } = await ctx.runQuery(internal.mcp.exportJob, { ownerId, jobId: input.jobId });
      const downloadUrl = output ? await mediaDownloadUrl(ctx, { storageId: output.storageId, r2Key: output.r2Key }, output.fileName) : null;
      return result({ ...job, ...(downloadUrl ? { downloadUrl } : {}) });
    }
  }
}

async function callEditorTool(ctx: ActionCtx, ownerId: string, name: string, raw: Record<string, unknown>): Promise<CallResult> {
  const { projectId: rawProjectId, ...rawInput } = raw;
  if (typeof rawProjectId !== 'string' || !rawProjectId) return result('projectId is required. Call listProjects to find it.', true);
  // Validate before locking the project, against the same schema the run will use.
  const catalog = catalogOptions(), known = editorTools(ctx, catalog).tools[name];
  catalog.budget.dispose();
  if (!known) return result(`Unknown tool ${name}.`, true);
  const parsed = known.inputSchema.safeParse(rawInput);
  if (!parsed.success) return result(`Invalid arguments: ${z.prettifyError(parsed.error)}`, true);

  const { projectId, runId } = await ctx.runMutation(internal.mcp.beginRun, { ownerId, projectId: rawProjectId });
  const run = { projectId, ownerId, runId };
  const controller = new AbortController(), budget = new AssistantRunBudget();
  const abortSignal = AbortSignal.any([controller.signal, budget.signal]);
  // Stop in the editor ends the run; abort promptly like an in-app turn.
  const watch = setInterval(() => { void ctx.runQuery(internal.assistant.isRunActive, run).then(active => { if (!active) controller.abort(); }).catch(() => controller.abort()); }, 2000);
  try {
    const { project, assets } = await ctx.runQuery(internal.assistant.getRun, run);
    const { toolkit, tools } = editorTools(ctx, { run, project, assets, recovering: false, initialPlans: [], selectedClipIds: [], abortSignal, budget });
    const tool = tools[name];
    const output = await tool.execute.call({ ...tool, ctx }, parsed.data, { toolCallId: crypto.randomUUID(), messages: [], abortSignal });
    // A destructive edit is staged privately; publish it as this call's one saved edit.
    const published = failed(output) ? false : await toolkit.editSession.complete('stop');
    return result(published && output && typeof output === 'object' ? { ...output, applied: true, saved: true, staged: false, revision: toolkit.editSession.revision } : output, failed(output));
  } catch (error) {
    return result(abortSignal.aborted && !budget.signal.aborted ? 'Stopped in the editor before this edit finished. Saved edits remain.' : message(error), true);
  } finally {
    clearInterval(watch); budget.dispose();
    await ctx.runMutation(internal.assistant.finish, run);
  }
}
