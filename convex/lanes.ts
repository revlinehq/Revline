import { ConvexError, v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from './_generated/server';
import {
  laneValidator,
  laneBaselineValidator,
  laneEvidenceValidator,
  laneResultValidator,
} from './lib/lane_validators';
import { requireOwner, requireProject } from './lib/auth';
import { activeTabOf, tabsOf, storedTabTimeline } from './timelineTabs';
import { validateTimeline } from './lib/timeline';
import { summarizeTimeline } from './lib/inspectTimeline';
import { laneBaseline, MAX_FINISH_ATTEMPTS } from '../lib/ai/lanes/task';
import { capabilityExists, type LaneId } from '../lib/ai/lanes';
import type { Id } from './_generated/dataModel';
const scope = { ownerId: v.string(), projectId: v.id('projects') };
const taskScope = { ...scope, taskId: v.string() };
const tabState = v.object({
  internalDetailsEnabled: v.boolean(),
  lane: laneValidator,
  manual: v.boolean(),
  reason: v.string(),
  timelineId: v.string(),
});
async function saveTab(
  ctx: MutationCtx,
  ownerId: string,
  projectId: Id<'projects'>,
  timelineId: string,
  lane: LaneId,
  reason: string,
  manual = false,
) {
  const project = await requireProject(ctx, projectId, ownerId);
  if (!tabsOf(project).some((tab) => tab.id === timelineId))
    throw new ConvexError('Timeline no longer exists.');
  const row = await ctx.db
    .query('editingLaneTabs')
    .withIndex('by_project_tab', (q) =>
      q.eq('projectId', projectId).eq('timelineId', timelineId),
    )
    .unique();
  const value = {
    ownerId,
    projectId,
    timelineId,
    lane,
    reason: reason.slice(0, 300),
    manual,
  };
  if (row) await ctx.db.patch(row._id, value);
  else await ctx.db.insert('editingLaneTabs', value);
}
export const current = query({
  args: { projectId: v.id('projects'), timelineId: v.optional(v.string()) },
  returns: tabState,
  handler: async (ctx, args) => {
    const project = await requireProject(
        ctx,
        args.projectId,
        await requireOwner(ctx),
      ),
      timelineId = args.timelineId ?? activeTabOf(project);
    const row = await ctx.db
      .query('editingLaneTabs')
      .withIndex('by_project_tab', (q) =>
        q.eq('projectId', args.projectId).eq('timelineId', timelineId),
      )
      .unique();
    return {
      internalDetailsEnabled:
        process.env.EDITOR_INTERNAL_DETAILS_ENABLED === 'true',
      lane: row?.lane === 'explainer' ? 'edit' : row?.lane ?? 'edit',
      manual: row?.manual ?? false,
      reason: row?.reason ?? 'General editing default',
      timelineId,
    };
  },
});
export const choose = mutation({
  args: {
    projectId: v.id('projects'),
    timelineId: v.string(),
    lane: laneValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.lane === 'explainer') throw new ConvexError('Choose an available workflow.');
    const ownerId = await requireOwner(ctx),
      project = await requireProject(ctx, args.projectId, ownerId);
    if (project.aiRunning)
      throw new ConvexError(
        'Wait for the current task before changing its lane.',
      );
    await saveTab(
      ctx,
      ownerId,
      args.projectId,
      args.timelineId,
      args.lane,
      args.lane === 'edit' ? 'Automatic style' : 'User-selected style',
      args.lane !== 'edit',
    );
    return null;
  },
});
export const forRun = internalQuery({
  args: scope,
  returns: v.union(v.null(), tabState),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId),
      timelineId = activeTabOf(project);
    const row = await ctx.db
      .query('editingLaneTabs')
      .withIndex('by_project_tab', (q) =>
        q.eq('projectId', args.projectId).eq('timelineId', timelineId),
      )
      .unique();
    return row
      ? {
          internalDetailsEnabled:
            process.env.EDITOR_INTERNAL_DETAILS_ENABLED === 'true',
          lane: row.lane === 'explainer' ? 'edit' : row.lane,
          manual: row.manual,
          reason: row.reason,
          timelineId,
        }
      : null;
  },
});
export const forTab = internalQuery({
  args: { ...scope, timelineId: v.string() },
  returns: v.union(v.null(), tabState),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db
      .query('editingLaneTabs')
      .withIndex('by_project_tab', (q) =>
        q.eq('projectId', args.projectId).eq('timelineId', args.timelineId),
      )
      .unique();
    return row
      ? {
          internalDetailsEnabled:
            process.env.EDITOR_INTERNAL_DETAILS_ENABLED === 'true',
          lane: row.lane === 'explainer' ? 'edit' : row.lane,
          manual: row.manual,
          reason: row.reason,
          timelineId: args.timelineId,
        }
      : null;
  },
});
export const task = internalQuery({
  args: taskScope,
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db
      .query('editingLaneTasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .unique();
    if (
      row &&
      (row.projectId !== args.projectId || row.ownerId !== args.ownerId)
    )
      throw new ConvexError('Task not found.');
    return row;
  },
});
export const begin = internalMutation({
  args: {
    ...taskScope,
    lane: laneValidator,
    lockedLane: v.optional(laneValidator),
    laneChosen: v.optional(v.boolean()),
    manual: v.optional(v.boolean()),
    reason: v.string(),
    exportConfirmed: v.boolean(),
    required: v.boolean(),
    timelineId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId),
      timelineId = args.timelineId ?? activeTabOf(project);
    const existing = await ctx.db
      .query('editingLaneTasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .unique();
    if (existing) {
      if (
        existing.ownerId !== args.ownerId ||
        existing.projectId !== args.projectId
      )
        throw new ConvexError('Task not found.');
      return null;
    }
    const timeline = await storedTabTimeline(ctx, project, timelineId);
    if (!timeline) throw new ConvexError('Timeline not found.');
    const assets = await ctx.db
      .query('assets')
      .withIndex('by_ownerId_projectId', (q) =>
        q.eq('ownerId', args.ownerId).eq('projectId', args.projectId),
      )
      .take(400);
    if (args.laneChosen !== false) await saveTab(
      ctx,
      args.ownerId,
      args.projectId,
      timelineId,
      args.lane,
      args.reason,
      args.manual ?? false,
    );
    await ctx.db.insert('editingLaneTasks', {
      ownerId: args.ownerId,
      projectId: args.projectId,
      taskId: args.taskId,
      lane: args.lane,
      laneChosen: args.laneChosen ?? true,
      manual: args.manual ?? false,
      ...(args.lockedLane ? { lockedLane: args.lockedLane } : {}),
      attempts: 0,
      exportConfirmed: args.exportConfirmed,
      required: args.required,
      initialTabIds: tabsOf(project).map((tab) => tab.id),
      baselines: [
        await laneBaseline(
          timelineId,
          timeline,
          summarizeTimeline(timeline, assets).gaps,
        ),
      ],
      evidence: [],
      createdAt: Date.now(),
    });
    return null;
  },
});
export const switchLane = internalMutation({
  args: {
    ...taskScope,
    timelineId: v.string(),
    lane: laneValidator,
    reason: v.string(),
    taskType: v.optional(v.union(v.literal('edit'), v.literal('question'))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db
      .query('editingLaneTasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .unique();
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.projectId !== args.projectId
    )
      throw new ConvexError('Start a task first.');
    if (row.laneChosen === false && !args.taskType)
      throw new ConvexError('Choose taskType edit or question with the lane.');
    if (row.lockedLane && args.lane !== row.lockedLane)
      throw new ConvexError(
        `This task was explicitly selected for the ${row.lockedLane} lane. Start a new user request to change the work; missing tools are not a lane change.`,
      );
    if (row.attempts >= MAX_FINISH_ATTEMPTS)
      throw new ConvexError(
        'This task exhausted its finish checks. Report the remaining failures; start a new user request to continue.',
      );
    await saveTab(
      ctx,
      args.ownerId,
      args.projectId,
      args.timelineId,
      args.lane,
      args.reason,
      row.manual ?? false,
    );
    // Switching never resets attempts or manufactures completion evidence.
    await ctx.db.patch(row._id, { lane: args.lane === 'explainer' ? 'edit' : args.lane, laneChosen: true, required: row.required || args.taskType === 'edit', result: undefined });
    return null;
  },
});
/** Supporting capabilities belong to the existing owner-checked task. */
export const loadCapability = internalMutation({
  args: { ...taskScope, name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db.query('editingLaneTasks').withIndex('by_task', q => q.eq('taskId', args.taskId)).unique();
    if (!row || row.ownerId !== args.ownerId || row.projectId !== args.projectId) throw new ConvexError('Task not found.');
    if (!capabilityExists(args.name)) throw new ConvexError('Unknown supporting capability. Use discoverCapabilities first.');
    if (row.attempts >= MAX_FINISH_ATTEMPTS) throw new ConvexError('This task exhausted its finish checks.');
    await ctx.db.patch(row._id, { capabilities: [...new Set([...(row.capabilities ?? []), args.name])] });
    return null;
  },
});
export const baseline = internalMutation({
  args: { ...taskScope, baseline: laneBaselineValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db
      .query('editingLaneTasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .unique();
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.projectId !== args.projectId
    )
      throw new ConvexError('Task not found.');
    if (
      !row.baselines.some(
        (item) => item.timelineId === args.baseline.timelineId,
      )
    )
      await ctx.db.patch(row._id, {
        baselines: [...row.baselines, args.baseline],
        result: undefined,
      });
    return null;
  },
});
export const evidence = internalMutation({
  args: { ...taskScope, evidence: laneEvidenceValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db
      .query('editingLaneTasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .unique();
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.projectId !== args.projectId
    )
      throw new ConvexError('Task not found.');
    const previous = row.evidence.filter(
      (item) =>
        item.timelineId !== args.evidence.timelineId ||
        item.tool !== args.evidence.tool ||
        JSON.stringify(item.input) !== JSON.stringify(args.evidence.input),
    );
    const evidence = [...previous, args.evidence].slice(-120);
    while (
      evidence.length > 1 &&
      new TextEncoder().encode(JSON.stringify(evidence)).length > 650_000
    )
      evidence.shift();
    if (new TextEncoder().encode(JSON.stringify(evidence)).length > 650_000)
      throw new ConvexError(
        'Check output is too large to retain. Check shorter contiguous windows.',
      );
    await ctx.db.patch(row._id, { evidence });
    return null;
  },
});
export const validate = internalMutation({
  args: { ...scope, timeline: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId);
    await validateTimeline(ctx, project, args.timeline);
    return null;
  },
});
export const recordFinish = internalMutation({
  args: { ...taskScope, result: laneResultValidator },
  returns: laneResultValidator,
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db
      .query('editingLaneTasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .unique();
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.projectId !== args.projectId
    )
      throw new ConvexError('Task not found.');
    if (row.attempts >= MAX_FINISH_ATTEMPTS) return row.result!;
    const attempt = row.attempts + 1,
      result = {
        ...args.result,
        lane: row.lane === 'explainer' ? 'edit' : row.lane,
        attempt,
        exhausted: !args.result.passed && attempt >= MAX_FINISH_ATTEMPTS,
      };
    await ctx.db.patch(row._id, {
      attempts: args.result.passed ? row.attempts : attempt,
      result,
    });
    return result;
  },
});
export const mcpSession = internalQuery({
  args: { ownerId: v.string(), connectionId: v.optional(v.string()), projectId: v.optional(v.string()), timelineId: v.optional(v.string()), taskId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.taskId) {
      const row = await ctx.db.query('mcpLaneSessions').withIndex('by_task', q => q.eq('taskId', args.taskId!)).unique();
      if (!row || row.ownerId !== args.ownerId || args.projectId && row.projectId !== args.projectId) return null;
      return row;
    }
    if (!args.connectionId) {
      // A sessionless call names no task, so it may only continue the one live, unfinished sessionless
      // task on that tab. A finished or idle task never lends a later sessionless call its target.
      if (!args.projectId || !args.timelineId) return null;
      const projectId = ctx.db.normalizeId('projects', args.projectId);
      if (!projectId) return null;
      let match = null;
      for (const row of await ctx.db.query('mcpLaneSessions').withIndex('by_project_activity', q => q.eq('projectId', projectId).gt('activeUntil', Date.now())).take(100)) {
        if (row.ownerId !== args.ownerId || row.timelineId !== args.timelineId || row.connectionId !== `task:${row.taskId}` || row.agentEndedAt !== undefined) continue;
        if (match) return null;
        match = row;
      }
      return match;
    }
    if (!args.projectId) return ctx.db.query('mcpLaneSessions').withIndex('by_connection', q => q.eq('ownerId', args.ownerId).eq('connectionId', args.connectionId!)).order('desc').first();
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (!projectId) return null;
    return ctx.db.query('mcpLaneSessions').withIndex('by_connection_target', q => {
      const target = q.eq('ownerId', args.ownerId).eq('connectionId', args.connectionId!).eq('projectId', projectId);
      return args.timelineId ? target.eq('timelineId', args.timelineId) : target;
    }).order('desc').first();
  },
});
export const setMcpSession = internalMutation({
  args: {
    ...taskScope,
    connectionId: v.string(),
    timelineId: v.string(),
    lane: laneValidator,
    laneChosen: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db.query('mcpLaneSessions').withIndex('by_task', q => q.eq('taskId', args.taskId)).unique();
    if (row && (row.ownerId !== args.ownerId || row.projectId !== args.projectId)) throw new ConvexError('Task not found.');
    if (row) await ctx.db.patch(row._id, args);
    else await ctx.db.insert('mcpLaneSessions', args);
    return null;
  },
});
export const timelines = internalQuery({
  args: taskScope,
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId),
      row = await ctx.db
        .query('editingLaneTasks')
        .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
        .unique();
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.projectId !== args.projectId
    )
      throw new ConvexError('Task not found.');
    return Promise.all(
      row.baselines.map(async (baseline) => ({
        timelineId: baseline.timelineId,
        timeline: await storedTabTimeline(ctx, project, baseline.timelineId),
      })),
    );
  },
});

export const requireFinish = internalMutation({
  args: taskScope,
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await ctx.db
      .query('editingLaneTasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .unique();
    if (
      !row ||
      row.ownerId !== args.ownerId ||
      row.projectId !== args.projectId
    )
      throw new ConvexError('Task not found.');
    if (!row.required) await ctx.db.patch(row._id, { required: true });
    return null;
  },
});
