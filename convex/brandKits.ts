import { v } from 'convex/values';
import { ConvexError } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireOwner } from './lib/auth';
import { BRAND_LIMITS, isBrandColor } from '../lib/editor/brand-kit';
import { brandColorValidator, brandContextValidator, brandScreenValidator } from './schema';

const fontRow = v.object({ family: v.string(), weight: v.string(), role: v.union(v.literal('heading'), v.literal('body'), v.literal('other')), storageId: v.id('_storage') });
const copyValidator = v.object({ title: v.optional(v.string()), description: v.optional(v.string()), headings: v.array(v.string()) });

export const list = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => (await ctx.db.query('brandKits').withIndex('by_ownerId_name', q => q.eq('ownerId', ownerId)).take(50)),
});

export const get = internalQuery({
  args: { ownerId: v.string(), kitId: v.string() },
  handler: async (ctx, { ownerId, kitId }) => {
    const id = ctx.db.normalizeId('brandKits', kitId);
    const kit = id && await ctx.db.get(id);
    if (!kit || kit.ownerId !== ownerId) return null;
    return { ...kit, fontUrls: kit.fonts.map(font => fontUrl(font.storageId)), screenUrls: (kit.screens ?? []).map(screen => brandFileUrl(screen.storageId)) };
  },
});

/** Only stored font and image files (brand fonts and screens) are served by the brand-file route. */
export const isFontFile = internalQuery({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    const id = ctx.db.system.normalizeId('_storage', storageId);
    const file = id && await ctx.db.system.get(id);
    return file && /^(font|image)\//.test(file.contentType ?? '') ? file._id : null;
  },
});

const fontUrl = (storageId: string) => `${process.env.CONVEX_SITE_URL}/brand-font?id=${storageId}`;
export const brandFileUrl = (storageId: string) => `${process.env.CONVEX_SITE_URL}/brand-file?id=${storageId}`;

export const byName = internalQuery({
  args: { ownerId: v.string(), name: v.string() },
  handler: async (ctx, { ownerId, name }) => await ctx.db.query('brandKits').withIndex('by_ownerId_name', q => q.eq('ownerId', ownerId).eq('name', name)).unique(),
});

export const create = internalMutation({
  args: { ownerId: v.string(), name: v.string(), sourceUrl: v.optional(v.string()), colors: v.array(brandColorValidator), fonts: v.array(fontRow), logo: v.optional(v.string()), copy: v.optional(copyValidator), context: v.optional(brandContextValidator) },
  handler: async (ctx, args) => {
    if (await ctx.db.query('brandKits').withIndex('by_ownerId_name', q => q.eq('ownerId', args.ownerId).eq('name', args.name)).unique()) throw new Error(`A brand kit named "${args.name}" already exists. Update it with updateBrandKit or pick another name.`);
    const now = Date.now();
    return await ctx.db.insert('brandKits', { ...args, createdAt: now, updatedAt: now });
  },
});

export const update = internalMutation({
  args: { ownerId: v.string(), kitId: v.id('brandKits'), name: v.optional(v.string()), colors: v.optional(v.array(brandColorValidator)), fonts: v.optional(v.array(fontRow)), logo: v.optional(v.string()), context: v.optional(brandContextValidator), screens: v.optional(v.array(brandScreenValidator)) },
  handler: async (ctx, { ownerId, kitId, ...patch }) => {
    const kit = await ctx.db.get(kitId);
    if (!kit || kit.ownerId !== ownerId) throw new Error('Brand kit not found.');
    if (patch.name && patch.name !== kit.name && await ctx.db.query('brandKits').withIndex('by_ownerId_name', q => q.eq('ownerId', ownerId).eq('name', patch.name!)).unique()) throw new Error(`A brand kit named "${patch.name}" already exists.`);
    if (patch.fonts) for (const font of kit.fonts) if (!patch.fonts.some(next => next.storageId === font.storageId)) await ctx.storage.delete(font.storageId);
    if (patch.screens) for (const screen of kit.screens ?? []) if (!patch.screens.some(next => next.storageId === screen.storageId)) await ctx.storage.delete(screen.storageId);
    await ctx.db.patch(kitId, { ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: Date.now() });
  },
});

/** The signed-in user's brand kits, as the AI sees them, for the Brand kits page. */
export const mine = query({
  args: {},
  handler: async ctx => {
    const ownerId = await requireOwner(ctx);
    const kits = await ctx.db.query('brandKits').withIndex('by_ownerId_name', q => q.eq('ownerId', ownerId)).take(50);
    return kits.map(kit => ({
      id: kit._id, name: kit.name, sourceUrl: kit.sourceUrl ?? null, updatedAt: kit.updatedAt, colors: kit.colors,
      fonts: [...new Map(kit.fonts.map(font => [`${font.family}:${font.role}`, { family: font.family, role: font.role, weights: kit.fonts.filter(item => item.family === font.family && item.role === font.role).map(item => item.weight) }])).values()],
      logo: kit.logo ?? null, context: kit.context ?? null,
      screens: (kit.screens ?? []).map(screen => ({ name: screen.name, note: screen.note ?? null, width: screen.width ?? null, height: screen.height ?? null, url: brandFileUrl(screen.storageId) })),
    }));
  },
});

/** Inline edits from the Brand kits page: any of name, colors or the product text. */
export const updateKit = mutation({
  args: { kitId: v.id('brandKits'), name: v.optional(v.string()), colors: v.optional(v.array(brandColorValidator)), context: v.optional(brandContextValidator) },
  handler: async (ctx, { kitId, ...patch }) => {
    const ownerId = await requireOwner(ctx);
    const kit = await ctx.db.get(kitId);
    if (!kit || kit.ownerId !== ownerId) throw new ConvexError('Brand kit not found.');
    const name = patch.name?.trim();
    if (patch.name !== undefined && (!name || name.length > BRAND_LIMITS.name)) throw new ConvexError(`Name the kit in 1 to ${BRAND_LIMITS.name} characters.`);
    if (name && name !== kit.name && await ctx.db.query('brandKits').withIndex('by_ownerId_name', q => q.eq('ownerId', ownerId).eq('name', name)).unique()) throw new ConvexError(`A brand kit named "${name}" already exists.`);
    const colors = patch.colors?.map(color => ({ name: color.name.trim(), value: color.value.trim() })).filter(color => color.name && color.value);
    if (colors && (colors.length > BRAND_LIMITS.colors || colors.some(color => color.name.length > 40 || !isBrandColor(color.value)))) throw new ConvexError('Colors need a short name and a CSS color such as #7c3aed.');
    const product = patch.context?.product?.trim();
    if (product && product.length > BRAND_LIMITS.contextText) throw new ConvexError(`Keep the product text under ${BRAND_LIMITS.contextText} characters.`);
    const context = patch.context && (product ? { product } : {});
    await ctx.db.patch(kitId, { ...(name ? { name } : {}), ...(colors ? { colors } : {}), ...(context ? { context } : {}), updatedAt: Date.now() });
  },
});

/** Removes one saved screen from a kit, from the Brand kits page. */
export const removeScreen = mutation({
  args: { kitId: v.id('brandKits'), name: v.string() },
  handler: async (ctx, { kitId, name }) => {
    const ownerId = await requireOwner(ctx);
    const kit = await ctx.db.get(kitId);
    if (!kit || kit.ownerId !== ownerId) throw new ConvexError('Brand kit not found.');
    const screen = kit.screens?.find(item => item.name === name);
    if (!screen) return;
    await ctx.storage.delete(screen.storageId);
    await ctx.db.patch(kitId, { screens: kit.screens!.filter(item => item.name !== name), updatedAt: Date.now() });
  },
});

/** Clears fields retired from brand kits (voice, and the context's call to action and tone). */
export const dropRetiredFields = internalMutation({
  args: {},
  handler: async ctx => {
    let changed = 0;
    for await (const kit of ctx.db.query('brandKits')) {
      const { cta: _cta, tone: _tone, ...context } = (kit.context ?? {}) as Record<string, unknown>;
      const retired = kit as typeof kit & { voice?: unknown };
      if (retired.voice === undefined && _cta === undefined && _tone === undefined) continue;
      await ctx.db.replace(kit._id, { ...Object.fromEntries(Object.entries(kit).filter(([key]) => key !== 'voice' && key !== '_id' && key !== '_creationTime')), ...(kit.context ? { context: context as typeof kit.context } : {}) } as typeof kit);
      changed++;
    }
    return changed;
  },
});

/** One-off: the context becomes one product text (what it is, the problem, the features); audience is asked per video. */
export const mergeContextFields = internalMutation({
  args: {},
  handler: async ctx => {
    let changed = 0;
    for await (const kit of ctx.db.query('brandKits')) {
      const context = kit.context as { product?: string; problem?: string; audience?: string; features?: string[]; notes?: string } | undefined;
      if (!context || Object.keys(context).every(key => key === 'product')) continue;
      const lines = [[context.product, context.problem].filter(Boolean).join(' ').trim(), ...(context.features ?? []).map(feature => `- ${feature}`), context.notes ?? ''].filter(Boolean);
      await ctx.db.patch(kit._id, { context: (lines.length ? { product: lines.join('\n') } : {}) as typeof kit.context });
      changed++;
    }
    return changed;
  },
});
