import { ConvexError, v } from 'convex/values';
import { action, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOwner, requireProject } from './lib/auth';
import { mediaUrl } from './lib/media_storage';

const request = { projectId: v.id('projects'), assetIds: v.array(v.id('assets')) };
const source = v.object({ _id: v.id('assets'), storageId: v.optional(v.id('_storage')), r2Key: v.optional(v.string()) });
type PlaybackSource = { _id: Id<'assets'>; storageId?: Id<'_storage'>; r2Key?: string };
type PlaybackUrl = { _id: Id<'assets'>; url: string | null };

export const authorize = internalQuery({
  args: request, returns: v.array(source),
  handler: async (ctx, args): Promise<PlaybackSource[]> => {
    const ownerId = await requireOwner(ctx);
    await requireProject(ctx, args.projectId, ownerId);
    if (args.assetIds.length > 200) throw new ConvexError('Refresh up to 200 project media files');
    const assets = await Promise.all([...new Set(args.assetIds)].map(id => ctx.db.get(id)));
    return assets.map(asset => {
      if (!asset || asset.ownerId !== ownerId || asset.projectId !== args.projectId) throw new ConvexError('Media not found');
      return { _id: asset._id, ...(asset.storageId ? { storageId: asset.storageId } : {}), ...(asset.r2Key ? { r2Key: asset.r2Key } : {}) };
    });
  },
});

// Sign in an action so an unchanged, cached source query cannot reuse an expired URL.
export const refresh = action({
  args: request, returns: v.array(v.object({ _id: v.id('assets'), url: v.union(v.string(), v.null()) })),
  handler: async (ctx, args): Promise<PlaybackUrl[]> => {
    const assets = await ctx.runQuery(internal.playback.authorize, args);
    return Promise.all(assets.map(async asset => ({ _id: asset._id, url: await mediaUrl(ctx, asset,true) })));
  },
});
