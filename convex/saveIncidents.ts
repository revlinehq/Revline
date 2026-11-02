import { recordIncident, incidentDeployment } from './lib/incidents';
import { v, ConvexError } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { projectRun } from './lib/project_data';
import { saveIncidentEvidence } from './lib/save_incidents';
import { terminalSaveCondition } from '../lib/ai/save-confirmation';

const deployments = {
  'https://majestic-alpaca-541.convex.cloud': { deployment: 'dev', deploymentName: 'majestic-alpaca-541' },
  'https://different-gnu-398.convex.cloud': { deployment: 'prod', deploymentName: 'different-gnu-398' },
} satisfies Record<string, { deployment: 'dev' | 'prod'; deploymentName: string }>;
function deploymentIdentity() {
  const url = process.env.CONVEX_CLOUD_URL;
  if (url === 'https://majestic-alpaca-541.convex.cloud') return deployments[url];
  if (url === 'https://different-gnu-398.convex.cloud') return deployments[url];
  throw new ConvexError('Save incidents require a recognized deployment URL.');
}

/** Only small, already scrubbed shapes cross the runner bridge. This never changes editor data. */
export const observe = internalMutation({
  args: { ...saveIncidentEvidence, ownerId: v.string() }, returns: v.null(),
  handler: async (ctx, { ownerId, ...step }) => {
    if (step.inputShape.length > 1800 || step.outputShape.length > 1800 || step.toolName.length > 100 || step.toolCallId.length > 200) throw new ConvexError('Incident evidence exceeds its budget.');
    const active = await projectRun(ctx, step.projectId, ownerId);
    // A completed tool can race Stop. Still capture its evidence, without touching the new run.
    const existing = await ctx.db.query('saveIncidentSteps').withIndex('by_run_call', q => q.eq('runId', step.runId).eq('toolCallId', step.toolCallId)).unique();
    if (existing) return null;
    const run = await ctx.db.query('saveIncidentRuns').withIndex('by_run', q => q.eq('runId', step.runId)).unique();
    if (run && (run.projectId !== step.projectId || run.ownerId !== ownerId)) throw new ConvexError('Incident run does not match this project.');
    if (!run) {
      await ctx.db.insert('saveIncidentRuns', { runId: step.runId, projectId: step.projectId, ownerId });
    }
    await ctx.db.insert('saveIncidentSteps', step);
    if (!active.aiRunning || active.aiRunId !== step.runId) await ctx.scheduler.runAfter(0, internal.saveIncidents.settle, { runId: step.runId });
    return null;
  },
});

/** Indexed, bounded batches. Successful staged edits disappear without creating incident groups. */
export const settle = internalMutation({ args: { runId: v.string() }, returns: v.null(), handler: async (ctx, { runId }) => {
  const run = await ctx.db.query('saveIncidentRuns').withIndex('by_run', q => q.eq('runId', runId)).unique();
  if (!run) return null;
  if (!run.finishedAt) {
    const active = await ctx.db.query('aiRuns').withIndex('by_project', q => q.eq('projectId', run.projectId)).unique();
    if (active?.aiRunning && active.aiRunId === runId) {
      return null;
    }
  }
  const steps = await ctx.db.query('saveIncidentSteps').withIndex('by_run_call', q => q.eq('runId', runId)).take(16);
  for (const step of steps) {
    const condition = terminalSaveCondition(step, run.publication);
    if (condition) {
      await recordIncident(ctx, {
        source: step.source, kind: 'save-confirmation', message: `Save not confirmed: ${condition}`,
        context: { location: 'convex/saveIncidents:settle', toolName: step.toolName, condition, inputShape: step.inputShape, outputShape: step.outputShape },
        projectId: step.projectId, runId, deployment: incidentDeployment(),
      });
      const identity = deploymentIdentity();
      // Omit project, prompt, revisions and input values so repeats of one protocol failure group together.
      const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, tool: step.toolName, condition, outputShape: step.outputShape }));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const fingerprint = `save-v1-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      const group = await ctx.db.query('saveIncidentGroups').withIndex('by_fingerprint', q => q.eq('fingerprint', fingerprint)).unique();
      const { _id, _creationTime, ...latest } = step;
      if (group) await ctx.db.patch(group._id, { count: group.count + 1, firstSeenAt: Math.min(group.firstSeenAt, step.observedAt), lastSeenAt: Math.max(group.lastSeenAt, step.observedAt), ...(step.observedAt >= group.lastSeenAt ? { latest, latestPublication: run.publication } : {}), ...(group.status === 'fixed' ? { status: 'open', fixedAt: undefined, prUrl: undefined } : {}) });
      else await ctx.db.insert('saveIncidentGroups', { ...identity, fingerprint, condition, toolName: step.toolName, count: 1, firstSeenAt: step.observedAt, lastSeenAt: step.observedAt, status: 'open', latest, ...(run.publication ? { latestPublication: run.publication } : {}) });
    }
    await ctx.db.delete(step._id);
  }
  if (steps.length === 16) await ctx.scheduler.runAfter(0, internal.saveIncidents.settle, { runId });
  else await ctx.db.delete(run._id);
  return null;
} });

/** Admin CLI only. The editor never subscribes to these operational tables. */
export const listOpen = internalQuery({ args: { limit: v.optional(v.number()), status: v.optional(v.union(v.literal('open'), v.literal('pr_open'))) }, handler: async (ctx, args) => {
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 20)));
  const status = args.status;
  if (status) return await ctx.db.query('saveIncidentGroups').withIndex('by_status_count', q => q.eq('status', status)).order('desc').take(limit);
  const [open, proposed] = await Promise.all([
    ctx.db.query('saveIncidentGroups').withIndex('by_status_count', q => q.eq('status', 'open')).order('desc').take(limit),
    ctx.db.query('saveIncidentGroups').withIndex('by_status_count', q => q.eq('status', 'pr_open')).order('desc').take(limit),
  ]);
  return [...open, ...proposed].sort((a, b) => b.count - a.count || a.firstSeenAt - b.firstSeenAt).slice(0, limit);
} });

function requirePR(url: string) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(url)) throw new ConvexError('A GitHub PR link is required.');
}
export const markPR = internalMutation({ args: { groupId: v.id('saveIncidentGroups'), prUrl: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  requirePR(args.prUrl);
  await ctx.db.patch(args.groupId, { status: 'pr_open', prUrl: args.prUrl, fixedAt: undefined });
  return null;
} });
export const markFixed = internalMutation({ args: { groupId: v.id('saveIncidentGroups'), prUrl: v.string(), expectedCount: v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  requirePR(args.prUrl);
  const group = await ctx.db.get(args.groupId);
  if (!group || (args.expectedCount !== undefined && group.count !== args.expectedCount)) return null;
  await ctx.db.patch(args.groupId, { status: 'fixed', prUrl: args.prUrl, fixedAt: Date.now() });
  return null;
} });
