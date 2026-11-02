import { v, ConvexError } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { incidentArgs, incidentDeployment, recordIncident } from './lib/incidents';
import { incidentText } from '../lib/incidents';
import { z } from 'zod';
import { requireOwner, requireProject } from './lib/auth';

export const reportIncident = internalMutation({ args: incidentArgs, handler: recordIncident });

const runScope = { ownerId: v.string(), projectId: v.id('projects'), runId: v.string() };
export const reportAgent = internalMutation({ args: { ...runScope, toolName: v.string(), inputSummary: v.string(), happened: v.string(), expected: v.string() }, handler: async (ctx, args) => {
  await requireProject(ctx, args.projectId, args.ownerId);
  return await recordIncident(ctx, { source: 'editing-agent', kind: 'agent-report', message: `${args.toolName}: ${args.happened}`, context: { location: 'editing-agent:reportIssue', toolName: args.toolName, inputSummary: args.inputSummary, happened: args.happened, expected: args.expected }, projectId: args.projectId, runId: args.runId, deployment: incidentDeployment() });
} });
export const reportRunner = internalMutation({ args: { ...runScope, message: v.string(), stack: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireProject(ctx, args.projectId, args.ownerId);
  return await recordIncident(ctx, { source: 'cloudflare-agent-runner', kind: 'runner-error', message: args.message, stack: args.stack, context: { location: 'cloudflare/agent-runner:turn' }, projectId: args.projectId, runId: args.runId, deployment: incidentDeployment() });
} });
export const reportMcp = internalMutation({ args: { ownerId: v.string(), projectId: v.optional(v.string()), toolName: v.string(), message: v.string(), stack: v.optional(v.string()) }, handler: async (ctx, args) => {
  const id = args.projectId ? ctx.db.normalizeId('projects', args.projectId) : null;
  const projectId = id ? await requireProject(ctx, id, args.ownerId).then(() => id).catch(() => null) : null;
  return await recordIncident(ctx, { source: 'mcp', kind: 'tool-failure', message: args.message, stack: args.stack, context: { location: 'convex/mcpActions:callTool', toolName: args.toolName }, ...(projectId ? { projectId } : {}), deployment: incidentDeployment() });
} });

export const reportClient = mutation({
  args: { source: v.string(), kind: v.string(), message: v.string(), stack: v.optional(v.string()), context: v.any(), projectId: v.optional(v.string()), runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    if (JSON.stringify(args).length > 20_000) return null;
    // Reuse the existing per-owner window store, with an independent namespace.
    const key = `incidents:${owner}`;
    const rate = await ctx.db.query('mcpUsage').withIndex('by_owner', q => q.eq('ownerId', key)).unique();
    const now = Date.now();
    const current = rate && now - rate.windowStart < 60_000;
    if (current && rate.calls >= 20) return null;
    if (rate) await ctx.db.patch(rate._id, { windowStart: current ? rate.windowStart : now, calls: current ? rate.calls + 1 : 1 });
    else await ctx.db.insert('mcpUsage', { ownerId: key, windowStart: now, calls: 1 });
    const { projectId: rawProjectId, ...report } = args;
    const projectId = rawProjectId ? ctx.db.normalizeId('projects', rawProjectId) : null;
    const allowedProject = projectId ? await requireProject(ctx, projectId, owner).then(() => projectId).catch(() => null) : null;
    return await recordIncident(ctx, { ...report, ...(allowedProject ? { projectId: allowedProject } : {}), deployment: incidentDeployment() });
  },
});

function authorize(secret: string) {
  const expected = process.env.INCIDENT_LISTENER_SECRET;
  if (!expected || secret.length !== expected.length) throw new ConvexError('Unauthorized incident listener');
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference) throw new ConvexError('Unauthorized incident listener');
}
const credentials = { secret: v.string() };
const identity = { ...credentials, id: v.id('incidents'), generation: v.number() };
const claimed = { ...identity, claimToken: v.string() };

export const undelivered = query({ args: credentials, handler: async (ctx, { secret }) => {
  authorize(secret);
  return await ctx.db.query('incidents').withIndex('by_delivery_priority', q => q.eq('delivery', 'pending')).order('desc').take(100);
} });
export const claim = mutation({ args: { ...identity, claimToken: v.string() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (!row || row.generation !== args.generation || row.delivery !== 'pending' || row.status === 'resolved') return false;
  await ctx.db.patch(row._id, { delivery: 'claimed', claimToken: args.claimToken, claimedAt: Date.now() });
  return true;
} });
export const recordPR = mutation({ args: { ...claimed, prUrl: v.string() }, handler: async (ctx, args) => {
  authorize(args.secret);
  if (!/^https:\/\/github\.com\/zuraHQ\/revline-editor\/pull\/[1-9]\d*$/.test(args.prUrl)) throw new ConvexError('Invalid incident PR');
  const row = await ctx.db.get(args.id);
  if (!row || row.generation !== args.generation || row.claimToken !== args.claimToken) throw new ConvexError('Incident claim lost');
  await ctx.db.patch(row._id, { ...(row.status === 'resolved' ? {} : { status: 'pr_open' as const }), delivery: 'finished', prUrl: args.prUrl });
} });
export const failed = mutation({ args: { ...claimed, message: v.string() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (row?.generation === args.generation && row.claimToken === args.claimToken && row.status !== 'resolved' && !row.prUrl) await ctx.db.patch(row._id, { delivery: 'failed', deliveryError: args.message.slice(0, 300) });
} });
export const resolve = mutation({ args: { ...identity, expectedCount: v.number() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (row?.generation === args.generation && row.count === args.expectedCount) await ctx.db.patch(row._id, { status: 'resolved', delivery: 'finished' });
} });
export const retry = mutation({ args: identity, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (row?.generation === args.generation && row.delivery === 'failed' && row.status !== 'resolved') await ctx.db.patch(row._id, { delivery: 'pending', claimToken: undefined, deliveryError: undefined });
} });
export const details = internalQuery({ args: { id: v.id('incidents') }, handler: (ctx, args) => ctx.db.get(args.id) });
export const relatedLogs = query({ args: { ...credentials, id: v.id('incidents') }, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (!row) return [];
  const lines: string[] = [];
  for (const sample of row.samples) {
    lines.push(JSON.stringify(sample));
    const context = z.object({ taskId: z.string().optional() }).catch({}).parse(JSON.parse(sample.context));
    const taskId = context.taskId ? ctx.db.normalizeId('mediaTasks', context.taskId) : null;
    const task = taskId ? await ctx.db.get(taskId) : null;
    if (task && task.projectId === sample.projectId) lines.push(JSON.stringify({ event: 'media-task-state', taskId, kind: task.kind, status: task.status, attempt: task.attempt, error: task.error ? incidentText(task.error) : undefined, updatedAt: task.updatedAt }));
    const runner = sample.runId ? await ctx.db.query('agentRunnerTurns').withIndex('by_runId', q => q.eq('runId', sample.runId!)).unique() : null;
    if (runner && runner.projectId === sample.projectId) lines.push(JSON.stringify({ event: 'runner-state', runId: sample.runId, attempts: runner.attempts, seenAt: runner.seenAt }));
  }
  return lines;
} });
