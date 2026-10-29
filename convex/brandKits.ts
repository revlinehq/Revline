import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { brandColorValidator, brandContextValidator, brandMotionValidator } from './schema';

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
    return { ...kit, fontUrls: await Promise.all(kit.fonts.map(font => ctx.storage.getUrl(font.storageId))) };
  },
});

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
  args: { ownerId: v.string(), kitId: v.id('brandKits'), name: v.optional(v.string()), colors: v.optional(v.array(brandColorValidator)), fonts: v.optional(v.array(fontRow)), logo: v.optional(v.string()), context: v.optional(brandContextValidator), motion: v.optional(brandMotionValidator) },
  handler: async (ctx, { ownerId, kitId, ...patch }) => {
    const kit = await ctx.db.get(kitId);
    if (!kit || kit.ownerId !== ownerId) throw new Error('Brand kit not found.');
    if (patch.name && patch.name !== kit.name && await ctx.db.query('brandKits').withIndex('by_ownerId_name', q => q.eq('ownerId', ownerId).eq('name', patch.name!)).unique()) throw new Error(`A brand kit named "${patch.name}" already exists.`);
    if (patch.fonts) for (const font of kit.fonts) if (!patch.fonts.some(next => next.storageId === font.storageId)) await ctx.storage.delete(font.storageId);
    await ctx.db.patch(kitId, { ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: Date.now() });
  },
});
