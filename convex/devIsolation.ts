import type { Id } from './_generated/dataModel';
import { timelineValidator, assetWithUrl, imageGenerationValidator } from './schema';
import { remapTimelineAssets } from '../lib/editor/copy-timeline';
import { readTranscript } from '../lib/media-analysis/transcript';
import { storeAnalysis } from './lib/asset_analysis';
import { storeSceneCode } from './lib/scene_code';
import { recordAssetStorage } from './lib/storage_accounting';
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

/** Operator-only faithful import; source reads happen in the local CLI, never through public auth. */
export const importSnapshot = internalMutation({
  args: {
    ownerId: v.string(),
    title: v.string(),
    sourceProjectId: v.string(),
    timeline: timelineValidator,
    tabs: v.array(v.object({ id: v.string(), name: v.string() })),
    activeTimelineId: v.string(),
    saved: v.array(v.object({ id: v.string(), timeline: timelineValidator })),
    assets: v.array(v.object({
      ...assetWithUrl.fields,
      _id: v.string(), projectId: v.string(), analysisId: v.optional(v.string()),
      storageId: v.optional(v.string()), thumbnailStorageId: v.optional(v.string()),
      audioAssetId: v.optional(v.string()), cutoutOf: v.optional(v.string()), derivedOf: v.optional(v.string()),
      imageGeneration: v.optional(v.object({ ...imageGenerationValidator.fields, referenceAssetIds: v.array(v.string()) })),
    })),
  },
  handler: async (ctx, args) => {
    const site = process.env.CONVEX_SITE_URL;
    if (
      process.env.REVLINE_ISOLATED !== "true" ||
      site?.includes("majestic-alpaca-541") ||
      !site?.endsWith(".convex.site")
    )
      throw new Error("Snapshot import requires an isolated dev deployment.");
    const borrowed = new Set<string>(
      JSON.parse(process.env.REVLINE_BORROWED_MEDIA_KEYS ?? "[]"),
    );
    if (
      !args.assets.length ||
      args.assets.length > 200 ||
      args.tabs.length > 10 ||
      args.saved.length > 10
    )
      throw new Error("Snapshot exceeds project limits.");
    if (
      args.assets.some(
        (asset) =>
          asset.projectId !== args.sourceProjectId ||
          !asset.r2Key ||
          !borrowed.has(asset.r2Key) ||
          (asset.previewR2Key && !borrowed.has(asset.previewR2Key)),
      )
    )
      throw new Error(
        "Snapshot media must be explicitly borrowed from its source project.",
      );
    if (new Set(args.assets.map(asset => asset._id)).size !== args.assets.length ||
        new Set(args.tabs.map(tab => tab.id)).size !== args.tabs.length ||
        new Set(args.saved.map(tab => tab.id)).size !== args.saved.length ||
        !args.tabs.some(tab => tab.id === args.activeTimelineId) ||
        args.tabs.some(tab => tab.id !== args.activeTimelineId && !args.saved.some(row => row.id === tab.id))) {
      throw new Error('Snapshot asset IDs and saved timeline tabs must be complete and unique.');
    }
    const now = Date.now();
    const projectId = await createProjectFor(ctx, args.ownerId, {
      title: args.title,
      aspectRatio: args.timeline.aspectRatio,
    });
    const ids = new Map<string, Id<"assets">>();
    for (const source of args.assets) {
      const {
        _id,
        _creationTime,
        projectId: _project,
        ownerId: _owner,
        storageId: _storage,
        thumbnailStorageId: _thumbnail,
        analysisId: _analysisId,
        analysis: _analysis,
        audioAssetId: _audio,
        cutoutOf: _cutout,
        derivedOf: _derived,
        imageGeneration: _image,
        url: _url,
        previewUrl: _preview,
        previewSegments: _segments,
        thumbnailUrl: _thumbUrl,
        ...metadata
      } = source;
      ids.set(
        _id,
        await ctx.db.insert("assets", {
          ...metadata,
          projectId,
          ownerId: args.ownerId,
          createdAt: now,
        }),
      );
    }
    const copied = (id: string) => {
      const found = ids.get(id);
      if (!found)
        throw new Error(
          "Snapshot contains a media reference outside its asset set.",
        );
      return found;
    };
    for (const source of args.assets) {
      const id = copied(source._id);
      await ctx.db.patch(id, {
        ...(source.audioAssetId
          ? { audioAssetId: copied(source.audioAssetId) }
          : {}),
        ...(source.cutoutOf ? { cutoutOf: copied(source.cutoutOf) } : {}),
        ...(source.derivedOf ? { derivedOf: copied(source.derivedOf) } : {}),
        ...(source.imageGeneration
          ? {
              imageGeneration: {
                ...source.imageGeneration,
                referenceAssetIds:
                  source.imageGeneration.referenceAssetIds.map(copied),
              },
            }
          : {}),
      });
      if (source.analysis) {
        const analysis = source.analysis.transcript
          ? {
              ...source.analysis,
              transcript: readTranscript(source.analysis.transcript),
            }
          : source.analysis;
        await storeAnalysis(
          ctx,
          (await ctx.db.get(id))!,
          analysis,
          source.analysisUpdatedAt ?? 0,
        );
      } else if (source.analysisId)
        throw new Error("Snapshot analysis was not hydrated.");
      await recordAssetStorage(ctx, (await ctx.db.get(id))!);
    }
    for (const row of args.saved)
      await ctx.db.insert("projectTimelines", {
        ownerId: args.ownerId,
        projectId,
        timelineId: row.id,
        timeline: await storeSceneCode(
          ctx,
          remapTimelineAssets(row.timeline, copied),
        ),
      });
    await writeProject(ctx, projectId, {
      timeline: remapTimelineAssets(args.timeline, copied),
      timelineTabs: args.tabs,
      activeTimelineId: args.activeTimelineId,
    });
    return {
      projectId,
      assetIds: [...ids.values()],
      timelineId: args.activeTimelineId,
    };
  },
});
