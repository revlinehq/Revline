import { v } from 'convex/values';
import { internalAction, internalMutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { processorBackend } from './lib/processor_backend';
import { requireMediaWorker } from './lib/media_task_auth';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { accountLimit } from './lib/account_limits';
import { RailwayRateLimitError, railwayConfig, verifyRailwayTarget, verifyRailwaySlot, railwayActive, deployRailwaySlot, reapRailwayServices } from '../lib/railway-workers.mjs';

// The existing lock table is a dispatch mutex, independent of the hosting provider.
const lockName = 'railway';
export const contract = query({ args: { workerSecret: v.string() }, returns: v.object({ processorVersion: v.number(), processorBackend: v.string(), renderProvider: v.string(), paused: v.boolean() }), handler: (_ctx, args) => {
  requireMediaWorker(args.workerSecret);
  return { processorVersion: MEDIA_PROCESSOR_VERSION, processorBackend: processorBackend(), renderProvider: process.env.RENDER_PROVIDER || '', paused: process.env.RAILWAY_WORKERS_PAUSED === 'true' };
} });
export const acquireDispatch = internalMutation({ args: {}, returns: v.boolean(), handler: async ctx => {
  const cooldown = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', 'railway-rate-limit')).unique();
  if (cooldown && cooldown.lockedUntil > Date.now()) return false;
  const row = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', lockName)).unique();
  if (row && row.lockedUntil > Date.now()) { await ctx.db.patch(row._id, { pending: true }); return false; }
  const fields = { lockedUntil: Date.now() + 10 * 60_000, pending: false };
  if (row) await ctx.db.patch(row._id, fields);
  else await ctx.db.insert('flyDispatchLocks', { name: lockName, ...fields });
  return true;
} });
export const deferDispatch = internalMutation({ args: { delayMs: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const name = 'railway-rate-limit';
  const row = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', name)).unique();
  const fields = { lockedUntil: Math.max(row?.lockedUntil ?? 0, Date.now() + args.delayMs), pending: false };
  if (row) await ctx.db.patch(row._id, fields); else await ctx.db.insert('flyDispatchLocks', { name, ...fields });
  return null;
} });
export const releaseDispatch = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const row = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', lockName)).unique();
  if (row) {
    await ctx.db.patch(row._id, { lockedUntil: 0, pending: false });
    if (row.pending) await ctx.scheduler.runAfter(0, internal.railwayWorkers.dispatch, {});
  }
  return null;
} });
// A control request can succeed after its acknowledgement times out. Hold the
// slot briefly across reconciliations so eventual API reads cannot redeploy it twice.
export const reserveStart = internalMutation({ args: { serviceId: v.string() }, returns: v.boolean(), handler: async (ctx, args) => {
  const name = `railway-start:${args.serviceId}`;
  const row = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', name)).unique();
  if (row && row.lockedUntil > Date.now()) return false;
  const fields = { lockedUntil: Date.now() + 2 * 60_000, pending: false };
  if (row) await ctx.db.patch(row._id, fields); else await ctx.db.insert('flyDispatchLocks', { name, ...fields });
  return true;
} });

/** One preconfigured service per slot. Never resize, kill busy workers or create an unbounded pool. */
export const dispatch = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  if (!process.env.RAILWAY_WORKERS_JSON || !await ctx.runMutation(internal.railwayWorkers.acquireDispatch, {})) return null;
  try {
    const config = railwayConfig(process.env.RAILWAY_WORKERS_JSON), token = process.env.RAILWAY_API_TOKEN;
    if (!token || config.convexUrl !== process.env.CONVEX_CLOUD_URL) throw new Error('Railway workers target another Convex deployment.');
    const target = { token, config };
    await verifyRailwayTarget(target);
    await reapRailwayServices(target);
    if (process.env.RAILWAY_WORKERS_PAUSED === 'true') return null;
    const processor = await ctx.runQuery(internal.flyProcessor.demand, {});
    const exports = await ctx.runQuery(internal.flyRender.demand, {});
    const pools = [
      { ids: config.processorServices, max: accountLimit('FLY_PROCESSOR_MAX_MACHINES', 4, 1, 8), image: config.processorImage, enabled: processorBackend() === 'railway', demand: processor },
      { ids: config.standardServices, max: accountLimit('FLY_RENDER_MAX_STANDARD', 10, 0, 100), image: config.exportsImage, enabled: process.env.RENDER_PROVIDER === 'railway', demand: exports.standard },
      { ids: config.ultraServices, max: accountLimit('FLY_RENDER_MAX_ULTRA', 10, 0, 100), image: config.exportsImage, enabled: process.env.RENDER_PROVIDER === 'railway', demand: exports.ultra },
    ];
    const deadline = Date.now() + 5 * 60_000;
    for (const pool of pools) {
      if (!pool.enabled || pool.demand.waiting === 0) continue;
      if (pool.ids.length > pool.max) throw new Error('Railway pool exceeds the existing capacity setting; dispatch held.');
      const instances = [];
      for (const serviceId of pool.ids) {
        if (Date.now() >= deadline) return null;
        instances.push(await verifyRailwaySlot({ ...target, serviceId, image: pool.image }));
      }
      const active = instances.filter(railwayActive).length;
      let needed = Math.max(0, pool.demand.waiting - Math.max(0, active - pool.demand.running));
      for (const instance of instances) {
        if (needed === 0 || Date.now() >= deadline) break;
        if (railwayActive(instance)) continue;
        if (!await ctx.runMutation(internal.railwayWorkers.reserveStart, { serviceId: instance.serviceId })) continue;
        // A lost acknowledgement is reconciled from latestDeployment next time.
        await deployRailwaySlot({ ...target, serviceId: instance.serviceId });
        needed--;
      }
    }
  } catch (error) {
    if (error instanceof RailwayRateLimitError) await ctx.runMutation(internal.railwayWorkers.deferDispatch, { delayMs: error.retryAfterMs });
    console.error('Railway dispatch held; queued work is retained for recovery.', error instanceof Error ? error.message : 'Unknown error');
  } finally { await ctx.runMutation(internal.railwayWorkers.releaseDispatch, {}); }
  return null;
} });
