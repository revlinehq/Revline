import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';

const MINUTE_MS = 60_000, DAY_MS = 86_400_000;
/** One upload legitimately queues three tasks (extract, preview, understand),
 * so the default admits eight sources transferring and preparing at once. */
export const DEFAULT_MAX_ACTIVE_MEDIA_TASKS = 24;
/** Fresh preparation tasks queued by one source upload. */
export const uploadPreparationTasks = (kind: 'video' | 'audio' | 'image') => kind === 'video' ? 3 : kind === 'audio' ? 2 : 0;

/** An abandoned transfer stops holding capacity after this; its completion still meets the ceiling. */
export const UPLOAD_RESERVATION_MS = 3600_000;

/** Operator override from Convex env, validated, else the default. */
export function accountLimit(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}
export const activeMediaTaskLimit = () => accountLimit('MAX_ACTIVE_MEDIA_TASKS_PER_ACCOUNT', DEFAULT_MAX_ACTIVE_MEDIA_TASKS, 3, 200);

/** Outstanding (queued, running, retrying) worker tasks across all of an owner's projects. */
export async function activeMediaTasks(ctx: QueryCtx | MutationCtx, ownerId: string, cap: number) {
  const rows = await Promise.all((['queued', 'running', 'retrying'] as const).map(status => ctx.db.query('mediaTasks').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', status)).take(cap)));
  return rows.reduce((count, tasks) => count + tasks.length, 0);
}
/** Recent source transfers hold the preparation tasks they will queue, so
 * parallel starts cannot each see an empty account and move their bytes. */
async function reservedByUploads(ctx: QueryCtx | MutationCtx, ownerId: string, cap: number) {
  const now = Date.now();
  const leases = await ctx.db.query('r2Uploads').withIndex('by_owner_completed', q => q.eq('ownerId', ownerId).eq('completed', false)).filter(q => q.and(q.eq(q.field('taskId'), undefined), q.eq(q.field('jobId'), undefined), q.neq(q.field('kind'), 'image'), q.gt(q.field('_creationTime'), now - UPLOAD_RESERVATION_MS), q.gt(q.field('expiresAt'), now))).take(cap);
  return leases.reduce((count, lease) => count + uploadPreparationTasks(lease.kind), 0);
}
/** User-initiated work must fit beside the account's outstanding tasks and
 * transfers. The reads share the caller's transaction, so parallel requests
 * cannot race past it. Follow-up tasks of accepted work never call this and are
 * never dropped. `ceiling` widens the limit where an earlier check already
 * applied it; a finishing upload passes `countUploads: false` to skip itself. */
export async function requireMediaTaskCapacity(ctx: QueryCtx | MutationCtx, ownerId: string, incoming: number, { ceiling = 1, countUploads = true }: { ceiling?: number; countUploads?: boolean } = {}) {
  const limit = activeMediaTaskLimit(), allowed = limit * ceiling;
  if (incoming <= 0) return;
  const used = await activeMediaTasks(ctx, ownerId, allowed) + (countUploads ? await reservedByUploads(ctx, ownerId, allowed) : 0);
  if (used + incoming > allowed) throw new ConvexError(`Your account has too many media jobs processing (up to ${limit} at once). Wait for some to finish, then try again.`);
}

type Quota = { period: number; max: number; message: string };
/** Fixed windows aligned to UTC minutes and days. One row per owner, name and
 * period keeps each check to a single indexed read; a refused request rolls
 * back with its mutation and consumes nothing. */
export async function consumeAccountQuota(ctx: MutationCtx, ownerId: string, name: string, quotas: readonly Quota[]) {
  const now = Date.now();
  for (const quota of quotas) {
    const windowStart = now - now % quota.period;
    const row = await ctx.db.query('accountRateLimits').withIndex('by_owner_name_period', q => q.eq('ownerId', ownerId).eq('name', name).eq('period', quota.period)).unique();
    const count = row && row.windowStart === windowStart ? row.count : 0;
    if (count >= quota.max) throw new ConvexError(quota.message);
    if (row) await ctx.db.patch(row._id, { windowStart, count: count + 1 });
    else await ctx.db.insert('accountRateLimits', { ownerId, name, period: quota.period, windowStart, count: 1 });
  }
}

export async function consumeVideoImport(ctx: MutationCtx, ownerId: string, createsProject: boolean) {
  const imports = accountLimit('VIDEO_IMPORTS_PER_DAY_PER_ACCOUNT', 30, 1, 1000);
  await consumeAccountQuota(ctx, ownerId, 'videoImport', [{ period: DAY_MS, max: imports, message: `You have reached today's limit of ${imports} video-link imports. It resets at midnight UTC.` }]);
  if (!createsProject) return;
  const projects = accountLimit('IMPORT_PROJECTS_PER_DAY_PER_ACCOUNT', 20, 1, 1000);
  await consumeAccountQuota(ctx, ownerId, 'importProject', [{ period: DAY_MS, max: projects, message: `You have reached today's limit of ${projects} new edits from video links. Import into an existing edit, or try again after midnight UTC.` }]);
}

/** Counted at submission, so a queued message is charged once, when sent. */
export async function consumeAssistantRequest(ctx: MutationCtx, ownerId: string) {
  const perMinute = accountLimit('AI_REQUESTS_PER_MINUTE_PER_ACCOUNT', 20, 1, 120), perDay = accountLimit('AI_REQUESTS_PER_DAY_PER_ACCOUNT', 200, 1, 10_000);
  await consumeAccountQuota(ctx, ownerId, 'assistantRequest', [
    { period: MINUTE_MS, max: perMinute, message: 'You are sending AI requests too quickly. Wait a minute, then try again.' },
    { period: DAY_MS, max: perDay, message: `You have reached today's limit of ${perDay} AI requests. It resets at midnight UTC.` },
  ]);
}
