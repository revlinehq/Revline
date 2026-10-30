import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

// findIcon's answers (convex/icons.ts), kept so the same logo is not fetched and drawn again for every scene.
const TTL_MS = 14 * 24 * 3600_000;

export const get = internalQuery({ args: { key: v.string() }, returns: v.union(v.null(), v.any()), handler: async (ctx, { key }) => {
  const row = await ctx.db.query('iconCache').withIndex('by_key', q => q.eq('key', key)).first();
  return row && row.fetchedAt + TTL_MS > Date.now() ? JSON.parse(row.value) : null;
}});

export const put = internalMutation({ args: { key: v.string(), value: v.string() }, returns: v.null(), handler: async (ctx, { key, value }) => {
  const rows = await ctx.db.query('iconCache').withIndex('by_key', q => q.eq('key', key)).collect();
  for (const row of rows) await ctx.db.delete(row._id);
  await ctx.db.insert('iconCache', { key, value, fetchedAt: Date.now() });
  return null;
}});
