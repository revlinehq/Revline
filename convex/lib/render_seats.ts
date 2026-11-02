import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { accountLimit } from './account_limits';

/** With RENDER_PROVIDER=fly, exports run on on-demand Fly.io machines; every
 * other media task stays on the regular processors, which then skip exports. */
export const flyRendersEnabled = () => process.env.RENDER_PROVIDER === 'fly';

/** Exports one account renders at once; further exports wait in the queue.
 * Ultra exports carry lane 'ultra' from enqueue. */
const renderSeats = (lane?: 'ultra') => lane === 'ultra'
  ? accountLimit('RENDER_SEATS_ULTRA', 10, 1, 50)
  : accountLimit('RENDER_SEATS_STANDARD', 2, 1, 20);

/** Exports an account may have queued or rendering at once (seats plus a waiting line). */
export const queuedExportLimit = (ultra: boolean) => ultra
  ? accountLimit('MAX_QUEUED_EXPORTS_ULTRA', 30, 1, 200)
  : accountLimit('MAX_QUEUED_EXPORTS_STANDARD', 10, 1, 100);

const SCAN = 64;
type Versioned = (q: import('convex/server').FilterBuilder<import('convex/server').GenericTableInfo>) => import('convex/server').Expression<boolean>;

async function runningRenders(ctx: MutationCtx | QueryCtx, ownerId: string, limit: number) {
  return (await ctx.db.query('mediaTasks').withIndex('by_owner_status', q => q.eq('ownerId', ownerId).eq('status', 'running')).filter(q => q.eq(q.field('kind'), 'render')).take(limit)).length;
}

/** Queued exports of one lane that may start now, oldest first, honoring each owner's seats.
 * Stops after `want` tasks; reads at most SCAN queued rows plus one bounded read per owner. */
export async function seatedRenders(ctx: MutationCtx | QueryCtx, lane: 'ultra' | undefined, versioned: Versioned, want = 1): Promise<Doc<'mediaTasks'>[]> {
  const candidates = await ctx.db.query('mediaTasks').withIndex('by_status_claimable_kind_created', q => q.eq('status', 'queued').eq('claimable', true).eq('kind', 'render'))
    .filter(q => q.and(versioned(q), q.eq(q.field('lane'), lane))).take(SCAN);
  const seats = renderSeats(lane), busy = new Map<string, number>(), chosen: Doc<'mediaTasks'>[] = [];
  for (const task of candidates) {
    if (!busy.has(task.ownerId)) busy.set(task.ownerId, await runningRenders(ctx, task.ownerId, seats));
    if (busy.get(task.ownerId)! >= seats) continue;
    busy.set(task.ownerId, busy.get(task.ownerId)! + 1);
    chosen.push(task);
    if (chosen.length >= want) break;
  }
  return chosen;
}
