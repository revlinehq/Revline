import { v } from 'convex/values';
import { internalAction, internalMutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { processorBackend } from './lib/processor_backend';
import { requireMediaWorker } from './lib/media_task_auth';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { workerCapacity } from '../lib/worker-capacity.mjs';
import { RailwayRateLimitError, railwayConfig, verifyRailwayTarget, verifyRailwaySlot, railwayActive, deployRailwaySlot, reapRailwayServices, railwayDeployments, railwayDeploymentCommit, railwayGoodDeployments, railwayBootCrashed } from '../lib/railway-workers.mjs';

// The existing lock table is a dispatch mutex, independent of the hosting provider.
const lockName = 'railway';
// imageSlots: this backend's dispatcher starts permanent slots that run a pinned registry image (lib/railway-workers.mjs).
// Releases switch slots to the staged image only when it is true; an older backend would hold dispatch for them.
export const contract = query({ args: { workerSecret: v.string() }, returns: v.object({ processorVersion: v.number(), processorBackend: v.string(), renderProvider: v.string(), paused: v.boolean(), imageSlots: v.optional(v.boolean()) }), handler: (_ctx, args) => {
  requireMediaWorker(args.workerSecret);
  return { processorVersion: MEDIA_PROCESSOR_VERSION, processorBackend: processorBackend(), renderProvider: process.env.RENDER_PROVIDER || '', paused: process.env.RAILWAY_WORKERS_PAUSED === 'true', imageSlots: true };
} });
export const releaseEvidence = query({
  args: { workerSecret: v.string(), projectId: v.id('projects'), processorTaskId: v.id('mediaTasks'), exportTaskId: v.id('mediaTasks'), ultraTaskId: v.id('mediaTasks'), distributedTaskId: v.optional(v.id('mediaTasks')) },
  returns: v.object({ checkedAt: v.number(), processorCommit: v.string(), exportsCommit: v.string(), processorImage: v.string(), exportsImage: v.string() }),
  handler: async (ctx, args) => {
    if (requireMediaWorker(args.workerSecret) !== 'processor') throw new Error('Release evidence requires the staging processor credential.');
    if (String(process.env.CONVEX_SITE_URL) !== 'https://striped-starling-234.convex.site' || process.env.REVLINE_ISOLATED !== 'true') throw new Error('Release evidence belongs only to the isolated staging backend.');
    if (processorBackend() !== 'railway' || process.env.RENDER_PROVIDER !== 'railway') throw new Error('Staging must actually route processing and exports to Railway.');
    const config = railwayConfig(process.env.RAILWAY_WORKERS_JSON);
    if (config.environment !== 'staging' || config.distributedExports !== !!args.distributedTaskId) throw new Error('Staging evidence must match the configured distributed-export mode.');
    const ids = [args.processorTaskId, args.exportTaskId, args.ultraTaskId, ...(args.distributedTaskId ? [args.distributedTaskId] : [])];
    if (new Set(ids).size !== ids.length) throw new Error('Distinct completed staging jobs are required.');
    const tasks = await Promise.all(ids.map(id => ctx.db.get(id)));
    for (const [index, task] of tasks.entries()) {
      if (!task || task.projectId !== args.projectId || task.status !== 'completed' || (index === 0 ? task.kind === 'render' : task.kind !== 'render')) throw new Error('Staging processing/export evidence is missing or incomplete.');
    }
    for (const [index, task] of tasks.entries()) {
      if (index === 0) continue;
      if (!task?.renderJobId) throw new Error('Staging export job is missing.');
      const job = await ctx.db.get(task.renderJobId);
      if (!job || job.status !== 'completed' || (index === 1 ? (job.resolution ?? 1080) >= 2160 : index === 2 && (job.resolution ?? 1080) < 2160)) throw new Error('Staging evidence must include completed standard and Ultra exports.');
    }
    return { checkedAt: Date.now(), processorCommit: config.processorCommit ?? '', exportsCommit: config.exportsCommit ?? '', processorImage: config.processorImage ?? '', exportsImage: config.exportsImage ?? '' };
  },
});
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

// A build that crashed on boot is not started again for this long; the slot falls back to its previous build meanwhile.
const BOOT_CRASH_HOLD_MS = 30 * 60_000;
/** 'held': this lane's build crashed on boot within the hold. 'first' / 'expired': it did not, or the hold ran out; the
 *  hold starts (again) now. The existing lock table keeps one row per lane and crashed build. */
export const holdBootCrash = internalMutation({ args: { lane: v.string(), build: v.string() }, returns: v.union(v.literal('held'), v.literal('first'), v.literal('expired')), handler: async (ctx, args) => {
  const name = `railway-boot-crash:${args.lane}:${args.build}`;
  const row = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', name)).unique();
  if (row && row.lockedUntil > Date.now()) return 'held';
  const fields = { lockedUntil: Date.now() + BOOT_CRASH_HOLD_MS, pending: false };
  if (row) await ctx.db.patch(row._id, fields); else await ctx.db.insert('flyDispatchLocks', { name, ...fields });
  return row ? 'expired' : 'first';
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
    const processor = await ctx.runQuery(internal.queueDemand.processingDemand, {});
    const exports = await ctx.runQuery(internal.queueDemand.exportDemand, {});
    const capacity = workerCapacity();
    const pools = [
      { name: 'processor', ids: config.processorServices, max: capacity.processor, image: config.processorImage, enabled: processorBackend() === 'railway', demand: processor },
      { name: 'standard', ids: config.standardServices, max: capacity.standard, image: config.exportsImage, enabled: process.env.RENDER_PROVIDER === 'railway', demand: exports.standard },
      { name: 'ultra', ids: config.ultraServices, max: capacity.ultra, image: config.exportsImage, enabled: process.env.RENDER_PROVIDER === 'railway', demand: exports.ultra },
    ];
    const deadline = Date.now() + 5 * 60_000;
    type Instance = Awaited<ReturnType<typeof verifyRailwaySlot>>;
    type Deployment = NonNullable<Instance['latestDeployment']>;
    // One hold decision per lane and crashed build per dispatch, so many slots on one bad build cost one incident.
    const holds = new Map<string, 'held' | 'first' | 'expired'>();
    /** undefined: start the latest build as usual. Deployments: start the first of these earlier builds that Railway
     *  accepts instead. null: start nothing. A latest build that failed, or crashed before its worker came up, is held
     *  for BOOT_CRASH_HOLD_MS per lane and reported; meanwhile the slot runs the newest earlier build that ran. With
     *  none, the crashed build is retried once per hold. */
    const startableBuilds = async (instance: Instance, lane: string): Promise<Deployment[] | null | undefined> => {
      const latest = instance.latestDeployment;
      if (!latest || (latest.status !== 'CRASHED' && latest.status !== 'FAILED')) return undefined;
      if (latest.status === 'CRASHED' && !await railwayBootCrashed({ token, deploymentId: latest.id })) return undefined;
      const build = railwayDeploymentCommit(latest) ?? latest.id;
      const key = `${lane}:${build}`;
      const first = !holds.has(key);
      const hold = holds.get(key) ?? await ctx.runMutation(internal.railwayWorkers.holdBootCrash, { lane, build });
      holds.set(key, hold === 'held' ? 'held' : hold);
      const fallbacks = railwayGoodDeployments(await railwayDeployments({ ...target, serviceId: instance.serviceId }), deployment => deployment.id === latest.id || (railwayDeploymentCommit(deployment) ?? deployment.id) === build);
      if (first && hold !== 'held') {
        const message = `Railway ${lane} build ${build.slice(0, 12)} ${latest.status === 'FAILED' ? 'failed to build or deploy' : 'crashed on boot'}; not started again for ${BOOT_CRASH_HOLD_MS / 60_000} min. ${fallbacks.length ? `Running the previous build ${(railwayDeploymentCommit(fallbacks[0]) ?? fallbacks[0].id).slice(0, 12)} meanwhile.` : 'No earlier build ran: the lane waits.'}`;
        console.error(message);
        await ctx.runMutation(internal.incidents.reportIncident, { source: 'railway', kind: 'worker-boot-crash', message, context: { location: 'convex/railwayWorkers:dispatch', taskKind: lane, event: 'boot-crash' }, deployment: 'server' }).catch(() => undefined);
      }
      if (fallbacks.length) return fallbacks.slice(0, 3);
      return hold === 'expired' && latest.status === 'CRASHED' ? [latest] : null;
    };
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
        // Never a chosen commit: the slot's own latest build (Railway autodeploys main), unless that build crashed on boot.
        const start = await startableBuilds(instance, pool.name);
        if (start === null) continue;
        if (!await ctx.runMutation(internal.railwayWorkers.reserveStart, { serviceId: instance.serviceId })) continue;
        // A lost acknowledgement is reconciled from latestDeployment next time.
        if (!start) await deployRailwaySlot({ ...target, serviceId: instance.serviceId });
        else {
          let started = false;
          for (const deployment of start) {
            try { await deployRailwaySlot({ ...target, serviceId: instance.serviceId, deployment }); started = true; break; }
            catch (error) { if (error instanceof RailwayRateLimitError) throw error; console.error(`Railway ${pool.name} slot ${instance.serviceId}: earlier build ${deployment.id} could not be redeployed; trying the next.`); }
          }
          if (!started) continue;
        }
        needed--;
      }
    }
  } catch (error) {
    if (error instanceof RailwayRateLimitError) await ctx.runMutation(internal.railwayWorkers.deferDispatch, { delayMs: error.retryAfterMs });
    console.error('Railway dispatch held; queued work is retained for recovery.', error instanceof Error ? error.message : 'Unknown error');
  } finally { await ctx.runMutation(internal.railwayWorkers.releaseDispatch, {}); }
  return null;
} });
