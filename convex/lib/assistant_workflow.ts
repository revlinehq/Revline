import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type Run = Pick<Doc<'projects'>, '_id' | 'aiRunning' | 'aiRunId' | 'aiEditing' | 'aiUndoRecorded'>;

/** Persisted workflow evidence survives analysis → planning and client reloads. */
export async function editingWorkflowActive(ctx: QueryCtx | MutationCtx, project: Run, hasRunAnalysis?: boolean) {
  if (!project.aiRunning) return false;
  if (project.aiEditing || project.aiUndoRecorded) return true;
  if (hasRunAnalysis !== undefined) return hasRunAnalysis;
  if (!project.aiRunId) return false;
  return !!await ctx.db.query('analysisRequests').withIndex('by_projectId_runId', q => q.eq('projectId', project._id).eq('aiRunId', project.aiRunId!)).first();
}
