import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { internal } from './_generated/api';

/** Move inline export timelines into renderSnapshots, a page at a time. */
export const run = internalMutation({ args: { cursor: v.optional(v.union(v.string(), v.null())) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.db.query('renderJobs').paginate({ cursor: args.cursor ?? null, numItems: 25 });
  for (const job of page.page) {
    if (!job.timeline) continue;
    const existing = await ctx.db.query('renderSnapshots').withIndex('by_job', q => q.eq('jobId', job._id)).unique();
    if (!existing) await ctx.db.insert('renderSnapshots', { jobId: job._id, timeline: job.timeline });
    await ctx.db.patch(job._id, { timeline: undefined });
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.renderSnapshotMigration.run, { cursor: page.continueCursor });
  return null;
}});
