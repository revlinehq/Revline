import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { createProjectFor } from './projects';
import { writeProject, readProject } from './lib/project_data';
import { normalizeTimeline } from '../lib/editor/types';
import { addMediaClip, patchClip } from '../lib/editor/operations';

const sourceAsset = v.object({
  r2Key: v.string(), fileName: v.string(), contentType: v.string(), size: v.number(),
  kind: v.union(v.literal('video'), v.literal('audio'), v.literal('image')),
  duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()),
});

/** Operator-only bootstrap. No auth bypass is exposed to a browser or an MCP caller. */
export const seed = internalMutation({
  args: { ownerId: v.string(), title: v.string(), assets: v.array(sourceAsset), tokenHash: v.string() },
  returns: v.object({ projectId: v.id('projects'), assetIds: v.array(v.id('assets')), timelineId: v.string() }),
  handler: async (ctx, args) => {
    const site = process.env.CONVEX_SITE_URL;
    if (process.env.REVLINE_ISOLATED !== 'true' || site?.includes('majestic-alpaca-541') || !site?.endsWith('.convex.site')) throw new Error('Seeding requires an isolated dev deployment.');
    const borrowed = new Set(JSON.parse(process.env.REVLINE_BORROWED_MEDIA_KEYS ?? '[]') as string[]);
    if (args.assets.length < 1 || args.assets.length > 20 || args.assets.some(asset => !borrowed.has(asset.r2Key))) throw new Error('Seed accepts up to 20 explicitly borrowed R2 assets.');
    const now = Date.now();
    const user = await ctx.db.query('users').withIndex('by_clerk_id', q => q.eq('clerkId', args.ownerId)).unique();
    if (!user) await ctx.db.insert('users', { clerkId: args.ownerId, name: 'Development owner', createdAt: now, updatedAt: now });
    if (!await ctx.db.query('mcpTokens').withIndex('by_tokenHash', q => q.eq('tokenHash', args.tokenHash)).unique()) {
      await ctx.db.insert('mcpTokens', { tokenHash: args.tokenHash, kind: 'personal', ownerId: args.ownerId, grantId: 'isolated-local', label: 'revline-local isolated worktree', createdAt: now });
    }
    const existing = await ctx.db.query('projects').withIndex('by_ownerId_updatedAt', q => q.eq('ownerId', args.ownerId)).order('desc').take(50);
    const prior = existing.find(project => project.title === args.title && !project.deleting);
    if (prior) {
      const project = await readProject(ctx, prior._id);
      const assets = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', args.ownerId).eq('projectId', prior._id)).take(20);
      return { projectId: prior._id, assetIds: assets.map(asset => asset._id), timelineId: project?.activeTimelineId ?? 'main' };
    }
    const projectId = await createProjectFor(ctx, args.ownerId, { title: args.title, aspectRatio: 'landscape' });
    const assetIds = [];
    let timeline = normalizeTimeline({ clips: [], fps: 30, aspectRatio: 'landscape' });
    for (const asset of args.assets) {
      const id = await ctx.db.insert('assets', { ...asset, ownerId: args.ownerId, projectId, createdAt: now });
      assetIds.push(id);
      // One short footage shot, with the other assets available as references in the media bin.
      if (!timeline.clips.length && asset.kind === 'video' && (asset.duration ?? 0) > 0) {
        timeline = patchClip(addMediaClip(timeline, { _id: id, kind: asset.kind, duration: asset.duration }, 'isolated-footage'), 'isolated-footage', { duration: Math.min(5, asset.duration!) });
      }
    }
    await writeProject(ctx, projectId, { timeline });
    const project = await readProject(ctx, projectId);
    return { projectId, assetIds, timelineId: project?.activeTimelineId ?? 'main' };
  },
});
