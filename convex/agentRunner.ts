import { v, convexToJson, type ObjectType } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { assistantRunArgs } from './lib/assistant_run';
import { runArgs, runIsActive } from './lib/active_run';
import { resumeInterruptedTurn,turnForRun } from './assistantTurnRecovery';
import { RUNNER_REQUEST_WINDOW_MS, runToken, runnerSignature } from './lib/runner_auth';

// The editor's agent loop runs on Cloudflare (cloudflare/agent-runner, an Agents SDK agent per run), where one
// model step can think for as long as it needs. It reaches this deployment's functions through /agent-runner/* in http.ts.
// AGENT_RUNNER_SECRET signs calls both ways and is shared with the Worker; AGENT_RUNNER_RUN_KEY stays in Convex.
export const agentRunnerConfigured = () => !!process.env.AGENT_RUNNER_URL && !!process.env.AGENT_RUNNER_SECRET && !!process.env.AGENT_RUNNER_RUN_KEY;
/** The runner resumes a turn Cloudflare evicted; each resumption continues the same request from the saved timeline. */
const MAX_ATTEMPTS = 3;
const HEARTBEAT_STALE_MS = 3 * 60_000;
const WATCH_INTERVAL_MS = 60_000;
const INTERRUPTED = 'The editing request was interrupted. Your saved edits are still here. Retry unfinished steps to continue.';
/** A run's files the runner may read back: message attachments and what it stored itself. */
const MAX_STORAGE_GRANTS = 500;

export async function startRunnerTurn(ctx: MutationCtx, args: ObjectType<typeof assistantRunArgs>) {
  const previous=await turnRow(ctx,args.runId);
  if(previous)await ctx.db.delete(previous._id);
  await ctx.db.insert('agentRunnerTurns', { runId: args.runId, projectId: args.projectId, ownerId: args.ownerId, attempts: 0, seenAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.agentRunner.start, args);
  await ctx.scheduler.runAfter(WATCH_INTERVAL_MS, internal.agentRunner.watch, { runId: args.runId });
}

/** A signed call to the runner Worker. */
async function callRunner(path: '/runs' | '/runs/stop', body: string) {
  const url = `${process.env.AGENT_RUNNER_URL!.replace(/\/+$/, '')}${path}`;
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...await runnerSignature(process.env.AGENT_RUNNER_SECRET!, 'POST', url, body) }, body });
  if (!response.ok) throw new Error(`The agent runner answered ${response.status} on ${path}.`);
  await response.body?.cancel();
}

export const start = internalAction({ args: assistantRunArgs, returns: v.null(), handler: async (ctx, args) => {
  try {
    const token = await runToken(process.env.AGENT_RUNNER_RUN_KEY!, { runId: args.runId, ownerId: args.ownerId, projectId: args.projectId, threadId: args.threadId });
    await callRunner('/runs', JSON.stringify({ args: convexToJson(args), runToken: token }));
  }
  catch (error) {
    console.error(`[agent-runner] ${JSON.stringify({ event: 'start-failed', projectId: args.projectId, runId: args.runId, error: error instanceof Error ? error.message : 'unknown' })}`);
    await ctx.runMutation(internal.agentRunner.settle, { projectId: args.projectId, ownerId: args.ownerId, runId: args.runId,segment:args.continuation?.segment??0, error: 'The editing service could not start this request. Try again.' });
  }
  return null;
}});

/** Stop pressed: the turn would notice within two seconds anyway, this ends its model call at once. */
export const stop = internalAction({ args: { runId: v.string() }, returns: v.null(), handler: async (_ctx, { runId }) => {
  await callRunner('/runs/stop', JSON.stringify({ runId })).catch(error => console.warn(`[agent-runner] ${JSON.stringify({ event: 'stop-failed', runId, error: error instanceof Error ? error.message : 'unknown' })}`));
  return null;
}});

/** The stop mutation's half: only runs started on the runner have one to stop. */
export async function stopRunnerTurn(ctx: MutationCtx, runId: string) {
  if (agentRunnerConfigured() && await turnRow(ctx, runId)) await ctx.scheduler.runAfter(0, internal.agentRunner.stop, { runId });
}

const turnRow = (ctx: QueryCtx, runId: string) => ctx.db.query('agentRunnerTurns').withIndex('by_runId', q => q.eq('runId', runId)).unique();

/** The runner's first call of each attempt. Null when the run is over; otherwise which attempt this is. Later
 * calls must carry this claim, so an attempt Cloudflare replaced can no longer act for the run. */
export const claim = internalMutation({ args: { ...runArgs, claimId: v.string() }, returns: v.union(v.null(), v.object({ attempt: v.number(), maxAttempts: v.number() })), handler: async (ctx, args) => {
  const row = await turnRow(ctx, args.runId);
  if (!row || !await runIsActive(ctx, args)) return null;
  if(row.claimId===args.claimId)return {attempt:0,maxAttempts:MAX_ATTEMPTS};
  if(row.attempts>0){
    if(!await resumeInterruptedTurn(ctx,args.runId,INTERRUPTED))await ctx.runMutation(internal.assistant.finish,{projectId:args.projectId,ownerId:args.ownerId,runId:args.runId,error:INTERRUPTED});
    return null;
  }
  await ctx.db.patch(row._id, { attempts: row.attempts + 1, claimId: args.claimId, seenAt: Date.now() });
  return { attempt: row.attempts, maxAttempts: MAX_ATTEMPTS };
}});

/** A bridge request's nonce, once: false when it was already used. It touches only its own nonce, so parallel
 * calls never conflict; the heartbeat clears expired ones. */
export const useNonce = internalMutation({ args: { nonce: v.string() }, returns: v.boolean(), handler: async (ctx, { nonce }) => {
  if (await ctx.db.query('agentRunnerNonces').withIndex('by_nonce', q => q.eq('nonce', nonce)).first()) return false;
  await ctx.db.insert('agentRunnerNonces', { nonce, expiresAt: Date.now() + 2 * RUNNER_REQUEST_WINDOW_MS });
  return true;
}});

/** For the bridge (agentRunnerHttp.ts): whether a run is still on the runner, and who claimed it. */
export const turnState = internalQuery({ args: { runId: v.string() }, returns: v.union(v.null(), v.object({ ownerId: v.string(), projectId: v.string(), claimId: v.optional(v.string()), storageIds: v.array(v.string()) })), handler: async (ctx, { runId }) => {
  const row = await turnRow(ctx, runId);
  return row ? { ownerId: row.ownerId, projectId: row.projectId, ...(row.claimId ? { claimId: row.claimId } : {}), storageIds: row.storageIds ?? [] } : null;
}});

export const grantStorage = internalMutation({ args: { runId: v.string(), storageIds: v.array(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const row = await turnRow(ctx, args.runId);
  if (row) await ctx.db.patch(row._id, { storageIds: [...new Set([...(row.storageIds ?? []), ...args.storageIds])].slice(-MAX_STORAGE_GRANTS) });
  return null;
}});

/** Older media kept in Convex storage: a link only for this owner's own project. */
export const projectStorage = internalQuery({ args: { ownerId: v.string(), projectId: v.id('projects'), storageId: v.string() }, returns: v.boolean(), handler: async (ctx, args) => {
  const storageId = ctx.db.system.normalizeId('_storage', args.storageId);
  if (!storageId) return false;
  const asset = await ctx.db.query('assets').withIndex('by_owner_storageId', q => q.eq('ownerId', args.ownerId).eq('storageId', storageId)).first();
  return asset?.projectId === args.projectId;
}});

/** The runner's last call for a run it finished: nothing may act for it any more. */
export const release = internalMutation({ args: runArgs, returns: v.null(), handler: async (ctx, args) => {
  const row = await turnRow(ctx, args.runId);
  if (row && !await runIsActive(ctx, args)) await ctx.db.delete(row._id);
  return null;
}});

export const heartbeat = internalMutation({ args: runArgs, returns: v.boolean(), handler: async (ctx, args) => {
  for (const stale of await ctx.db.query('agentRunnerNonces').withIndex('by_expiresAt', q => q.lt('expiresAt', Date.now())).take(500)) await ctx.db.delete(stale._id);
  const row = await turnRow(ctx, args.runId);
  if (!row) return false;
  await ctx.db.patch(row._id, { seenAt: Date.now() });
  return await runIsActive(ctx, args);
}});

/** The runner ended without finishing the run itself (a crash, or too many restarts). */
export const settle = internalMutation({ args: { ...runArgs, error: v.optional(v.string()),segment:v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  const turn=await turnForRun(ctx,args.runId);
  if(args.segment!==undefined&&turn&&turn.segment!==args.segment)return null;
  const row = await turnRow(ctx, args.runId);
  if (row) await ctx.db.delete(row._id);
  if (await runIsActive(ctx, args)&&!await resumeInterruptedTurn(ctx,args.runId,args.error??INTERRUPTED)) await ctx.runMutation(internal.assistant.finish, { projectId: args.projectId, ownerId: args.ownerId, runId: args.runId, error: args.error ?? INTERRUPTED });
  return null;
}});

/** Ends a run whose runner went silent, so the editor never waits on a turn that is gone. */
export const watch = internalMutation({ args: { runId: v.string() }, returns: v.null(), handler: async (ctx, { runId }) => {
  const row = await turnRow(ctx, runId);
  if (!row) return null;
  const run = { projectId: row.projectId, ownerId: row.ownerId, runId };
  if (!await runIsActive(ctx, run)) { await ctx.db.delete(row._id); return null; }
  if (Date.now() - row.seenAt > HEARTBEAT_STALE_MS) {
    console.error(`[agent-runner] ${JSON.stringify({ event: 'runner-silent', projectId: row.projectId, runId, attempts: row.attempts })}`);
    await ctx.db.delete(row._id);
    if(!await resumeInterruptedTurn(ctx,runId,INTERRUPTED))await ctx.runMutation(internal.assistant.finish, { ...run, error: INTERRUPTED });
    return null;
  }
  await ctx.scheduler.runAfter(WATCH_INTERVAL_MS, internal.agentRunner.watch, { runId });
  return null;
}});
