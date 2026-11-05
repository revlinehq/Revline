import type { ObjectType } from 'convex/values';
import { internal } from '../_generated/api';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { assistantRunArgs } from './assistant_run';

// The editor's agent loop runs on Cloudflare (cloudflare/agent-runner, an Agents SDK agent per run), where one
// model step can think for as long as it needs. It reaches this deployment's functions through /agent-runner/* in http.ts.
// AGENT_RUNNER_SECRET signs calls both ways and is shared with the Worker; AGENT_RUNNER_RUN_KEY stays in Convex.
export const agentRunnerConfigured = () => !!process.env.AGENT_RUNNER_URL && !!process.env.AGENT_RUNNER_SECRET && !!process.env.AGENT_RUNNER_RUN_KEY;
export const WATCH_INTERVAL_MS = 60_000;
export const turnRow = (ctx: QueryCtx, runId: string) => ctx.db.query('agentRunnerTurns').withIndex('by_runId', q => q.eq('runId', runId)).unique();

/** Dispatch a turn to the runner: one turn row per run, then start it and watch its heartbeat. */
export async function startRunnerTurn(ctx: MutationCtx, args: ObjectType<typeof assistantRunArgs>) {
  const previous=await turnRow(ctx,args.runId);
  if(previous)await ctx.db.delete(previous._id);
  await ctx.db.insert('agentRunnerTurns', { runId: args.runId, projectId: args.projectId, ownerId: args.ownerId, attempts: 0, seenAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.agentRunner.start, args);
  await ctx.scheduler.runAfter(WATCH_INTERVAL_MS, internal.agentRunner.watch, { runId: args.runId });
}

/** The stop mutation's half: only runs started on the runner have one to stop. */
export async function stopRunnerTurn(ctx: MutationCtx, runId: string) {
  if (agentRunnerConfigured() && await turnRow(ctx, runId)) await ctx.scheduler.runAfter(0, internal.agentRunner.stop, { runId });
}
