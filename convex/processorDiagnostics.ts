import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { validateTimeline } from './lib/timeline';
import { enqueueMediaTask } from './mediaTasks';
import type { Timeline } from '../lib/editor/types';

/** Admin CLI only: exercise hosting without reading a customer identity or media. */
export const createExportFixture = internalMutation({
  args: {},
  returns: v.object({ ownerId: v.string(), projectId: v.id('projects'), jobId: v.id('renderJobs'), taskId: v.id('mediaTasks') }),
  handler: async ctx => {
    const ownerId = `revline-hosting-smoke:${crypto.randomUUID()}`, now = Date.now();
    const projectId = await ctx.db.insert('projects', { ownerId, title: 'Hosted processor smoke test', aspectRatio: 'landscape', createdAt: now, updatedAt: now, revision: 0, history: [] });
    const source: Timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0, effects: 0 }, clips: [
      { id: 'hosting-check-title', kind: 'graphic', track: 1, start: 0, duration: 1, sourceStart: 0, text: 'Hosted export check', fontSize: 72, color: '#FFFFFF', background: '#0B0C0E', x: .5, y: .5, animation: 'none' },
    ] };
    const timeline = await validateTimeline(ctx, (await ctx.db.get(projectId))!, source);
    await ctx.db.patch(projectId, { timeline });
    const jobId = await ctx.db.insert('renderJobs', { ownerId, projectId, timeline, assetIds: [], resolution: 720, fps: 24, quality: 'draft', status: 'queued', progress: 0, createdAt: now, updatedAt: now });
    const taskId = await enqueueMediaTask(ctx, { ownerId, projectId, kind: 'render', renderJobId: jobId });
    await ctx.db.patch(jobId, { taskId });
    return { ownerId, projectId, jobId, taskId };
  },
});
