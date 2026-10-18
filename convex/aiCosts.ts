import { ConvexError, v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireOwner } from './lib/auth';
import { projectIdentity } from './lib/project_data';
import { aiCostRecordFields, aiCostSummary } from './lib/ai_cost';
import { COST_HISTORY_LIMIT, costDashboardEnabled, costPeriod, summarizeEditorCosts } from '../lib/ai/cost-history';

/** Development diagnostics. Owner comes from the saved project, never a public argument. */
export const record = internalMutation({
  args: { projectId: v.id('projects'), runId: v.string(), record: v.object(aiCostRecordFields) }, returns: v.null(),
  handler: async (ctx, args) => {
    if (!costDashboardEnabled()) return null;
    const project = await projectIdentity(ctx, args.projectId);
    const existing = await ctx.db.query('aiCostRecords').withIndex('by_run_key', q => q.eq('runId', args.runId).eq('key', args.record.key)).unique();
    if (existing) {
      if (existing.projectId !== args.projectId) throw new ConvexError('Cost record belongs to another project');
      return null;
    }
    await ctx.db.insert('aiCostRecords', { ownerId: project.ownerId, projectId: args.projectId, runId: args.runId, ...args.record });
    return null;
  },
});
export const summary = query({
  args: { days: v.union(v.literal(7), v.literal(30)), timeZone: v.string() }, returns: v.union(aiCostSummary, v.null()),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    if (!costDashboardEnabled()) return null;
    let period;
    try { period = costPeriod(args.days, args.timeZone, Date.now()); } catch { throw new ConvexError('Choose a valid time zone'); }
    const rows = await ctx.db.query('aiCostRecords').withIndex('by_owner_recorded', q => q.eq('ownerId', ownerId).gte('recordedAt', period.start).lte('recordedAt', period.end)).order('desc').take(COST_HISTORY_LIMIT + 1);
    const first = await ctx.db.query('aiCostRecords').withIndex('by_owner_recorded', q => q.eq('ownerId', ownerId)).order('asc').first();
    const { start, end, days, timeZone } = period;
    return { period: { start, end, days, timeZone }, ...summarizeEditorCosts(rows.slice(0, COST_HISTORY_LIMIT), period), truncated: rows.length > COST_HISTORY_LIMIT, recordingSince: first?.recordedAt ?? null };
  },
});
