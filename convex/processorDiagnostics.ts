import { v } from 'convex/values';
import { internalAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { validateTimeline } from './lib/timeline';
import { enqueueMediaTask } from './mediaTasks';
import type { Timeline } from '../lib/editor/types';

const fixtureResult = v.object({ ownerId: v.string(), projectId: v.id('projects'), jobId: v.id('renderJobs'), taskId: v.id('mediaTasks') });
const stackedSource = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#808080"/><rect x="80" y="60" width="160" height="240" fill="#484848"/><circle cx="440" cy="180" r="105" fill="#b8b8b8"/></svg>';

/** Admin CLI only: exercise hosting without reading a customer identity or media. */
export const createExportFixture = internalMutation({
  args: {},
  returns: fixtureResult,
  handler: async ctx => {
    const ownerId = `revline-hosting-smoke-${crypto.randomUUID()}`, now = Date.now();
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

/** Generated pixels only: verify the deployed shader chain through the ordinary render queue. */
export const createStackedEffectsFixture = internalAction({
  args: {}, returns: fixtureResult,
  handler: async ctx => {
    const source = new Blob([stackedSource], { type: 'image/svg+xml' });
    const storageId = await ctx.storage.store(source);
    try {
      return await ctx.runMutation(internal.processorDiagnostics.createStackedEffectsProject, { storageId, size: source.size });
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
  },
});

export const createStackedEffectsProject = internalMutation({
  args: { storageId: v.id('_storage'), size: v.number() }, returns: fixtureResult,
  handler: async (ctx, { storageId, size }) => {
    const ownerId = `revline-hosting-smoke-${crypto.randomUUID()}`, now = Date.now();
    const projectId = await ctx.db.insert('projects', { ownerId, title: 'Hosted processor stacked effects check', aspectRatio: 'landscape', createdAt: now, updatedAt: now, revision: 0, history: [] });
    const assetId = await ctx.db.insert('assets', { ownerId, projectId, storageId, fileName: 'generated-shader-check.svg', contentType: 'image/svg+xml', size, kind: 'image', width: 640, height: 360, createdAt: now });
    const source: Timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0, effects: 2 }, clips: [
      { id: 'shader-source', kind: 'image', assetId, track: 1, start: 0, duration: 1, sourceStart: 0, dither: { enabled: true, amount: 1, levels: 2, size: 8 } },
      ...[1, 2].map(track => ({ id: `shader-blur-${track}`, kind: 'effect' as const, effectPreset: 'zoom-blur' as const, track, start: 0, duration: 1, sourceStart: 0, zoomBlur: { enabled: true, amount: .15, centerX: .5, centerY: .5 } })),
    ] };
    const timeline = await validateTimeline(ctx, (await ctx.db.get(projectId))!, source);
    await ctx.db.patch(projectId, { timeline });
    const jobId = await ctx.db.insert('renderJobs', { ownerId, projectId, timeline, assetIds: [assetId], resolution: 720, fps: 24, quality: 'draft', status: 'queued', progress: 0, createdAt: now, updatedAt: now });
    const taskId = await enqueueMediaTask(ctx, { ownerId, projectId, kind: 'render', renderJobId: jobId });
    await ctx.db.patch(jobId, { taskId });
    return { ownerId, projectId, jobId, taskId };
  },
});
