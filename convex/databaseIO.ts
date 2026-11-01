import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { initializeMediaCapacity, syncMediaTask } from './lib/media_task_data';

const keys = ['io-tasks-v1', 'io-thumbnails-v1', 'io-chats-v1'] as const;
/** Run once after deploying this branch. Historical rows migrate one per page; capacity initialization reads only an owner's active tasks. */
export const initialize = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  for (const key of keys) {
    const state = await ctx.db.query('projectDataMigration').withIndex('by_key', q => q.eq('key', key)).unique();
    if (!state) await ctx.db.insert('projectDataMigration', { key, cursor: null, completed: false });
  }
  await ctx.scheduler.runAfter(0, internal.databaseIO.tasks, {});
  await ctx.scheduler.runAfter(0, internal.databaseIO.thumbnails, {});
  await ctx.scheduler.runAfter(0, internal.databaseIO.chats, {});
  await ctx.scheduler.runAfter(0, internal.databaseIO.resumeChats, { cursor: null });
  await ctx.scheduler.runAfter(0, internal.databaseIO.resumeThumbnails, { cursor: null });
  return null;
}});
export const tasks = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const state = await ctx.db.query('projectDataMigration').withIndex('by_key', q => q.eq('key', keys[0])).unique();
  if (!state || state.completed) return null;
  const page = await ctx.db.query('mediaTasks').paginate({ cursor: state.cursor, numItems: 1 });
  for (const task of page.page) { await initializeMediaCapacity(ctx, task.ownerId); await syncMediaTask(ctx, task); }
  await ctx.db.patch(state._id, { cursor: page.continueCursor, completed: page.isDone });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.databaseIO.tasks, {});
  return null;
}});
export const thumbnails = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const state = await ctx.db.query('projectDataMigration').withIndex('by_key', q => q.eq('key', keys[1])).unique();
  if (!state || state.completed) return null;
  const page = await ctx.db.query('frameSnapshots').paginate({ cursor: state.cursor, numItems: 1 });
  for (const snapshot of page.page) if (snapshot.clipId && snapshot.key) {
    const existing = await ctx.db.query('sceneThumbnails').withIndex('by_snapshot', q => q.eq('snapshotId', snapshot._id)).unique();
    if (!existing) await ctx.db.insert('sceneThumbnails', { ownerId: snapshot.ownerId, projectId: snapshot.projectId, clipId: snapshot.clipId, key: snapshot.key, snapshotId: snapshot._id, taskId: snapshot.taskId, status: snapshot.status === 'failed' ? 'failed' : 'queued', createdAt: snapshot.createdAt });
    if (snapshot.status === 'completed' && snapshot.frames) await ctx.scheduler.runAfter(0, internal.sceneThumbs.storeImages, { snapshotId: snapshot._id });
  }
  await ctx.db.patch(state._id, { cursor: page.continueCursor, completed: page.isDone });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.databaseIO.thumbnails, {});
  return null;
}});
export const chats = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const state = await ctx.db.query('projectDataMigration').withIndex('by_key', q => q.eq('key', keys[2])).unique();
  if (!state || state.completed) return null;
  const page = await ctx.db.query('projects').paginate({ cursor: state.cursor, numItems: 1 });
  for (const project of page.page) if (project.threadId && !project.deleting) await ctx.runMutation(internal.assistantMessages.prepare, { threadId: project.threadId });
  await ctx.db.patch(state._id, { cursor: page.continueCursor, completed: page.isDone });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.databaseIO.chats, {});
  return null;
}});
export const status = internalQuery({ args: {}, handler: async ctx => {
  const states = await Promise.all(keys.map(key => ctx.db.query('projectDataMigration').withIndex('by_key', q => q.eq('key', key)).unique()));
  const pending = await ctx.db.query('assistantMessageThreads').withIndex('by_completed', q => q.eq('completed', false)).first();
  return { tasks: !!states[0]?.completed, thumbnails: !!states[1]?.completed, chats: !!states[2]?.completed && !pending };
}});
export const resumeThumbnails = internalMutation({ args: { cursor: v.union(v.string(), v.null()) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.db.query('sceneThumbnails').withIndex('by_status', q => q.eq('status', 'queued')).paginate({ cursor: args.cursor, numItems: 20 });
  for (const row of page.page) await ctx.scheduler.runAfter(0, internal.sceneThumbs.storeImages, { snapshotId: row.snapshotId });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.databaseIO.resumeThumbnails, { cursor: page.continueCursor });
  return null;
}});
export const resumeChats = internalMutation({ args: { cursor: v.union(v.string(), v.null()) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.db.query('assistantMessageThreads').withIndex('by_completed', q => q.eq('completed', false)).paginate({ cursor: args.cursor, numItems: 20 });
  for (const row of page.page) await ctx.scheduler.runAfter(0, internal.assistantMessages.backfill, { threadId: row.threadId, cursor: row.cursor });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.databaseIO.resumeChats, { cursor: page.continueCursor });
  return null;
}});
