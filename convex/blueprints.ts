import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireOwner } from './lib/auth';
import { brandFileUrl, fontUrl } from './brandKits';
import { blueprintCheckValidator, blueprintPartValidator } from './schema';
import { SCENE_LIMITS } from '../lib/editor/scene-layers';

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

/** Save a blueprint by kit and name: a new one, or a new version of an existing one. */
export const save = internalMutation({
  args: { ownerId: v.string(), kitId: v.id('brandKits'), name: v.string(), screen: v.string(), code: v.string(), width: v.number(), height: v.number(), ...measured },
  returns: v.id('blueprints'),
  handler: async (ctx, args) => {
    const kit = await ctx.db.get(args.kitId);
    if (!kit || kit.ownerId !== args.ownerId) throw new ConvexError('Brand kit not found.');
    if (!(kit.screens ?? []).some(screen => screen.name === args.screen)) throw new ConvexError(`The kit has no screen named "${args.screen}".`);
    const name = args.name.trim().slice(0, 60);
    if (!name) throw new ConvexError('A blueprint needs a name.');
    if (args.code.length > SCENE_LIMITS.code) throw new ConvexError(`Keep blueprint code under ${SCENE_LIMITS.code} characters.`);
    const now = Date.now(), fields = { ...args, name, updatedAt: now };
    const existing = await ctx.db.query('blueprints').withIndex('by_kit_name', q => q.eq('kitId', args.kitId).eq('name', name)).unique();
    if (existing) { await ctx.db.patch(existing._id, fields); return existing._id; }
    return ctx.db.insert('blueprints', { ...fields, createdAt: now });
  },
});

export const remove = mutation({ args: { blueprintId: v.id('blueprints') }, returns: v.null(), handler: async (ctx, { blueprintId }) => {
  const ownerId = await requireOwner(ctx), row = await ctx.db.get(blueprintId);
  if (row && row.ownerId === ownerId) await ctx.db.delete(row._id);
  return null;
}});
