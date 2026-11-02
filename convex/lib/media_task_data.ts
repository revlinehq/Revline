import { recordIncident, incidentDeployment } from './incidents';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

const active = (status: Doc<'mediaTasks'>['status']) => status === 'queued' || status === 'running' || status === 'retrying';
function reservation(task: Pick<Doc<'mediaTasks'>, '_id' | 'ownerId' | 'projectId' | 'kind' | 'sourceUrl' | 'importRange' | 'sourcesOnly'>) {
  return { taskId: task._id, ownerId: task.ownerId, projectId: task.projectId, kind: task.kind, sourceUrl: task.sourceUrl, importRange: task.importRange, sourcesOnly: task.sourcesOnly };
}

/** Reservations change only when work enters or leaves the queue, never on a worker heartbeat. */
export async function initializeMediaCapacity(ctx: MutationCtx | QueryCtx, ownerId: string) {
  if (await ctx.db.query('mediaCapacityOwners').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique()) return true;
  const db = ctx.db;
  if (!('insert' in db)) return false;
  for (const status of ['queued', 'running', 'retrying'] as const) {
    for await (const task of ctx.db.query('mediaTasks').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', status))) {
      await db.insert('mediaTaskSlots', reservation(task));
    }
  }
  await db.insert('mediaCapacityOwners', { ownerId });
  return true;
}

function display(task: Doc<'mediaTasks'>) {
  const { ownerId, projectId, createdAt, kind, status, progress, attempt, error, assetId, activity, activityStartedAt } = task;
  return { taskId: task._id, ownerId, projectId, createdAt, kind, status, progress, attempt, error, assetId, activity, activityStartedAt };
}

/** The editor never reads worker leases, requests or inspection results. */
export async function syncMediaTask(ctx: MutationCtx, task: Doc<'mediaTasks'>) {
  const row = await ctx.db.query('mediaTaskViews').withIndex('by_task', q => q.eq('taskId', task._id)).unique();
  const value = display(task);
  if (!row) await ctx.db.insert('mediaTaskViews', value);
  else if (row.kind !== value.kind || row.status !== value.status || row.progress !== value.progress || row.attempt !== value.attempt || row.error !== value.error || row.assetId !== value.assetId || row.activity !== value.activity || row.activityStartedAt !== value.activityStartedAt) await ctx.db.patch(row._id, value);
}

export async function insertMediaTask(ctx: MutationCtx, value: Omit<Doc<'mediaTasks'>, '_id' | '_creationTime'>) {
  await initializeMediaCapacity(ctx, value.ownerId);
  const id = await ctx.db.insert('mediaTasks', value);
  if (active(value.status)) await ctx.db.insert('mediaTaskSlots', reservation({ ...value, _id: id }));
  await syncMediaTask(ctx, { ...value, _id: id, _creationTime: value.createdAt });
  return id;
}

export async function patchMediaTask(ctx: MutationCtx, task: Doc<'mediaTasks'>, patch: Partial<Omit<Doc<'mediaTasks'>, '_id' | '_creationTime'>>) {
  if (patch.status === 'failed' && task.status !== 'failed') await recordIncident(ctx, {
    source: 'media-worker', kind: task.kind === 'render' ? 'export' : 'media-task', message: patch.error ?? task.error ?? 'Media task failed',
    context: { location: 'convex/lib/media_task_data:patchMediaTask', taskKind: task.kind, taskId: task._id, jobId: task.renderJobId, attempt: task.attempt },
    projectId: task.projectId, deployment: incidentDeployment(),
  });
  await ctx.db.patch(task._id, patch);
  if (patch.status && active(task.status) !== active(patch.status)) {
    await initializeMediaCapacity(ctx, task.ownerId);
    const slot = await ctx.db.query('mediaTaskSlots').withIndex('by_task', q => q.eq('taskId', task._id)).unique();
    if (active(patch.status)) { if (!slot) await ctx.db.insert('mediaTaskSlots', reservation(task)); }
    else if (slot) await ctx.db.delete(slot._id);
  }
  await syncMediaTask(ctx, { ...task, ...patch });
}

export async function deleteMediaTask(ctx: MutationCtx, taskId: Id<'mediaTasks'>) {
  const view = await ctx.db.query('mediaTaskViews').withIndex('by_task', q => q.eq('taskId', taskId)).unique();
  const slot = await ctx.db.query('mediaTaskSlots').withIndex('by_task', q => q.eq('taskId', taskId)).unique();
  if (view) await ctx.db.delete(view._id);
  if (slot) await ctx.db.delete(slot._id);
  await ctx.db.delete(taskId);
}
