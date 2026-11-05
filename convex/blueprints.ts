import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { enqueueMediaTask } from './mediaTasks';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { requireOwner } from './lib/auth';
import { brandFileUrl, fontUrl } from './brandKits';
import { blueprintCheckValidator, blueprintLineValidator, blueprintPartValidator, blueprintPointValidator } from './schema';

/**
 * Blueprints: a brand's UI rebuilt from one of its kit screens as scene code, every piece a named
 * part (data-part), measured from the screen's pixels and scored against it at each size checked.
 * The code is responsive: it renders at any width and height a scene asks for.
 */
const measured = { parts: v.array(blueprintPartValidator), checks: v.array(blueprintCheckValidator), colors: v.array(v.object({ label: v.string(), hex: v.string(), x: v.number(), y: v.number() })), edges: v.array(v.object({ label: v.string(), axis: v.union(v.literal('x'), v.literal('y')), at: v.number() })) };

/** The signed-in user's blueprints, each with the brand snapshot a scene frame needs to render it. */
export const mine = query({ args: {}, handler: async ctx => {
  const ownerId = await requireOwner(ctx);
  const rows = await ctx.db.query('blueprints').withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(100);
  const kits = new Map<string, Awaited<ReturnType<typeof ctx.db.get<'brandKits'>>>>();
  return Promise.all(rows.map(async row => {
    if (!kits.has(row.kitId)) kits.set(row.kitId, await ctx.db.get(row.kitId));
    const kit = kits.get(row.kitId);
    const screens = (kit?.screens ?? []).map(screen => ({ name: screen.name, url: brandFileUrl(screen.storageId) }));
    return {
      id: row._id, kitId: row.kitId, name: row.name, screen: row.screen, code: row.code, width: row.width, height: row.height,
      parts: row.parts, checks: row.checks, colors: row.colors, edges: row.edges, updatedAt: row.updatedAt,
      screenUrl: screens.find(screen => screen.name === row.screen)?.url ?? null,
      brand: kit ? { kitId: kit._id, name: kit.name, colors: kit.colors, fonts: kit.fonts.map(font => ({ family: font.family, weight: font.weight, role: font.role, url: fontUrl(font.storageId) })), ...(kit.logo ? { logo: kit.logo } : {}), ...(screens.length ? { screens } : {}) } : null,
    };
  }));
}});

type SaveInput = { ownerId: string; kitId: Id<'brandKits'>; name: string; screen: string; code: string; width: number; height: number; parts: { name: string; x: number; y: number; width: number; height: number; score?: number }[]; checks: { width: number; height: number; score: number; meanDiff: number; at: number }[]; colors: { label: string; hex: string; x: number; y: number }[]; edges: { label: string; axis: 'x' | 'y'; at: number }[] };

async function saveBlueprintRow(ctx: MutationCtx, args: SaveInput) {
  const kit = await ctx.db.get(args.kitId);
  if (!kit || kit.ownerId !== args.ownerId) throw new ConvexError('Brand kit not found.');
  if (!(kit.screens ?? []).some(screen => screen.name === args.screen)) throw new ConvexError(`The kit has no screen named "${args.screen}".`);
  const name = args.name.trim().slice(0, 60);
  if (!name) throw new ConvexError('A blueprint needs a name.');
  const now = Date.now(), fields = { ...args, name, parts: args.parts.slice(0, 300), colors: args.colors.slice(0, 60), edges: args.edges.slice(0, 60), updatedAt: now };
  const existing = await ctx.db.query('blueprints').withIndex('by_kit_name', q => q.eq('kitId', args.kitId).eq('name', name)).unique();
  if (existing) { await ctx.db.patch(existing._id, fields); return existing._id; }
  return ctx.db.insert('blueprints', { ...fields, createdAt: now });
}

/** Save a blueprint by kit and name: a new one, or a new version of an existing one. */
export const save = internalMutation({
  args: { ownerId: v.string(), kitId: v.id('brandKits'), name: v.string(), screen: v.string(), code: v.string(), width: v.number(), height: v.number(), ...measured },
  returns: v.id('blueprints'),
  handler: (ctx, args) => saveBlueprintRow(ctx, args),
});

// Tool side: measure a screen, render or compare code, then save what a compare proved.
const MAX_SIZE = 2560, CHECK_TTL = 10 * 60_000;
const kitOf = async (ctx: MutationCtx, ownerId: string, kitId: string) => {
  const id = ctx.db.normalizeId('brandKits', kitId), kit = id ? await ctx.db.get(id) : null;
  if (!kit || kit.ownerId !== ownerId) throw new ConvexError('Brand kit not found. Use a kitId from listBrandKits.');
  return kit;
};

/** Queue a measure, compare or render for the media worker; the tool polls checkState. */
export const requestCheck = internalMutation({
  args: { ownerId: v.string(), projectId: v.id('projects'), kitId: v.string(), mode: v.union(v.literal('measure'), v.literal('compare'), v.literal('render')), screen: v.optional(v.string()), code: v.optional(v.string()), width: v.optional(v.number()), height: v.optional(v.number()), points: v.optional(v.array(blueprintPointValidator)), lines: v.optional(v.array(blueprintLineValidator)) },
  returns: v.id('blueprintChecks'),
  handler: async (ctx, args) => {
    const kit = await kitOf(ctx, args.ownerId, args.kitId);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== args.ownerId) throw new ConvexError('Project not found.');
    const screen = args.screen ? (kit.screens ?? []).find(item => item.name === args.screen) : undefined;
    if (args.mode !== 'render' && !screen) throw new ConvexError(`The kit has no screen named "${args.screen ?? ''}". Screens: ${(kit.screens ?? []).map(item => item.name).join(', ') || 'none'}.`);
    if (args.mode !== 'measure' && !args.code?.trim()) throw new ConvexError('Pass the blueprint code to render.');
    if ((args.points?.length ?? 0) > 60 || (args.lines?.length ?? 0) > 20) throw new ConvexError('Measure at most 60 points and 20 lines at a time.');
    // Compare at the screen's own size unless another size is asked for.
    const width = Math.round(args.width ?? screen?.width ?? 1920), height = Math.round(args.height ?? screen?.height ?? 1080);
    if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) throw new ConvexError(`Choose a size between 1 and ${MAX_SIZE} pixels.`);
    await requireMediaTaskCapacity(ctx, args.ownerId, 1);
    const checkId = await ctx.db.insert('blueprintChecks', { ownerId: args.ownerId, projectId: project._id, kitId: kit._id, mode: args.mode, ...(screen ? { screen: screen.name } : {}), ...(args.code ? { code: args.code } : {}), width, height, ...(args.points ? { points: args.points } : {}), ...(args.lines ? { lines: args.lines } : {}), status: 'queued', createdAt: Date.now() });
    const taskId = await enqueueMediaTask(ctx, { ownerId: args.ownerId, projectId: project._id, kind: 'blueprint', blueprintCheckId: checkId });
    await ctx.db.patch(checkId, { taskId });
    await ctx.scheduler.runAfter(CHECK_TTL, internal.blueprints.discardCheck, { checkId });
    return checkId;
  },
});

export const checkState = internalQuery({ args: { ownerId: v.string(), checkId: v.id('blueprintChecks') }, returns: v.any(), handler: async (ctx, { ownerId, checkId }) => {
  const check = await ctx.db.get(checkId);
  if (!check || check.ownerId !== ownerId) throw new ConvexError('Check not found.');
  return { status: check.status, mode: check.mode, screen: check.screen ?? null, width: check.width, height: check.height, ...(check.error ? { error: check.error } : {}), ...(check.result ? { result: check.result } : {}) };
}});

export const discardCheck = internalMutation({ args: { checkId: v.id('blueprintChecks') }, returns: v.null(), handler: async (ctx, { checkId }) => {
  const check = await ctx.db.get(checkId);
  if (check) await ctx.db.delete(check._id);
  return null;
}});

/** Save the code a finished compare scored, with its parts and score; colors and edges come from measuring. */
export const saveFromCheck = internalMutation({
  args: { ownerId: v.string(), checkId: v.string(), name: v.string(), colors: measured.colors, edges: measured.edges },
  returns: v.object({ blueprintId: v.id('blueprints'), name: v.string(), score: v.number() }),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('blueprintChecks', args.checkId), check = id ? await ctx.db.get(id) : null;
    if (!check || check.ownerId !== args.ownerId) throw new ConvexError('Compare not found. Run compareScreen again; results are kept for 10 minutes.');
    if (check.mode !== 'compare' || check.status !== 'completed' || !check.result?.score || !check.code || !check.screen) throw new ConvexError('Save needs a finished compareScreen result.');
    const result = check.result, score = result.score!;
    const blueprintId = await saveBlueprintRow(ctx, { ownerId: args.ownerId, kitId: check.kitId, name: args.name, screen: check.screen, code: check.code, width: check.width, height: check.height, parts: result.parts ?? [], checks: [{ width: result.width, height: result.height, score, meanDiff: result.meanDiff ?? 0, at: Date.now() }], colors: args.colors, edges: args.edges });
    return { blueprintId, name: args.name.trim().slice(0, 60), score };
  },
});

/** Blueprint summaries for listBlueprints. */
export const listForTools = internalQuery({ args: { ownerId: v.string(), kitId: v.optional(v.string()) }, handler: async (ctx, { ownerId, kitId }) => {
  const rows = (await ctx.db.query('blueprints').withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(100)).filter(row => !kitId || row.kitId === kitId);
  return rows.map(row => ({ kitId: row.kitId, name: row.name, screen: row.screen, size: `${row.width}x${row.height}`, score: row.checks.at(-1)?.score ?? null, parts: [...new Set(row.parts.map(part => part.name))] }));
}});

/** One blueprint in full for getBlueprint: code, parts and checks. */
export const getForTools = internalQuery({ args: { ownerId: v.string(), kitId: v.string(), name: v.string() }, handler: async (ctx, { ownerId, kitId, name }) => {
  const rows = (await ctx.db.query('blueprints').withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(100)).filter(row => row.kitId === kitId);
  const row = rows.find(item => item.name.toLowerCase() === name.trim().toLowerCase());
  if (!row) throw new ConvexError(`No blueprint named "${name}" in this kit. listBlueprints shows them.`);
  return { kitId: row.kitId, name: row.name, screen: row.screen, width: row.width, height: row.height, code: row.code, checks: row.checks, parts: row.parts.map(({ score: _score, ...part }) => part) };
}});

export const remove = mutation({ args: { blueprintId: v.id('blueprints') }, returns: v.null(), handler: async (ctx, { blueprintId }) => {
  const ownerId = await requireOwner(ctx), row = await ctx.db.get(blueprintId);
  if (row && row.ownerId === ownerId) await ctx.db.delete(row._id);
  return null;
}});
