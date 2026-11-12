import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import { incidentArgs, incidentDeployment, incidentFingerprint, recordIncident } from './lib/incidents';
import { z } from 'zod';
import { requireOwner, requireProject } from './lib/auth';
import { incidentNormalized, incidentText, isAgentFiled, limitationIdentity, LIMITATION_CATEGORIES, LIMITATION_IMPACTS } from '../lib/incidents';

export const reportIncident = internalMutation({ args: incidentArgs, handler: recordIncident });

// Agent reports are model-written free text and become public GitHub issues, so
// one account or a burst of accounts cannot flood the table or the publisher.
const DAY = 24 * 60 * 60_000;
const AGENT_REPORT_LIMITS = [
  { scope: 'owner', windowMs: 60_000, limit: 5 },
  { scope: 'owner', windowMs: DAY, limit: 20 },
  { scope: 'all', windowMs: 60_000, limit: 60 },
  { scope: 'all', windowMs: DAY, limit: 1000 },
] as const;
async function allowAgentReport(ctx: MutationCtx, ownerId: string, namespace: 'agent' | 'limitation' = 'agent') {
  const now = Date.now();
  // Check every window before counting, so a refused report consumes no allowance.
  const windows = await Promise.all(AGENT_REPORT_LIMITS.map(async ({ scope, windowMs, limit }) => {
    const key = `incidents:${namespace}:${windowMs}:${scope === 'owner' ? ownerId : '*'}`;
    const usage = await ctx.db.query('mcpUsage').withIndex('by_owner', q => q.eq('ownerId', key)).unique();
    const current = usage && now - usage.windowStart < windowMs;
    return { key, usage, current, calls: current ? usage.calls : 0, limit };
  }));
  if (windows.some(window => window.calls >= window.limit)) return false;
  for (const { key, usage, current, calls } of windows) {
    if (usage) await ctx.db.patch(usage._id, { windowStart: current ? usage.windowStart : now, calls: calls + 1 });
    else await ctx.db.insert('mcpUsage', { ownerId: key, windowStart: now, calls: 1 });
  }
  return true;
}

const runScope = { ownerId: v.string(), projectId: v.id('projects'), runId: v.string() };
export const reportAgent = internalMutation({ args: { ...runScope, toolName: v.string(), inputSummary: v.string(), happened: v.string(), expected: v.string() }, handler: async (ctx, args) => {
  await requireProject(ctx, args.projectId, args.ownerId);
  if (!await allowAgentReport(ctx, args.ownerId)) return null;
  return await recordIncident(ctx, { source: 'editing-agent', kind: 'agent-report', message: `${args.toolName}: ${args.happened}`, context: { location: 'editing-agent:reportIssue', toolName: args.toolName, inputSummary: args.inputSummary, happened: args.happened, expected: args.expected }, projectId: args.projectId, runId: args.runId, deployment: incidentDeployment() });
} });

// A limitation is not a defect: the tools worked as designed but could not do what the user asked. The same
// limitation from any user is one row with a rising count, so the most frequent gaps are the ones patched first.
const LIMITATIONS_PER_RUN = 3;
const literals = <T extends string>(values: readonly [T, T, ...T[]]) => v.union(...values.map(value => v.literal(value)));
export const reportLimitation = internalMutation({ args: {
  ...runScope, scopeId: v.string(), request: v.string(), limitation: v.string(), category: literals(LIMITATION_CATEGORIES), impact: literals(LIMITATION_IMPACTS),
  tool: v.optional(v.string()), workaround: v.optional(v.string()), wanted: v.optional(v.string()), lane: v.optional(v.string()), model: v.optional(v.string()),
}, handler: async (ctx, args): Promise<{ recorded: boolean; repeat?: true; reason?: 'run-limit' | 'rate-limit' }> => {
  await requireProject(ctx, args.projectId, args.ownerId);
  const identity = limitationIdentity(args.category, args.tool, args.limitation);
  const scopeId = incidentText(args.scopeId, 150);
  // The same limitation again in one run is already counted: no new occurrence and no allowance used.
  // The marker is its own row because a busy limitation keeps only its latest four samples.
  const key = `incidents:limitation:run:${scopeId}`, seenKey = `${key}:${(await incidentFingerprint(identity)).slice(-24)}`, now = Date.now();
  if (await ctx.db.query('mcpUsage').withIndex('by_owner', q => q.eq('ownerId', seenKey)).unique()) return { recorded: true, repeat: true };
  const usage = await ctx.db.query('mcpUsage').withIndex('by_owner', q => q.eq('ownerId', key)).unique();
  if ((usage?.calls ?? 0) >= LIMITATIONS_PER_RUN) return { recorded: false, reason: 'run-limit' };
  if (!await allowAgentReport(ctx, args.ownerId, 'limitation')) return { recorded: false, reason: 'rate-limit' };
  if (usage) await ctx.db.patch(usage._id, { calls: usage.calls + 1 });
  else await ctx.db.insert('mcpUsage', { ownerId: key, windowStart: now, calls: 1 });
  await ctx.db.insert('mcpUsage', { ownerId: seenKey, windowStart: now, calls: 1 });
  await recordIncident(ctx, {
    source: 'editing-agent', kind: 'agent-limitation', identity, message: `${args.category}: ${args.tool ?? 'no tool'}: ${args.limitation}`,
    // Absent optional fields are left out; the context filter would otherwise store them as "[omitted]".
    context: Object.fromEntries(Object.entries({ location: 'editing-agent:reportLimitation', toolName: args.tool, request: args.request, limitation: args.limitation, category: args.category, workaround: args.workaround, impact: args.impact, wanted: args.wanted, lane: args.lane, model: args.model }).filter(([, value]) => value !== undefined)),
    projectId: args.projectId, runId: scopeId, deployment: incidentDeployment(),
  });
  return { recorded: true };
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

// What the web app files (lib/incident-client.ts and its callers). Anything else is labelled a generic client report.
const CLIENT_SOURCES = new Set(['client', 'preview', 'editor', 'editor-chat']);
const CLIENT_KINDS = new Set(['user-failure', 'preview-error', 'turn-failure', 'save-confirmation']);
const CLIENT_MESSAGE_LIMIT = 500;
const CLIENT_STACK_LIMIT = 2000;
// Any signed-in account can call this with free text, so its rows never reach the autonomous fixer on their own:
// they wait for triage, earn no priority, never re-open a resolved incident and never merge into a server-filed row.
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
    const known = CLIENT_SOURCES.has(args.source) && CLIENT_KINDS.has(args.kind);
    const source = known ? args.source : 'client', kind = known ? args.kind : 'client-report';
    const message = args.message.slice(0, CLIENT_MESSAGE_LIMIT);
    const location = z.object({ location: z.string() }).catch({ location: '' }).parse(args.context).location;
    const projectId = args.projectId ? ctx.db.normalizeId('projects', args.projectId) : null;
    const allowedProject = projectId ? await requireProject(ctx, projectId, owner).then(() => projectId).catch(() => null) : null;
    return await recordIncident(ctx, {
      source, kind, message, ...(args.stack ? { stack: args.stack.slice(0, CLIENT_STACK_LIMIT) } : {}), context: args.context,
      ...(args.runId ? { runId: args.runId } : {}), ...(allowedProject ? { projectId: allowedProject } : {}), deployment: incidentDeployment(),
      identity: ['client', kind, incidentNormalized(message), incidentNormalized(location)],
    }, { client: true });
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
  return await ctx.db.query('incidents').withIndex('by_delivery_priority', q => q.eq('delivery', 'pending')).filter(q => q.and(q.neq(q.field('needsTriage'), true), q.neq(q.field('kind'), 'agent-limitation'), q.or(q.neq(q.field('kind'), 'agent-report'), q.eq(q.field('issueDispatchReady'), true)))).order('desc').take(100);
} });
export const claim = mutation({ args: { ...identity, claimToken: v.string() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (!row || row.needsTriage || row.kind === 'agent-limitation' || (row.kind === 'agent-report' && !row.issueDispatchReady) || row.generation !== args.generation || row.delivery !== 'pending' || row.status === 'resolved') return false;
  await ctx.db.patch(row._id, { delivery: 'claimed', claimToken: args.claimToken, claimedAt: Date.now() });
  return true;
} });
export const recordPR = mutation({ args: { ...claimed, prUrl: v.string() }, handler: async (ctx, args) => {
  authorize(args.secret);
  if (!/^https:\/\/github\.com\/(?:revlinehq\/Revline|zuraHQ\/(?:Revline|revline-editor))\/pull\/[1-9]\d*$/.test(args.prUrl)) throw new ConvexError('Invalid incident PR');
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
    if (task && task.projectId === sample.projectId) lines.push(JSON.stringify({ event: 'media-task-state', taskId, kind: task.kind, status: task.status, attempt: task.attempt, error: task.error ? row.message : undefined, updatedAt: task.updatedAt }));
    const runner = sample.runId ? await ctx.db.query('agentRunnerTurns').withIndex('by_runId', q => q.eq('runId', sample.runId!)).unique() : null;
    if (runner && runner.projectId === sample.projectId) lines.push(JSON.stringify({ event: 'runner-state', runId: sample.runId, attempts: runner.attempts, seenAt: runner.seenAt }));
  }
  return lines;
} });

// Separate leases on the same durable incident row; old listeners cannot claim these.
export const issueQueue = query({ args: { ...credentials, paginationOpts: paginationOptsValidator, kind: v.optional(v.union(v.literal('agent-report'), v.literal('agent-limitation'))) }, handler: async (ctx, args) => {
  authorize(args.secret);
  return await ctx.db.query('incidents').withIndex('by_kind', q => q.eq('kind', args.kind ?? 'agent-report')).paginate(args.paginationOpts);
} });
export const claimIssue = mutation({ args: { ...claimed, backfill: v.boolean() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  const now = Date.now();
  if (!row || !isAgentFiled(row.kind) || row.generation !== args.generation || (row.issueUrl && (row.issueDeliveredCount ?? 0) >= row.count) ||
    (row.issueAttempts === undefined && !args.backfill) || (row.issueAttempts ?? 0) >= 5 || (row.issueNextAttempt ?? 0) > now ||
    (row.issueDelivery === 'claimed' && (row.issueClaimedAt ?? 0) > now - 600_000)) return false;
  await ctx.db.patch(row._id, { issueDelivery: 'claimed', issueClaimToken: args.claimToken, issueClaimedAt: now, issueAttempts: (row.issueAttempts ?? 0) + 1 });
  return true;
} });
export const finishIssue = mutation({ args: { ...claimed, issueUrl: v.optional(v.string()), count: v.number() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (!row || !isAgentFiled(row.kind) || row.generation !== args.generation || row.issueClaimToken !== args.claimToken) throw new ConvexError('Incident claim lost');
  if (args.issueUrl && !/^https:\/\/github\.com\/(?:revlinehq\/Revline|zuraHQ\/(?:Revline|revline-editor))\/issues\/[1-9]\d*$/.test(args.issueUrl)) throw new ConvexError('Invalid incident issue');
  await ctx.db.patch(row._id, args.issueUrl ? { issueUrl: args.issueUrl, issueDeliveredCount: args.count, issueDelivery: 'finished', issueAttempts: 0, issueNextAttempt: undefined } :
    { issueDelivery: 'failed', issueNextAttempt: Date.now() + Math.min(3600_000, 60_000 * 2 ** (row.issueAttempts ?? 1)) });
} });

// Explicit operator opt-in only, and only for defect reports: a limitation is a feature gap for a person to
// triage, never a fixer job. The existing executor owns concurrency and PR recovery.
export const dispatchIssue = mutation({ args: identity, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (!row || row.kind !== 'agent-report' || !row.issueUrl || row.prUrl || row.status === 'resolved' || row.generation !== args.generation || row.issueDispatchReady) return false;
  await ctx.db.patch(row._id, { issueDispatchReady: true, delivery: 'pending', claimToken: undefined });
  return true;
} });

// An operator read a browser-filed report and wants the fixer to take it: the only way such a row reaches it.
export const triageClient = mutation({ args: identity, handler: async (ctx, args) => {
  authorize(args.secret);
  const row = await ctx.db.get(args.id);
  if (!row?.needsTriage || row.status === 'resolved' || row.generation !== args.generation) return false;
  await ctx.db.patch(row._id, { needsTriage: false, delivery: 'pending', claimToken: undefined });
  return true;
} });
