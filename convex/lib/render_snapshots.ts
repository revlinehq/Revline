import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Timeline } from '../../lib/editor/types';

/** Export timelines live in renderSnapshots, so export lists read only small job rows. */
export async function saveRenderSnapshot(ctx: MutationCtx, jobId: Id<'renderJobs'>, timeline: Timeline) {
  await ctx.db.insert('renderSnapshots', { jobId, timeline: timeline });
}
export async function renderSnapshot(ctx: QueryCtx | MutationCtx, job: { _id: Id<'renderJobs'>; timeline?: Timeline }) {
  // Jobs from before the split still carry their timeline inline.
  const timeline = job.timeline ?? (await ctx.db.query('renderSnapshots').withIndex('by_job', q => q.eq('jobId', job._id)).unique())?.timeline;
  return timeline ? timeline : undefined;
}
export async function deleteRenderSnapshot(ctx: MutationCtx, jobId: Id<'renderJobs'>) {
  const row = await ctx.db.query('renderSnapshots').withIndex('by_job', q => q.eq('jobId', jobId)).unique();
  if (row) await ctx.db.delete(row._id);
}
