import { ConvexError, v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';
import { assetDocument, imageGenerationValidator } from './schema';
import { projectIdentity, projectRun } from './lib/project_data';
import { internal } from './_generated/api';
import { requireEditorAccess } from './lib/billing_access';
import { recordAssetStorage } from './lib/storage_accounting';
import { hydrateAsset } from './lib/asset_analysis';
import { mediaUrl } from './lib/media_storage';
import type { Id } from './_generated/dataModel';

const scope = { ownerId: v.string(), projectId: v.id('projects'), runId: v.string() };
async function requireCapacity(ctx: MutationCtx, args: { ownerId: string; projectId: Id<'projects'>; runId: string }, count: number) {
  const project = await projectRun(ctx, args.projectId, args.ownerId);
  if (!project.aiRunning || project.aiRunId !== args.runId) throw new ConvexError('AI run is no longer active');
  await requireEditorAccess(ctx, args.ownerId);
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new ConvexError('Generate between 1 and 4 image variants.');
  const assets = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', args.ownerId).eq('projectId', args.projectId)).take(200);
  if (assets.length + count > 200) throw new ConvexError('A project supports up to 200 media files. Remove unused media before generating images.');
}

/** Check paid access and space before making a provider call. */
export const prepare = internalMutation({ args: { ...scope, count: v.number(), storyboardName: v.optional(v.string()), storyboardPhase: v.optional(v.string()), referenceAssetIds: v.optional(v.array(v.id('assets'))), panelAspectRatio: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  await requireCapacity(ctx, args, args.count);
  if (args.storyboardName) {
    const brief = await ctx.db.query('projectBriefs').withIndex('by_project', q => q.eq('projectId', args.projectId)).unique();
    const board = brief?.storyboard;
    if (!board?.chosenConcept || board.name !== args.storyboardName) throw new ConvexError('Save the user-approved angle as the concept before generating storyboard images. Never invent an approval or require another text A/B round.');
    if (args.panelAspectRatio && args.panelAspectRatio !== board.aspectRatio) throw new ConvexError('Every sheet panel must use the approved film’s aspect ratio.');
    if (args.storyboardPhase === 'style') {
      if (!['direction', 'rough', 'style', 'animatic'].includes(board.stage ?? '')) throw new ConvexError('Save the user’s sheet pick before generating full-size key frames.');
      if (board.sheetAssetIds?.length) {
        const references = args.referenceAssetIds ?? [];
        let matches = false;
        for (const id of board.sheetAssetIds.filter(id => references.includes(id))) {
          const asset = await ctx.db.get(id);
          if (asset?.imageGeneration?.storyboard?.sheet?.panels.some(panel => panel.direction === board.chosenDirection)) matches = true;
        }
        if (!matches) throw new ConvexError('Pass a chosen-direction sheet as a reference for the key-frame redraw.');
      }
    }
  }
  return null;
} });

/** Candidate images reach the agent first; only reviewed frames appear in the composer grid. */
export const present = internalMutation({ args: { ...scope, assetIds: v.array(v.id('assets')), reviewNote: v.string() }, returns: v.array(v.object({ assetId: v.id('assets'), shotIndex: v.number(), url: v.string(), directions: v.optional(v.array(v.string())) })), handler: async (ctx, args) => {
  const project = await projectRun(ctx, args.projectId, args.ownerId);
  if (!project.aiRunning || project.aiRunId !== args.runId) throw new ConvexError('AI run is no longer active');
  await requireEditorAccess(ctx, args.ownerId);
  if (!args.assetIds.length || args.assetIds.length > 24 || new Set(args.assetIds).size !== args.assetIds.length) throw new ConvexError('Present 1–24 distinct reviewed sheets, or up to 6 legacy frames.');
  const frames = [];
  for (const id of args.assetIds) {
    const asset = await ctx.db.get(id), shot = asset?.imageGeneration?.storyboard;
    if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId || asset.imageGeneration?.purpose !== 'storyboard' || !shot) throw new ConvexError('Choose storyboard frames from this project.');
    if (frames.length && (shot.name !== frames[0].shot.name || shot.phase !== frames[0].shot.phase)) throw new ConvexError('Present one storyboard stage at a time.');
    frames.push({ asset, shot });
  }
  const presented = [];
  for (const { asset, shot } of frames) {
    const url = await mediaUrl(ctx, asset);
    if (!url) throw new ConvexError(`${asset.fileName} has no readable image file.`);
    await ctx.db.patch(asset._id, { imageGeneration: { ...asset.imageGeneration!, storyboard: { ...shot, presented: true, reviewNote: args.reviewNote } } });
    presented.push({ assetId: asset._id, shotIndex: shot.shotIndex, url, ...(shot.sheet ? { directions: [...new Set(shot.sheet.panels.map(panel => panel.direction))] } : {}) });
  }
  return presented;
} });

/** A lost save acknowledgement must never delete an asset that actually committed. */
export const cleanup = internalMutation({ args: { ...scope, keys: v.array(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  await projectIdentity(ctx, args.projectId, args.ownerId);
  for (const key of args.keys) {
    if (!key.startsWith(`media/${args.ownerId}/${args.projectId}/`)) throw new ConvexError('Generated image key is outside this project');
    const saved = await ctx.db.query('assets').withIndex('by_owner_project_r2Key', q => q.eq('ownerId', args.ownerId).eq('projectId', args.projectId).eq('r2Key', key)).first();
    if (!saved) await ctx.scheduler.runAfter(0, internal.r2.deleteObject, { key });
  }
  return null;
} });

/** One transaction attaches every variant, with the same accounting as uploaded media. */
export const save = internalMutation({
  args: { ...scope, provenance: imageGenerationValidator, images: v.array(v.object({ r2Key: v.string(), size: v.number(), width: v.number(), height: v.number() })) },
  returns: v.array(assetDocument),
  handler: async (ctx, args) => {
    await requireCapacity(ctx, args, args.images.length);
    const shot = args.provenance.storyboard;
    if ((args.provenance.purpose === 'storyboard') !== !!shot || shot && args.images.length !== 1) throw new ConvexError('A storyboard frame needs one image and shot details.');
    const saved = [];
    for (const [index, image] of args.images.entries()) {
      if (!image.r2Key.startsWith(`media/${args.ownerId}/${args.projectId}/`)) throw new ConvexError('Generated image key is outside this project');
      const fileName = shot ? `${shot.phase === 'sheet' ? 'Sketch sheet' : shot.phase === 'style' ? 'Style frame' : shot.phase === 'direction' ? 'Direction' : 'Storyboard'} ${shot.name.replace(/[\\/:*?"<>|\r\n]/g, '')} - S${String(shot.shotIndex).padStart(2, '0')} - ${shot.idea.slice(0, 60).replace(/[\\/:*?"<>|]/g, '')}.png` : `Generated plate ${index + 1}.png`;
      const id = await ctx.db.insert('assets', { ownerId: args.ownerId, projectId: args.projectId, ...image, fileName, contentType: 'image/png', kind: 'image', imageGeneration: shot ? { ...args.provenance, storyboard: { ...shot, phase: shot.phase ?? 'rough', presented: false } } : args.provenance, createdAt: Date.now() });
      const asset = (await ctx.db.get(id))!;
      await recordAssetStorage(ctx, asset);
      saved.push(await hydrateAsset(ctx, asset));
    }
    return saved;
  },
});
