import { recordIncident, incidentDeployment } from './incidents';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';

export async function scheduleCapacityAdmission(ctx: MutationCtx, ownerId: string, delay = 0) {
  const owner = await ctx.db.query('mediaCapacityOwners').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  if (!owner || owner.admissionScheduled || !await ctx.db.query('mediaTasks').withIndex('by_owner_capacity_waiting', q => q.eq('ownerId', ownerId).eq('capacityWaiting', true)).first()) return;
  await ctx.db.patch(owner._id, { admissionScheduled: true });
  await ctx.scheduler.runAfter(delay, internal.mediaTasks.admitWaiting, { ownerId });
}

const active = (status: Doc<'mediaTasks'>['status']) => status === 'queued' || status === 'running' || status === 'retrying';
function reservation(task: Pick<Doc<'mediaTasks'>, '_id' | 'ownerId' | 'projectId' | 'kind' | 'sourceUrl' | 'importRange' | 'sourcesOnly' | 'status'>) {
  return { status: task.status, taskId: task._id, ownerId: task.ownerId, projectId: task.projectId, kind: task.kind, sourceUrl: task.sourceUrl, importRange: task.importRange, sourcesOnly: task.sourcesOnly };
}

/** Reservations change only when work enters or leaves the queue, never on a worker heartbeat. */
export async function initializeMediaCapacity(ctx: MutationCtx | QueryCtx, ownerId: string) {
  const state = await ctx.db.query('mediaCapacityOwners').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  if (state?.schedulingVersion === 1) return true;
  const db = ctx.db;
  if (!('insert' in db)) return false;
  for (const status of ['queued', 'running', 'retrying'] as const) {
    for await (const task of ctx.db.query('mediaTasks').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', status))) {
      if (task.capacityWaiting) continue;
      const slot = await ctx.db.query('mediaTaskSlots').withIndex('by_task', q => q.eq('taskId', task._id)).unique();
      if (slot) await db.patch(slot._id, reservation(task)); else await db.insert('mediaTaskSlots', reservation(task));
    }
  }
  if (state) await db.patch(state._id, { schedulingVersion: 1 });
  else await db.insert('mediaCapacityOwners', { ownerId, schedulingVersion: 1 });
  return true;
}

function display(task: Doc<'mediaTasks'>) {
  const { ownerId, projectId, createdAt, kind, status, progress, attempt, error, assetId, activity, activityStartedAt, attemptStartedAt } = task;
  return { taskId: task._id, ownerId, projectId, createdAt, kind, status, progress, attempt, error, assetId, activity, activityStartedAt, attemptStartedAt };
}

/** The editor never reads worker leases, requests or inspection results. */
export async function syncMediaTask(ctx: MutationCtx, task: Doc<'mediaTasks'>) {
  const row = await ctx.db.query('mediaTaskViews').withIndex('by_task', q => q.eq('taskId', task._id)).unique();
  const value = display(task);
  if (!row) await ctx.db.insert('mediaTaskViews', value);
  else if (row.kind !== value.kind || row.status !== value.status || row.attempt !== value.attempt || row.error !== value.error || row.assetId !== value.assetId || row.activity !== value.activity || row.activityStartedAt !== value.activityStartedAt || row.attemptStartedAt !== value.attemptStartedAt) await ctx.db.patch(row._id, value);
  const progress=await ctx.db.query('mediaTaskProgress').withIndex('by_task',q=>q.eq('taskId',task._id)).unique();
  if(active(task.status)){
    if(!progress)await ctx.db.insert('mediaTaskProgress',{taskId:task._id,projectId:task.projectId,createdAt:task.createdAt,progress:task.progress});
    else if(progress.progress!==task.progress)await ctx.db.patch(progress._id,{progress:task.progress});
  }else if(progress)await ctx.db.delete(progress._id);
}

export async function insertMediaTask(ctx: MutationCtx, value: Omit<Doc<'mediaTasks'>, '_id' | '_creationTime'>) {
  await initializeMediaCapacity(ctx, value.ownerId);
  const id = await ctx.db.insert('mediaTasks', value);
  if (active(value.status) && !value.capacityWaiting) await ctx.db.insert('mediaTaskSlots', reservation({ ...value, _id: id }));
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
  if (patch.status && patch.status !== task.status || patch.capacityWaiting !== undefined && patch.capacityWaiting !== task.capacityWaiting) {
    await initializeMediaCapacity(ctx, task.ownerId);
    const slot = await ctx.db.query('mediaTaskSlots').withIndex('by_task', q => q.eq('taskId', task._id)).unique();
    if (active(patch.status ?? task.status) && !(patch.capacityWaiting ?? task.capacityWaiting)) {
      const value = reservation({ ...task, ...patch });
      if (slot) await ctx.db.patch(slot._id, value); else await ctx.db.insert('mediaTaskSlots', value);
    }
    else if (slot) await ctx.db.delete(slot._id);
  }
  await syncMediaTask(ctx, { ...task, ...patch });
}

export async function deleteMediaTask(ctx: MutationCtx, taskId: Id<'mediaTasks'>) {
  const view = await ctx.db.query('mediaTaskViews').withIndex('by_task', q => q.eq('taskId', taskId)).unique();
  const slot = await ctx.db.query('mediaTaskSlots').withIndex('by_task', q => q.eq('taskId', taskId)).unique();
  const progress=await ctx.db.query('mediaTaskProgress').withIndex('by_task',q=>q.eq('taskId',taskId)).unique();
  if(progress)await ctx.db.delete(progress._id);
  if (view) await ctx.db.delete(view._id);
  if (slot) await ctx.db.delete(slot._id);
  await ctx.db.delete(taskId);
}

/** Fairness and seat reads depend on status transitions, never lease/progress writes. */
export async function runningMediaTaskCount(ctx: MutationCtx | QueryCtx, ownerId: string, limit: number, kind?: Doc<'mediaTasks'>['kind'], exceptKind?: Doc<'mediaTasks'>['kind']) {
  if (await initializeMediaCapacity(ctx, ownerId)) {
    const slots = ctx.db.query('mediaTaskSlots').withIndex('by_owner_status_kind', q => {
      const owner = q.eq('ownerId', ownerId).eq('status', 'running');
      return kind ? owner.eq('kind', kind) : owner;
    });
    return (await (exceptKind ? slots.filter(q => q.neq(q.field('kind'), exceptKind)) : slots).take(limit)).length;
  }
  // Legacy owners are upgraded by their next mutation; read-only queries stay compatible.
  const running = ctx.db.query('mediaTasks').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', 'running'));
  return (await running.filter(q => q.and(kind ? q.eq(q.field('kind'), kind) : true, exceptKind ? q.neq(q.field('kind'), exceptKind) : true)).take(limit)).length;
}
