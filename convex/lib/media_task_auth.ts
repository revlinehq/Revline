import { ConvexError, v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { projectIdentity } from './project_data';
import { MEDIA_LEASE_LOST } from '../../lib/media-analysis/errors';

export const mediaTaskCredentials = { taskId: v.id('mediaTasks'), leaseToken: v.string() };

export function requireMediaWorker(secret: string) {
  if (!process.env.RENDER_WORKER_SECRET || secret !== process.env.RENDER_WORKER_SECRET) throw new ConvexError('Media worker authentication required');
}

export async function requireMediaTask(ctx: QueryCtx | MutationCtx, taskId: Id<'mediaTasks'>, leaseToken: string) {
  const task = await ctx.db.get(taskId);
  if (!task || task.status !== 'running' || task.leaseToken !== leaseToken || (task.leaseExpiresAt ?? 0) <= Date.now()) throw new ConvexError(MEDIA_LEASE_LOST);
  await projectIdentity(ctx, task.projectId, task.ownerId);
  return task;
}
