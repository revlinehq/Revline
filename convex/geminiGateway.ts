import { v } from 'convex/values';
import { httpAction, internalQuery, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { mediaTaskCredentials, requireMediaTask } from './lib/media_task_auth';
import { aiCostRecordFields } from './lib/ai_cost';
import { costRecordingEnabled } from '../lib/ai/cost-history';
import { fetchGeminiGateway } from './lib/gemini_gateway';
import { GEMINI_GATEWAY_BODY_LIMIT } from '../lib/ai/gemini-routing';

export const authorizeTask = internalQuery({
  args: mediaTaskCredentials, returns: v.null(),
  handler: async (ctx, args) => {
    const task = await requireMediaTask(ctx, args.taskId, args.leaseToken);
    if (!['frames', 'facecam', 'derive', 'review', 'read', 'video', 'understand', 'reference'].includes(task.kind)) throw new Error('This media task cannot call Gemini.');
    return null;
  },
});

/** Lease credentials bind both paid requests and accounting to the running media task. */
export const recordCost = mutation({
  args: { ...mediaTaskCredentials, record: v.object(aiCostRecordFields) }, returns: v.null(),
  handler: async (ctx, args) => {
    const task = await requireMediaTask(ctx, args.taskId, args.leaseToken);
    if (!costRecordingEnabled()) return null;
    if (args.record.kind !== 'model-call' || !args.record.model?.startsWith('gemini-') || !args.record.route) throw new Error('Invalid Gemini cost record.');
    const request = task.analysisRequestId ? await ctx.db.get(task.analysisRequestId) : null;
    const runId = request?.aiRunId ?? `media-${task._id}`;
    const existing = await ctx.db.query('aiCostRecords').withIndex('by_run_key', q => q.eq('runId', runId).eq('key', args.record.key)).unique();
    if (!existing) await ctx.db.insert('aiCostRecords', { ownerId: task.ownerId, projectId: task.projectId, runId, ...args.record });
    return null;
  },
});

export const serve = httpAction(async (ctx, request) => {
  const taskId = request.headers.get('x-media-task-id'), leaseToken = request.headers.get('x-media-lease-token');
  if (!taskId || !leaseToken) return new Response('Media task authentication required.', { status: 401 });
  try { await ctx.runQuery(internal.geminiGateway.authorizeTask, { taskId: taskId as import('./_generated/dataModel').Id<'mediaTasks'>, leaseToken }); }
  catch { return new Response('Media task lease is no longer active.', { status: 401 }); }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > GEMINI_GATEWAY_BODY_LIMIT) return new Response('Gemini gateway requests must fit within 16 MiB.', { status: 413 });
  return fetchGeminiGateway(body, request.signal);
});
