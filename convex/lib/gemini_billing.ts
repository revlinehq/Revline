import type { MutationCtx, QueryCtx } from '../_generated/server';

export const GEMINI_BILLING_REASON = 'Gemini visual analysis is unavailable after a provider billing/credits rejection (HTTP 402). Fresh Gemini work is paused for up to 15 minutes; a changed provider key can recover immediately. Transcript and local measurements remain available; visual action is unverified.';
export function usesGemini(kind: string) {
  return ['video', 'frames', 'reference', 'understand', 'highlights', 'review'].includes(kind);
}
async function configuredKeyHash() {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return null;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function geminiBillingUnavailable(ctx: QueryCtx | MutationCtx, ownerId: string) {
  const row = await ctx.db.query('geminiBillingCooldowns').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  return row && row.until > Date.now() && row.keyHash === await configuredKeyHash() ? GEMINI_BILLING_REASON : null;
}
export async function recordGeminiBilling(ctx: MutationCtx, ownerId: string, failedKeyHash?: string) {
  const keyHash = await configuredKeyHash();
  if (!keyHash || failedKeyHash !== keyHash) return;
  const row = await ctx.db.query('geminiBillingCooldowns').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  const value = { ownerId, keyHash, until: Date.now() + 15 * 60_000 };
  if (row) await ctx.db.replace(row._id, value);
  else await ctx.db.insert('geminiBillingCooldowns', value);
}
