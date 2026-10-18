import { ConvexError, v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireOwner } from './lib/auth';
import { projectIdentity } from './lib/project_data';
import { aiCostRecordFields, aiCostSummary, aiCostTurnReport } from './lib/ai_cost';
import { aggregateEditorCosts, COST_HISTORY_LIMIT, costDashboardEnabled, costPeriod, summarizeEditorCosts } from '../lib/ai/cost-history';

/** Development diagnostics. Owner comes from the saved project, never a public argument. */
export const record = internalMutation({
  args: { projectId: v.id('projects'), runId: v.string(), threadId:v.optional(v.string()),promptMessageId:v.optional(v.string()), record: v.object(aiCostRecordFields) }, returns: v.null(),
  handler: async (ctx, args) => {
    if (!costDashboardEnabled()) return null;
    const project = await projectIdentity(ctx, args.projectId);
    if((args.threadId===undefined)!==(args.promptMessageId===undefined)||args.threadId!==undefined&&args.threadId!==project.threadId)throw new ConvexError('Cost conversation does not match this project');
    const existing = await ctx.db.query('aiCostRecords').withIndex('by_run_key', q => q.eq('runId', args.runId).eq('key', args.record.key)).unique();
    if (existing) {
      if (existing.projectId !== args.projectId) throw new ConvexError('Cost record belongs to another project');
      return null;
    }
    await ctx.db.insert('aiCostRecords', { ownerId: project.ownerId, projectId: args.projectId, runId: args.runId,...(args.threadId!==undefined?{threadId:args.threadId,promptMessageId:args.promptMessageId}:{}), ...args.record });
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

/** One owner-scoped subscription for the visible chat turns; legacy rows stay unmapped. */
export const turns = query({
  args: { projectId:v.id('projects'),threadId:v.string(),promptMessageIds:v.array(v.string()) }, returns:v.union(v.array(aiCostTurnReport),v.null()),
  handler:async(ctx,args)=>{
    const ownerId=await requireOwner(ctx);
    if(!costDashboardEnabled())return null;
    const project=await projectIdentity(ctx,args.projectId,ownerId);
    if(project.threadId!==args.threadId)throw new ConvexError('Conversation not found');
    if(args.promptMessageIds.length>50||args.promptMessageIds.some(id=>!id||id.length>160)||new Set(args.promptMessageIds).size!==args.promptMessageIds.length)throw new ConvexError('Choose up to 50 unique chat turns');
    const reports=[];
    for(const promptMessageId of args.promptMessageIds){
      const records=await ctx.db.query('aiCostRecords').withIndex('by_owner_project_thread_prompt',q=>q.eq('ownerId',ownerId).eq('projectId',args.projectId).eq('threadId',args.threadId).eq('promptMessageId',promptMessageId)).order('desc').take(65);
      if(!records.length)continue;
      const {summary,breakdown}=aggregateEditorCosts(records.slice(0,64));
      reports.push({promptMessageId,...summary,breakdown,truncated:records.length>64});
    }
    return reports;
  },
});
