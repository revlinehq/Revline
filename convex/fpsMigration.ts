import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { internal } from './_generated/api';

// Every 30 fps frame time is also a 60 fps frame time, so raising the rate moves nothing on the timeline.

/** Raise every 30 fps project timeline (the open tab) to 60 fps, a page at a time. */
export const projects = internalMutation({ args: { cursor: v.optional(v.union(v.string(), v.null())) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.db.query('projects').paginate({ cursor: args.cursor ?? null, numItems: 10 });
  for (const project of page.page) if (project.timeline?.fps === 30) await ctx.db.patch(project._id, { timeline: { ...project.timeline, fps: 60 } });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.fpsMigration.projects, { cursor: page.continueCursor });
  else await ctx.scheduler.runAfter(0, internal.fpsMigration.tabs, {});
  return null;
}});

/** Raise every stored 30 fps timeline tab to 60 fps, a page at a time. */
export const tabs = internalMutation({ args: { cursor: v.optional(v.union(v.string(), v.null())) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.db.query('projectTimelines').paginate({ cursor: args.cursor ?? null, numItems: 10 });
  for (const row of page.page) if (row.timeline.fps === 30) await ctx.db.patch(row._id, { timeline: { ...row.timeline, fps: 60 } });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.fpsMigration.tabs, { cursor: page.continueCursor });
  return null;
}});
