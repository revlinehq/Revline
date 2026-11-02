import { v } from 'convex/values';
import { z } from 'zod';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { accountLimit } from './lib/account_limits';
import { processorBackend } from './lib/processor_backend';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';

const machineSchema = z.object({ id: z.string(), state: z.string(), config: z.object({ metadata: z.record(z.string(), z.string()).optional() }).optional() });
const volumeSchema = z.object({ id: z.string(), name: z.string(), state: z.string(), attached_machine_id: z.string().nullable().optional(), created_at: z.string() });
const activeStates = new Set(['created', 'starting', 'started', 'replacing', 'updating', 'stopping']);
const lockName = 'processor';
// Longer than a dispatch's bounded API calls, including eight sequential creates.
const lockMs = 10 * 60_000;

function configuration() {
  const token = process.env.FLY_PROCESSOR_API_TOKEN, app = process.env.FLY_PROCESSOR_APP, image = process.env.FLY_PROCESSOR_IMAGE;
  if (!token || !app || !image) throw new Error('Fly processor app, image and API token are required.');
  const url = process.env.CONVEX_CLOUD_URL;
  if (url !== 'https://different-gnu-398.convex.cloud' && url !== 'https://majestic-alpaca-541.convex.cloud') throw new Error('Unknown processor deployment.');
  const production = url === 'https://different-gnu-398.convex.cloud';
  if (app !== (production ? 'revline-processor' : 'revline-processor-dev') || !image.startsWith(`registry.fly.io/${app}@sha256:`) || !/sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Fly processor app/image does not match this Convex environment.');
  const cpus = accountLimit('FLY_PROCESSOR_CPUS', 8, 4, 8);
  if (cpus !== 4 && cpus !== 8) throw new Error('FLY_PROCESSOR_CPUS must be 4 or 8.');
  return { token, app, image, cpus, region: process.env.FLY_PROCESSOR_REGION || 'iad', max: accountLimit('FLY_PROCESSOR_MAX_MACHINES', 4, 1, 8) };
}

async function fly(config: ReturnType<typeof configuration>, method: string, path: string, body?: unknown): Promise<unknown> {
  const authorization = config.token.startsWith('FlyV1 ') ? config.token : `Bearer ${config.token}`;
  const response = await fetch(`https://api.machines.dev/v1/apps/${config.app}${path}`, {
    method, headers: { authorization, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Fly processor ${method} ${path} failed (${response.status}).`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** Count every processing kind, including future kinds, through the ordinary queue. */
export const demand = internalQuery({ args: {}, returns: v.object({ waiting: v.number(), running: v.number() }), handler: async ctx => {
  const waiting = await ctx.db.query('mediaTasks').withIndex('by_status_claimable_created', q => q.eq('status', 'queued').eq('claimable', true))
    .filter(q => q.and(q.neq(q.field('kind'), 'render'), q.or(q.eq(q.field('requiredProcessorVersion'), undefined), q.lte(q.field('requiredProcessorVersion'), MEDIA_PROCESSOR_VERSION)))).take(8);
  const legacy = waiting.length < 8 ? await ctx.db.query('mediaTasks').withIndex('by_status_createdAt', q => q.eq('status', 'queued'))
    .filter(q => q.and(q.eq(q.field('claimable'), undefined), q.gt(q.field('attempt'), 0), q.neq(q.field('workflowId'), undefined), q.neq(q.field('kind'), 'render'), q.or(q.eq(q.field('requiredProcessorVersion'), undefined), q.lte(q.field('requiredProcessorVersion'), MEDIA_PROCESSOR_VERSION)))).take(8 - waiting.length) : [];
  const running = await ctx.db.query('mediaTasks').withIndex('by_status_claimable_created', q => q.eq('status', 'running').eq('claimable', false))
    .filter(q => q.neq(q.field('kind'), 'render')).take(100);
  return { waiting: waiting.length + legacy.length, running: running.length };
} });

export const acquireDispatch = internalMutation({ args: {}, returns: v.boolean(), handler: async ctx => {
  const row = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', lockName)).unique();
  if (row && row.lockedUntil > Date.now()) { await ctx.db.patch(row._id, { pending: true }); return false; }
  const fields = { lockedUntil: Date.now() + lockMs, pending: false };
  if (row) await ctx.db.patch(row._id, fields);
  else await ctx.db.insert('flyDispatchLocks', { name: lockName, ...fields });
  return true;
} });
export const releaseDispatch = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const row = await ctx.db.query('flyDispatchLocks').withIndex('by_name', q => q.eq('name', lockName)).unique();
  if (row) {
    await ctx.db.patch(row._id, { lockedUntil: 0, pending: false });
    if (row.pending) await ctx.scheduler.runAfter(0, internal.flyProcessor.dispatch, {});
  }
  return null;
} });

/** One slot per machine preserves task leases and gives each encoder the whole host. */
export const dispatch = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  if (!process.env.FLY_PROCESSOR_IMAGE || !await ctx.runMutation(internal.flyProcessor.acquireDispatch, {})) return null;
  try {
    const config = configuration();
    const [wanted, machines] = await Promise.all([ctx.runQuery(internal.flyProcessor.demand, {}), fly(config, 'GET', '/machines').then(value => z.array(machineSchema).parse(value))]);
    // Count all active machines in this dedicated app, even an interrupted create
    // whose acknowledgement was lost. The next cron cannot exceed the cap.
    for (const machine of machines) {
      if (machine.config?.metadata?.revline_processor === 'true' && ['stopped', 'failed'].includes(machine.state)) await fly(config, 'DELETE', `/machines/${machine.id}?force=true`);
    }
    const active = machines.filter(machine => activeStates.has(machine.state)).length;
    let need = processorBackend() === 'fly' ? Math.min(Math.max(0, wanted.waiting - Math.max(0, active - wanted.running)), config.max - active) : 0;
    for (; need > 0; need--) {
      const volume = volumeSchema.parse(await fly(config, 'POST', '/volumes', { name: 'processor_scratch', region: config.region, size_gb: 20, require_unique_zone: false, snapshot_retention: 1, auto_backup_enabled: false }));
      try { await fly(config, 'POST', '/machines', { region: config.region, config: {
        image: config.image, guest: { cpu_kind: 'performance', cpus: config.cpus, memory_mb: config.cpus * 2048 },
        restart: { policy: 'no' }, auto_destroy: true,
        // No public services. fly-entry.sh clears scratch and drops root privileges.
        mounts: [{ volume: volume.id, path: '/scratch' }],
        env: { MEDIA_PROCESSOR_BACKEND: 'fly', MEDIA_WORKER_CONCURRENCY: '1', MEDIA_WORKER_IDLE_MS: '60000',
          MEDIA_PROCESSOR_THREADS: String(config.cpus), MEDIA_PREVIEW_CPUS: String(config.cpus),
          BEAT_TRACK_THREADS: String(config.cpus), OMP_NUM_THREADS: String(config.cpus), MKL_NUM_THREADS: String(config.cpus), OMP_THREAD_LIMIT: String(config.cpus) },
        metadata: { revline_processor: 'true', revline_version: String(MEDIA_PROCESSOR_VERSION) },
      } }); } catch (error) {
        // A timed-out create may have succeeded. Never delete an attached volume.
        const current = volumeSchema.parse(await fly(config, 'GET', `/volumes/${volume.id}`));
        if (!current.attached_machine_id) await fly(config, 'DELETE', `/volumes/${volume.id}`);
        throw error;
      }
    }
    // The Machine auto-destroys at idle. Remove its detached scratch on the next
    // reconciliation, with grace for a create whose response was interrupted.
    const volumes = z.array(volumeSchema).parse(await fly(config, 'GET', '/volumes'));
    for (const volume of volumes) {
      if (['processor_scratch', 'processor_preflight'].includes(volume.name) && volume.state !== 'destroyed' && !volume.attached_machine_id && Date.now() - Date.parse(volume.created_at) > 10 * 60_000) await fly(config, 'DELETE', `/volumes/${volume.id}`);
    }
  } catch (error) {
    console.error('Fly processor dispatch failed; the queue is retained for scheduled recovery.', error instanceof Error ? error.message : 'Unknown error');
  } finally { await ctx.runMutation(internal.flyProcessor.releaseDispatch, {}); }
  return null;
} });
