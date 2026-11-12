import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { PLAN_LIMITS, PLANS, type PlanTier } from '../../lib/billing/plan';
import { activePlan, billingEnabled } from './billing_access';
import { storageAccount } from './storage_accounting';

type Context = QueryCtx | MutationCtx;
const DAY_MS = 86_400_000;
const date = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
/** The plan whose limits apply, or null where none do: a deployment without billing meters no one, and an
 *  account without a plan is already refused by requireEditorAccess. */
async function limitedPlan(ctx: Context, ownerId: string) {
  return billingEnabled() ? await activePlan(ctx, ownerId) : null;
}

/** What this owner stores, counting uploads in progress, against the plan's limit (null: no limit). */
export async function storageState(ctx: Context, ownerId: string, tier?: PlanTier | null) {
  const plan = tier === undefined ? (await limitedPlan(ctx, ownerId))?.tier ?? null : tier;
  const account = await storageAccount(ctx, ownerId);
  return { usedBytes: account?.usedBytes ?? 0, reservedBytes: account?.reservedBytes ?? 0, limitBytes: plan ? PLAN_LIMITS[plan].storageBytes : null, tier: plan };
}

/** Refuses a new upload, import or upload lease that would take the account past its plan's storage. `bytes` is
 *  the new file's size (0 for one already reserved, such as a resumed upload), or null where it is not known yet
 *  (a link import, a small upload URL): then the account only needs to be under its limit. Uploads in progress
 *  count. Files already stored are never touched. `tier` skips the plan lookup when the caller has it. */
export async function requireStorageRoom(ctx: Context, ownerId: string, bytes: number | null, tier?: PlanTier | null) {
  const state = await storageState(ctx, ownerId, tier);
  if (state.limitBytes === null || !state.tier) return;
  const total = state.usedBytes + state.reservedBytes + Math.max(0, bytes ?? 0);
  if (bytes === null ? total < state.limitBytes : total <= state.limitBytes) return;
  const limit = `${state.limitBytes / 1e9} GB`;
  throw new ConvexError({ code: 'storage_full', tier: state.tier, message: state.tier === 'studio'
    ? `This would pass your ${limit} of storage. Delete files in the Library to make room. Nothing already stored was removed.`
    : `This would pass the ${limit} of storage in ${PLANS[state.tier].name}. Upgrade your plan or delete files in the Library to make room. Nothing already stored was removed.` });
}

/** The billing period a usage row counts: the subscription's current period (one month back from its end), or the
 *  UTC calendar month for grants without one. */
export function usagePeriod(now: number, periodEnd?: number) {
  if (periodEnd !== undefined && periodEnd > now) {
    // One month back, clamped to the shorter month's last day (a period ending Mar 31 starts Feb 28), as Stripe bills.
    const end = new Date(periodEnd), lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
    const start = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, Math.min(end.getUTCDate(), lastDay), end.getUTCHours(), end.getUTCMinutes(), end.getUTCSeconds());
    if (start <= now) return { start, end: periodEnd };
  }
  const today = new Date(now);
  return { start: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1), end: Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1) };
}
const dayStartOf = (now: number) => now - now % DAY_MS;

async function usageRow(ctx: Context, ownerId: string, periodStart: number) {
  return ctx.db.query('aiUsagePeriods').withIndex('by_owner_period', q => q.eq('ownerId', ownerId).eq('periodStart', periodStart)).unique();
}

/** Adds one model call's estimated cost to the owner's current period. Always on: the allowance depends on it. */
export async function recordAiUsage(ctx: MutationCtx, ownerId: string, usd: number) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const now = Date.now(), plan = await activePlan(ctx, ownerId), period = usagePeriod(now, plan?.periodEnd), dayStart = dayStartOf(now);
  const row = await usageRow(ctx, ownerId, period.start);
  if (!row) { await ctx.db.insert('aiUsagePeriods', { ownerId, periodStart: period.start, periodEnd: period.end, usd, dayStart, dayUsd: usd, updatedAt: now }); return; }
  const dayUsd = (row.dayStart === dayStart ? row.dayUsd : 0) + usd;
  await ctx.db.patch(row._id, { usd: row.usd + usd, dayStart, dayUsd, periodEnd: period.end, updatedAt: now });
}

/** How much of the plan's AI allowance this owner has used, as shares (never dollars), or null where no limit applies. */
export async function aiUsageState(ctx: Context, ownerId: string, known?: Awaited<ReturnType<typeof limitedPlan>>) {
  const plan = known === undefined ? await limitedPlan(ctx, ownerId) : known;
  if (!plan) return null;
  const now = Date.now(), period = usagePeriod(now, plan.periodEnd), limits = PLAN_LIMITS[plan.tier];
  const row = await usageRow(ctx, ownerId, period.start), dayStart = dayStartOf(now);
  const used = (row?.usd ?? 0) / limits.aiMonthlyUsd;
  const today = limits.aiDailyUsd === null ? null : (row && row.dayStart === dayStart ? row.dayUsd : 0) / limits.aiDailyUsd;
  const blocked: 'month' | 'day' | null = used >= 1 ? 'month' : today !== null && today >= 1 ? 'day' : null;
  return { tier: plan.tier, used, today, blocked, resetsAt: period.end, dayResetsAt: dayStart + DAY_MS };
}

/** The refusal for an owner past the plan's AI allowance, or null. */
export async function aiUsageRefusal(ctx: Context, ownerId: string) {
  const state = await aiUsageState(ctx, ownerId);
  if (!state?.blocked) return null;
  const upgrade = state.tier === 'studio' ? '' : ' Upgrade your plan for more.';
  const message = state.blocked === 'month'
    ? `You’ve used this period’s AI usage. It resets on ${date(state.resetsAt)}.${upgrade}`
    : `You’ve used today’s AI usage. It resets at midnight UTC.${upgrade}`;
  return { code: 'usage_limit' as const, tier: state.tier, resetsAt: state.blocked === 'month' ? state.resetsAt : state.dayResetsAt, message };
}

/** Refuses a new assistant turn or model step past the plan's AI allowance. Client calls get the coded error the
 *  upgrade dialog reads; a running turn (`plain`) gets the message alone, which its chat shows as the stop reason. */
export async function requireAiAllowance(ctx: Context, ownerId: string, { plain = false }: { plain?: boolean } = {}) {
  const refusal = await aiUsageRefusal(ctx, ownerId);
  if (refusal) throw new ConvexError(plain ? refusal.message : refusal);
}
