import { ConvexError, v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { projectIdentity } from './project_data';
import { MEDIA_LEASE_LOST } from '../../lib/media-analysis/errors';

export const mediaTaskCredentials = { taskId: v.id('mediaTasks'), leaseToken: v.string() };

/** Each worker type has its own credential: RENDER_WORKER_SECRET for the media processor
 *  (Cloudflare, local dev) and MEDIA_WORKER_SECRET_EXPORTS for Fly export machines. An export
 *  worker can only claim export tasks, so its key never reaches uploads or analysis. */
export type MediaWorkerRole = 'processor' | 'exports';
export function requireMediaWorker(secret: string): MediaWorkerRole {
  if (secret && secret === process.env.RENDER_WORKER_SECRET) return 'processor';
  // Set only while rotating: running containers keep the key they started with until they restart.
  if (secret && secret === process.env.RENDER_WORKER_SECRET_PREVIOUS) return 'processor';
  if (secret && secret === process.env.MEDIA_WORKER_SECRET_EXPORTS) return 'exports';
  throw new ConvexError('Media worker authentication required');
}

export async function requireMediaTask(ctx: QueryCtx | MutationCtx, taskId: Id<'mediaTasks'>, leaseToken: string) {
  const task = await ctx.db.get(taskId);
  if (!task || task.status !== 'running' || task.leaseToken !== leaseToken || (task.leaseExpiresAt ?? 0) <= Date.now()) throw new ConvexError(MEDIA_LEASE_LOST);
  await projectIdentity(ctx, task.projectId, task.ownerId);
  return task;
}
