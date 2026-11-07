import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { runArgs } from './lib/active_run';
import { hasPaidModelAccess, requireEditorAccess } from './lib/billing_access';
import { requireMediaTask } from './lib/media_task_auth';
import { mediaTaskCredentials } from './lib/media_task_contract';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { enqueueMediaTask } from './lib/media_queue';
import { mediaUrl } from './lib/media_storage';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { BRIA_MONTHLY_SECONDS, GENESIS_ALLOWANCE, GENESIS_LIMITS, GENESIS_REFUSAL, briaUsd, renderKey } from '../lib/ai/lanes/genesis/render-contract';
import { layerStatus, ownedLayer, requireMcpRun } from './genesis';

/** Genesis renders (MCP only): clean plates and tracked surface inserts from the media worker's own compositor. */
const renderStatus = v.union(v.literal('queued'), v.literal('completed'), v.literal('failed'));
const allowance = v.object({ plan: v.string(), usedSeconds: v.number(), monthlySeconds: v.number() });
const renderView = v.object({ renderId: v.id('genesisRenders'), status: renderStatus, method: v.optional(v.string()), costUsd: v.optional(v.number()), briaSeconds: v.optional(v.number()), allowance: v.optional(allowance), reused: v.boolean(), progress: v.optional(v.number()), outputAssetId: v.optional(v.string()), failureMessage: v.optional(v.string()), refused: v.optional(v.boolean()), report: v.optional(v.any()), start: v.number(), end: v.number(), fps: v.number(), computeSeconds: v.optional(v.number()) });

/** Bria seconds this owner used this calendar month (UTC). A reservation counts once Bria was called, whatever happened after. */
const month = () => new Date().toISOString().slice(0, 7);
async function briaUsage(ctx: QueryCtx | MutationCtx, ownerId: string) {
  const ledger = await ctx.db.query('genesisEraseUsage').withIndex('by_owner_month', q => q.eq('ownerId', ownerId).eq('month', month())).unique();
  const plan = await hasPaidModelAccess(ctx, ownerId) ? 'pro' as const : 'mcp' as const;
  return { plan, usedSeconds: Math.round((ledger?.seconds ?? 0) * 100) / 100, monthlySeconds: BRIA_MONTHLY_SECONDS[plan], ledger };
}

async function view(ctx: QueryCtx | MutationCtx, row: Doc<'genesisRenders'>, reused: boolean) {
  const task = row.status === 'queued' && row.taskId ? await ctx.db.get(row.taskId) : null;
  return {
    renderId: row._id, status: row.status, reused, start: row.start, end: row.end, fps: row.fps,
    ...(row.method ? { method: row.method } : {}), ...(row.costUsd !== undefined ? { costUsd: row.costUsd } : {}), ...(row.briaSeconds ? { briaSeconds: row.briaSeconds } : {}),
    // The allowance only matters once a render settled or paid: polling a running render skips the lookup.
    ...(row.op === 'cleanPlate' && (row.status !== 'queued' || row.method === 'bria') ? { allowance: await briaUsage(ctx, row.ownerId).then(({ ledger: _ledger, ...usage }) => usage) } : {}),
    ...(task ? { progress: task.progress ?? 0 } : {}), ...(row.outputAssetId ? { outputAssetId: row.outputAssetId } : {}),
    ...(row.error ? { failureMessage: row.error.replace(GENESIS_REFUSAL, '').replace(GENESIS_ALLOWANCE, '') } : {}), ...(row.refused ? { refused: true } : {}), ...(row.report ? { report: row.report } : {}),
    ...(row.readyAt ? { computeSeconds: Math.round((row.readyAt - row.createdAt) / 100) / 10 } : {}),
  };
}

/** Start (or reuse) one render. Layers must be ready SAM 3.1 layers of the same footage. */
export const startFromRun = internalMutation({
  args: { ...runArgs, op: v.union(v.literal('cleanPlate'), v.literal('surface')), sourceAssetId: v.string(), layerIds: v.array(v.string()), seedLayerId: v.optional(v.string()), insertAssetId: v.optional(v.string()), start: v.number(), end: v.number(), fps: v.number(), params: v.any() },
  returns: renderView,
  handler: async (ctx, args) => {
    const project = await requireMcpRun(ctx, args, true);
    await requireEditorAccess(ctx, args.ownerId);
    const assetId = ctx.db.normalizeId('assets', args.sourceAssetId), asset = assetId ? await ctx.db.get(assetId) : null;
    if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== project._id || asset.kind !== 'video' || !asset.duration) throw new ConvexError('This clip’s video is unavailable.');
    // A surface can go onto footage removeObject already cleaned: its layers belong to the plate's source.
    const plate = asset.derivedOf ? await ctx.db.query('genesisRenders').withIndex('by_output', q => q.eq('outputAssetId', asset._id)).first() : null;
    const layerSource = args.op === 'surface' && plate?.op === 'cleanPlate' && plate.ownerId === args.ownerId ? plate.sourceAssetId : asset._id;
    if (asset.cutoutOf || asset.derivedOf && layerSource === asset._id) throw new ConvexError('This clip already shows processed footage (a cut-out or an earlier Genesis render). Use the original footage.');
    if (!(args.end > args.start) || args.end - args.start > GENESIS_LIMITS.maxSeconds) throw new ConvexError(`Genesis renders cover up to ${GENESIS_LIMITS.maxSeconds} seconds at a time. Split the clip.`);
    const ready = async (layerId: string) => {
      const layer = await ownedLayer(ctx, args, layerId), cutout = await ctx.db.get(layer.cutoutId), status = layerStatus(cutout);
      if (status !== 'ready') throw new ConvexError(`Layer ${layer._id} is ${status}. ${status === 'processing' ? 'Poll getLayer until ready.' : 'Segment again.'}`);
      if (layer.sourceAssetId !== layerSource) throw new ConvexError(`Layer ${layer._id} was segmented from other footage.`);
      if (layer.start > args.start + 1 / layer.fps || layer.end < args.end - 1 / layer.fps) throw new ConvexError(`Layer ${layer._id} masks source ${layer.start.toFixed(2)}–${layer.end.toFixed(2)}s, but this render needs ${args.start.toFixed(2)}–${args.end.toFixed(2)}s. Segment the whole clip.`);
      return layer;
    };
    const layers = await Promise.all([...new Set(args.layerIds)].map(ready));
    const seed = args.seedLayerId ? await ready(args.seedLayerId) : undefined;
    if (args.op === 'cleanPlate' && !layers.length) throw new ConvexError('Pass at least one layer to remove.');
    let insertAssetId: Id<'assets'> | undefined;
    if (args.op === 'surface') {
      const id = args.insertAssetId ? ctx.db.normalizeId('assets', args.insertAssetId) : null, insert = id ? await ctx.db.get(id) : null;
      if (!insert || insert.ownerId !== args.ownerId || insert.projectId !== project._id || (insert.kind !== 'image' && insert.kind !== 'video')) throw new ConvexError('assetId must be an image or video in this project (uploadMedia or copyMedia first).');
      insertAssetId = insert._id;
    }
    const fps = Math.max(1, Math.min(60, Math.round(args.fps)));
    const fields = { op: args.op, sourceAssetId: asset._id, layerIds: layers.map(layer => layer._id), ...(seed ? { seedLayerId: seed._id } : {}), ...(insertAssetId ? { insertAssetId } : {}), start: args.start, end: args.end, fps, params: args.params ?? {} };
    const key = renderKey({ ...fields, layerIds: fields.layerIds.map(String), seedLayerId: seed?._id, insertAssetId });
    // Identical requests reuse the render; a refusal stands (the footage will not change). Any other failure is
    // reported to the next call once, so polling never silently starts (and pays for) a new render; the call after runs again.
    for (const row of await ctx.db.query('genesisRenders').withIndex('by_project_key', q => q.eq('projectId', project._id).eq('key', key)).order('desc').take(5)) {
      if (row.ownerId !== args.ownerId) continue;
      if (row.status !== 'failed' || row.refused) return view(ctx, row, true);
      if (!row.failureReported) { await ctx.db.patch(row._id, { failureReported: true }); return view(ctx, row, true); }
      break;
    }
    await requireMediaTaskCapacity(ctx, args.ownerId, 1);
    const renderId = await ctx.db.insert('genesisRenders', { ownerId: args.ownerId, projectId: project._id, key, ...fields, status: 'queued', createdAt: Date.now() });
    const taskId = await enqueueMediaTask(ctx, { ownerId: args.ownerId, projectId: project._id, assetId: asset._id, kind: 'genesis', genesisRenderId: renderId, requiredProcessorVersion: MEDIA_PROCESSOR_VERSION });
    await ctx.db.patch(renderId, { taskId });
    return view(ctx, (await ctx.db.get(renderId))!, false);
  },
});

export const renderForRun = internalQuery({
  args: { ...runArgs, renderId: v.string() },
  returns: renderView,
  handler: async (ctx, args) => {
    await requireMcpRun(ctx, args, false);
    const id = ctx.db.normalizeId('genesisRenders', args.renderId), row = id ? await ctx.db.get(id) : null;
    if (!row || row.ownerId !== args.ownerId || row.projectId !== args.projectId) throw new ConvexError('Render not found in this project.');
    return view(ctx, row, true);
  },
});

/** The media worker's work for a Genesis task: masks, seed mask and insert as signed URLs. */
export async function genesisWorkFor(ctx: QueryCtx | MutationCtx, task: Doc<'mediaTasks'>) {
  if (!task.genesisRenderId) return undefined;
  const row = await ctx.db.get(task.genesisRenderId);
  if (!row || row.ownerId !== task.ownerId || row.projectId !== task.projectId) throw new ConvexError('The Genesis render request is unavailable.');
  const maskUrl = async (layerId: Id<'genesisLayers'>) => {
    const layer = await ctx.db.get(layerId), cutout = layer ? await ctx.db.get(layer.cutoutId) : null, mask = cutout?.outputAssetId ? await ctx.db.get(cutout.outputAssetId) : null;
    const url = mask && mask.ownerId === task.ownerId ? await mediaUrl(ctx, mask, true) : null;
    if (!url) throw new ConvexError('A Genesis layer mask is unavailable. Segment again.');
    return url;
  };
  const insert = row.insertAssetId ? await ctx.db.get(row.insertAssetId) : null;
  const insertUrl = insert && insert.ownerId === task.ownerId ? await mediaUrl(ctx, insert, true) : null;
  if (row.insertAssetId && (!insert || !insertUrl || (insert.kind !== 'image' && insert.kind !== 'video'))) throw new ConvexError('The surface insert is unavailable.');
  return {
    op: row.op, start: row.start, end: row.end, fps: row.fps, params: row.params,
    masks: await Promise.all(row.layerIds.map(maskUrl)),
    ...(row.seedLayerId ? { seedMask: await maskUrl(row.seedLayerId) } : {}),
    ...(insert && insertUrl ? { insert: { url: insertUrl, kind: insert.kind as 'image' | 'video' } } : {}),
  };
}

export async function genesisRenderActive(ctx: QueryCtx | MutationCtx, task: Doc<'mediaTasks'>) {
  const row = task.genesisRenderId ? await ctx.db.get(task.genesisRenderId) : null;
  return !!row && row.ownerId === task.ownerId && row.projectId === task.projectId && row.status === 'queued';
}

/** The worker stored the render: record provenance on the asset (same source clock, shared sound) and the report. */
export async function completeGenesisRender(ctx: MutationCtx, task: Doc<'mediaTasks'>, reported: unknown) {
  const row = task.genesisRenderId ? await ctx.db.get(task.genesisRenderId) : null;
  // A retry after the upload only says it recovered: the report staged before the upload stands.
  const report = (reported as { recovered?: boolean } | undefined)?.recovered ? row?.report : reported;
  const output = task.outputAssetId ? await ctx.db.get(task.outputAssetId) : null;
  if (!row || row.status !== 'queued') throw new ConvexError('The Genesis render is no longer active.');
  if (!output || output.ownerId !== task.ownerId || output.projectId !== task.projectId || output.kind !== 'video') throw new ConvexError('The Genesis render has not been stored yet.');
  if (!report || typeof report !== 'object' || JSON.stringify(report).length > 60_000) throw new ConvexError('The Genesis render returned no usable report.');
  const source = await ctx.db.get(row.sourceAssetId);
  // A clean plate replaces the footage's picture, so it keeps the footage's sound; an insert is picture only.
  await ctx.db.patch(output._id, { derivedOf: row.sourceAssetId, derivedStart: row.start, audioExtracted: true, ...(row.op === 'cleanPlate' && source?.audioAssetId ? { audioAssetId: source.audioAssetId } : {}) });
  await ctx.db.patch(row._id, { status: 'completed', outputAssetId: output._id, report, readyAt: Date.now(), ...(row.op === 'cleanPlate' && !row.method ? { method: 'cleanPlate' as const, costUsd: 0 } : {}) });
}

/** The worker's report, saved before it uploads the render, so a lease handoff after the upload keeps it. */
export const stageReport = mutation({
  args: { ...mediaTaskCredentials, report: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await requireMediaTask(ctx, args.taskId, args.leaseToken), row = task.genesisRenderId ? await ctx.db.get(task.genesisRenderId) : null;
    if (!row || row.status !== 'queued') throw new ConvexError('The Genesis render request is not active.');
    if (JSON.stringify(args.report ?? null).length > 60_000) throw new ConvexError('The Genesis report is too large.');
    await ctx.db.patch(row._id, { report: args.report });
    return null;
  },
});

/** The worker is about to call Bria for a clean plate the free compositor could not make: count its seconds against
 * the monthly allowance first, or refuse. Idempotent per render, so a lease handoff never counts twice. */
export const reserveBria = mutation({
  args: { ...mediaTaskCredentials, seconds: v.number(), reason: v.string() },
  returns: v.object({ expectedUsd: v.number(), plan: v.string(), usedSeconds: v.number(), monthlySeconds: v.number() }),
  handler: async (ctx, args) => {
    const task = await requireMediaTask(ctx, args.taskId, args.leaseToken), row = task.genesisRenderId ? await ctx.db.get(task.genesisRenderId) : null;
    if (!row || row.op !== 'cleanPlate' || row.status !== 'queued') throw new ConvexError('The Genesis render request is not active.');
    if (!(args.seconds > 0) || args.seconds > GENESIS_LIMITS.maxSeconds + 1) throw new ConvexError('Invalid Bria duration.');
    const { ledger, ...usage } = await briaUsage(ctx, row.ownerId), expectedUsd = briaUsd(args.seconds);
    if (row.briaSeconds) return { expectedUsd, ...usage };
    if ((row.params as { fallback?: string } | undefined)?.fallback === 'none') throw new ConvexError(`${GENESIS_REFUSAL}${args.reason} The paid eraser is off for this call (fallback "none").`);
    if (usage.usedSeconds + args.seconds > usage.monthlySeconds + 1e-6) throw new ConvexError(`${GENESIS_ALLOWANCE}${args.reason} The free clean plate cannot do this shot, and the paid eraser needs ${args.seconds.toFixed(1)} s but only ${Math.max(0, usage.monthlySeconds - usage.usedSeconds).toFixed(1)} of this month's ${usage.monthlySeconds} Bria seconds (${usage.plan === 'pro' ? 'Pro' : 'MCP'} plan) are left. Use a shorter range, or a static shot where the subject moves away.`);
    await ctx.db.patch(row._id, { method: 'bria', briaSeconds: args.seconds, costUsd: expectedUsd });
    if (ledger) await ctx.db.patch(ledger._id, { seconds: ledger.seconds + args.seconds });
    else await ctx.db.insert('genesisEraseUsage', { ownerId: row.ownerId, month: month(), seconds: args.seconds });
    return { expectedUsd, ...usage, usedSeconds: Math.round((usage.usedSeconds + args.seconds) * 100) / 100 };
  },
});
