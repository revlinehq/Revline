import { v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { stepTimingValidator } from './lib/step_timing_validator';
import type { StepTiming } from '../lib/ai/step-timing';

// Per-step timing of assistant runs: tool names, start times, durations and token counts. No user content and no owner.
const KEEP_MS = 30 * 24 * 60 * 60_000, MAX_STEPS = 600;

/** Add a run's new timings to its row. Timing is never worth failing a step for, so callers ignore a rejection. */
export async function appendRunTimings(ctx: MutationCtx, run: { runId: string; source: 'editor' | 'mcp'; lane?: string; model?: string; effort?: string }, steps: StepTiming[]) {
  if (!steps.length) return;
  const now = Date.now(), row = await ctx.db.query('assistantRunTimings').withIndex('by_run', q => q.eq('runId', run.runId)).unique();
  const facts = { ...(run.lane ? { lane: run.lane } : {}), ...(run.model ? { model: run.model } : {}), ...(run.effort ? { effort: run.effort } : {}) };
  if (!row) await ctx.db.insert('assistantRunTimings', { runId: run.runId, source: run.source, ...facts, startedAt: Math.min(now, ...steps.map(step => step.at)), updatedAt: now, expiresAt: now + KEEP_MS, steps: steps.slice(0, MAX_STEPS) });
  else if (row.steps.length < MAX_STEPS) await ctx.db.patch(row._id, { ...facts, updatedAt: now, steps: [...row.steps, ...steps].slice(0, MAX_STEPS) });
}

export const record = internalMutation({
  args: { runId: v.string(), source: v.union(v.literal('editor'), v.literal('mcp')), lane: v.optional(v.string()), model: v.optional(v.string()), effort: v.optional(v.string()), steps: v.array(stepTimingValidator) },
  returns: v.null(),
  handler: async (ctx, args) => { const { steps, ...run } = args; await appendRunTimings(ctx, run, steps); return null; },
});

export const prune = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const expired = await ctx.db.query('assistantRunTimings').withIndex('by_expires', q => q.lt('expiresAt', Date.now())).take(50);
  for (const row of expired) await ctx.db.delete(row._id);
  return null;
} });

/** Runs that started in [from, to), oldest first, for `npm run incidents:speed`. Metadata only. */
export const range = internalQuery({
  args: { from: v.number(), to: v.number(), cursor: v.optional(v.union(v.string(), v.null())), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('assistantRunTimings').withIndex('by_started', q => q.gte('startedAt', args.from).lt('startedAt', args.to)).paginate({ cursor: args.cursor ?? null, numItems: Math.min(Math.max(args.limit ?? 50, 1), 100) });
    return { runs: page.page.map(({ _id: _row, _creationTime: _created, expiresAt: _expires, ...run }) => run), cursor: page.isDone ? null : page.continueCursor };
  },
});
