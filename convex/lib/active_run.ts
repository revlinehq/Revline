import { v, type ObjectType } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import { projectRun } from './project_data';

/** The arguments of every run-bound function: the project, its owner and the run holding its AI lock. */
export const runArgs = { projectId: v.id('projects'), ownerId: v.string(), runId: v.string() };

/** The project's AI lock is held by this run. */
export const holdsRun = (project: { aiRunning?: boolean; aiRunId?: string }, runId: string) => project.aiRunning === true && project.aiRunId === runId;

/** The run still holds its project's AI lock; false when the project is gone or belongs to someone else. */
export async function runIsActive(ctx: QueryCtx, args: ObjectType<typeof runArgs>) {
  const run = await projectRun(ctx, args.projectId, args.ownerId).catch(() => null);
  return !!run && holdsRun(run, args.runId);
}
