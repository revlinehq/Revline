import { v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { agentCompany, mcpClientName, MCP_AGENT_IDLE_MS, type WorkingAgent } from '../lib/mcp/agent-identity';

const scope = { ownerId: v.string(), connectionId: v.string() };
export const clientInfoValidator = v.object({ name: v.string(), title: v.optional(v.string()), version: v.string() });
export const workingAgentValidator = v.object({ id: v.string(), name: v.string(), company: v.union(v.literal('claude'), v.literal('openai'), v.literal('gemini'), v.literal('antigravity'), v.literal('cursor'), v.literal('mcp')), timelineId: v.string(), until: v.number() });

export const initialize = internalMutation({
  args: { ...scope, clientInfo: clientInfoValidator, fallbackName: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const clientInfo = { name: args.clientInfo.name.trim().slice(0, 100), version: args.clientInfo.version.slice(0, 100), ...(args.clientInfo.title?.trim() ? { title: args.clientInfo.title.trim().slice(0, 100) } : {}) };
    const value = { ownerId: args.ownerId, connectionId: args.connectionId, clientInfo, agentName: mcpClientName(clientInfo, args.fallbackName) };
    const existing = await ctx.db.query('mcpConnections').withIndex('by_connection', q => q.eq('ownerId', args.ownerId).eq('connectionId', args.connectionId)).unique();
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('mcpConnections', value);
    return null;
  },
});

export const identity = internalQuery({
  args: scope,
  returns: v.union(v.null(), v.object({ clientId: v.id('mcpConnections'), agentName: v.string(), closed: v.boolean() })),
  handler: async (ctx, args) => {
    const row = await ctx.db.query('mcpConnections').withIndex('by_connection', q => q.eq('ownerId', args.ownerId).eq('connectionId', args.connectionId)).unique();
    return row ? { clientId: row._id, agentName: row.agentName, closed: row.closedAt!==undefined } : null;
  },
});

/** Small indexed lease rows keep project lists independent of timelines and prompts. */
export async function projectWorkingAgents(ctx: QueryCtx, ownerId: string, projectId: Id<'projects'>): Promise<WorkingAgent[]> {
  const rows = await ctx.db.query('mcpLaneSessions').withIndex('by_project_activity', q => q.eq('projectId', projectId).gt('activeUntil', Date.now())).order('desc').take(100);
  const agents = new Map<string, WorkingAgent>();
  for (const row of rows) {
    if (row.ownerId !== ownerId || !row.agentName || !row.activeUntil || row.supersededAt !== undefined) continue;
    const id = row.agentClientId ?? row._id, key = `${id}:${row.timelineId}`;
    if (!agents.has(key)) agents.set(key, { id, name: row.agentName, company: agentCompany(row.agentName), timelineId: row.timelineId, until: row.activeUntil });
  }
  return [...agents.values()];
}

export async function touchTaskAgent(ctx: MutationCtx, ownerId: string, taskId: string, agentName: string, agentClientId?: Id<'mcpConnections'>, startedAt=Date.now()) {
  const row = await ctx.db.query('mcpLaneSessions').withIndex('by_task', q => q.eq('taskId', taskId)).unique();
  if (!row || row.ownerId !== ownerId) return;
  // Calls already in flight when finish succeeds cannot revive its badge.
  if(row.agentEndedAt!==undefined&&row.agentEndedAt>=startedAt)return;
  if(agentClientId&&(await ctx.db.get(agentClientId))?.closedAt!==undefined)return;
  const now = Date.now();
  // Each lease write reruns every open dashboard's project and assistant queries. Keep a lease with
  // more than half its idle window left, so a busy task writes (and schedules expiry) at most every five minutes.
  // A call of a task a newer one hid shows it again at once: touches happen when a call starts, so this agent is still working.
  if (row.supersededAt === undefined && row.agentName === agentName && row.agentClientId === agentClientId && (row.activeUntil ?? 0) > now + MCP_AGENT_IDLE_MS / 2) return;
  const activeUntil = now + MCP_AGENT_IDLE_MS;
  await ctx.db.patch(row._id, { agentName, agentClientId, activeUntil, supersededAt: undefined });
  // Convex queries don't rerun as wall time passes. Retire the lease with a
  // scheduled write so every open dashboard and editor updates at expiry.
  await ctx.scheduler.runAt(activeUntil, internal.mcpConnections.expire, { sessionId: row._id, activeUntil });
}

export const expire = internalMutation({
  args: { sessionId: v.id('mcpLaneSessions'), activeUntil: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (row?.activeUntil === args.activeUntil && row.activeUntil <= Date.now()) await ctx.db.patch(row._id, { activeUntil: undefined });
    return null;
  },
});

export const endTask = internalMutation({
  args: { ownerId: v.string(), taskId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.query('mcpLaneSessions').withIndex('by_task', q => q.eq('taskId', args.taskId)).unique();
    if (row?.ownerId === args.ownerId) await ctx.db.patch(row._id, { activeUntil: undefined, agentEndedAt: Date.now() });
    return null;
  },
});

/** A new task on a tab hides the working badge of every older task still live there. An interrupted agent never
 * calls finish, so without this its badge outlasts it by the full idle lease. Only the badge changes: the lease,
 * task-free continuation, saved edits, lane results and failed attempts stay, and nothing is marked passed.
 * Any later call of a hidden task shows it again (touchTaskAgent clears supersededAt). */
export async function supersedeTabTasks(ctx: MutationCtx, ownerId: string, projectId: Id<'projects'>, timelineId: string, taskId: string) {
  const now = Date.now();
  const rows = await ctx.db.query('mcpLaneSessions').withIndex('by_project_activity', q => q.eq('projectId', projectId).gt('activeUntil', now)).take(100);
  for (const row of rows) {
    if (row.ownerId !== ownerId || row.timelineId !== timelineId || row.taskId === taskId || row.supersededAt !== undefined) continue;
    await ctx.db.patch(row._id, { supersededAt: now });
  }
}

export const close = internalMutation({
  args: scope, returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('mcpLaneSessions').withIndex('by_connection_activity', q => q.eq('ownerId', args.ownerId).eq('connectionId', args.connectionId).gt('activeUntil', 0)).take(100);
    for (const row of rows) await ctx.db.patch(row._id, { activeUntil: undefined });
    if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.mcpConnections.close, args);
    const connection = await ctx.db.query('mcpConnections').withIndex('by_connection', q => q.eq('ownerId', args.ownerId).eq('connectionId', args.connectionId)).unique();
    if (connection) await ctx.db.patch(connection._id,{closedAt:Date.now()});
    return null;
  },
});
