import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { accountLimit } from './lib/account_limits';
import { flyRendersEnabled, seatedRenders } from './lib/render_seats';

type Lane = 'ultra' | 'standard';
type Pool = 'warm' | 'burst';
const LANES: Lane[] = ['ultra', 'standard'];
// Ultra exports get a 16-vCPU machine; regular exports 4 vCPUs. With BeginFrame capture, 8 workers
// saturate 16 vCPUs (16 measured no faster). Frames stream into the encoder, so the scratch volume
// (Fly's root filesystem is ~8 GB and slow) only holds sources and the output: a 98 s 4K60 export peaked under 0.4 GB.
/** Each export is split into up to `chunks` slices rendered at once on short-lived machines of `guest` size. */
const distributed = (chunks: number, guest: { cpu_kind: 'performance'; cpus: number; memory_mb: number }, env: Record<string, string>) => ({
  REVLINE_DISTRIBUTED_EXPORT: 'true', REVLINE_EXPORT_MAX_CHUNKS: String(chunks), REVLINE_EXPORT_CHUNK_GUEST: JSON.stringify(guest), REVLINE_EXPORT_CHUNK_ENV: JSON.stringify(env),
});
const PROFILES: Record<Lane, { guest: { cpu_kind: 'performance'; cpus: number; memory_mb: number }; scratchGb: number; env: Record<string, string> }> = {
  ultra: { guest: { cpu_kind: 'performance', cpus: 16, memory_mb: 32768 }, scratchGb: 20, env: { MEDIA_LANE: 'ultra', REVLINE_RENDER_WORKERS: '8', REVLINE_RENDER_FFMPEG_SLOTS: '4', REVLINE_RENDER_ENCODE_THREADS: '16', ...distributed(16, { cpu_kind: 'performance', cpus: 8, memory_mb: 16384 }, { REVLINE_RENDER_WORKERS: '4', REVLINE_RENDER_FFMPEG_SLOTS: '4', REVLINE_RENDER_ENCODE_THREADS: '8' }) } },
  standard: { guest: { cpu_kind: 'performance', cpus: 4, memory_mb: 8192 }, scratchGb: 10, env: { REVLINE_RENDER_WORKERS: '3', REVLINE_RENDER_FFMPEG_SLOTS: '2', REVLINE_RENDER_ENCODE_THREADS: '4', ...distributed(4, { cpu_kind: 'performance', cpus: 4, memory_mb: 8192 }, { REVLINE_RENDER_WORKERS: '3', REVLINE_RENDER_FFMPEG_SLOTS: '2', REVLINE_RENDER_ENCODE_THREADS: '4' }) } },
};
// A machine whose worker found no export for this long exits; Fly then stops it and CPU billing stops.
const IDLE_MS = '60000';
// A burst machine's volume outlives the destroyed machine; delete it once clearly orphaned.
const ORPHAN_VOLUME_MS = 10 * 60_000;
const ACTIVE_STATES = new Set(['created', 'starting', 'started', 'replacing', 'updating']);
type Mount = { volume: string; path: string };
type FlyMachine = { id: string; state: string; config?: { image?: string; mounts?: Mount[]; metadata?: Record<string, string> } };
type FlyVolume = { id: string; name: string; state: string; attached_machine_id?: string | null; created_at?: string };
type Config = NonNullable<ReturnType<typeof flyConfig>>;

function flyConfig() {
  const token = process.env.FLY_API_TOKEN, app = process.env.FLY_RENDER_APP, image = process.env.FLY_RENDER_IMAGE;
  if (!flyRendersEnabled() || !token || !app || !image) return null;
  return {
    token, app, image, region: process.env.FLY_RENDER_REGION || 'iad',
    max: { ultra: accountLimit('FLY_RENDER_MAX_ULTRA', 10, 0, 100), standard: accountLimit('FLY_RENDER_MAX_STANDARD', 10, 0, 100) } as Record<Lane, number>,
    // Warm machines keep their volume and image between exports; the rest are created per burst.
    warm: { ultra: accountLimit('FLY_RENDER_WARM_ULTRA', 1, 0, 20), standard: accountLimit('FLY_RENDER_WARM_STANDARD', 1, 0, 20) } as Record<Lane, number>,
  };
}

async function fly<T>(config: Config, method: string, path: string, body?: unknown): Promise<T> {
  // Deploy tokens are "FlyV1 …" macaroons sent as-is; plain API tokens use Bearer.
  const authorization = config.token.startsWith('FlyV1 ') ? config.token : `Bearer ${config.token}`;
  const response = await fetch(`https://api.machines.dev/v1/apps/${config.app}${path}`, { method, headers: { authorization, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Fly ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function machineConfig(config: Config, lane: Lane, pool: Pool, mounts: Mount[]) {
  const profile = PROFILES[lane];
  return {
    image: config.image, guest: profile.guest, mounts, restart: { policy: 'no' }, auto_destroy: pool === 'burst', metadata: { revline_lane: lane, revline_pool: pool },
    env: { ...profile.env, MEDIA_RENDERS_ONLY: 'true', MEDIA_WORKER_CONCURRENCY: '1', MEDIA_WORKER_IDLE_MS: IDLE_MS, MEDIA_TASK_DEADLINE_MS: String(45 * 60_000) },
  };
}

async function createMachine(config: Config, lane: Lane, pool: Pool) {
  const volume = await fly<FlyVolume>(config, 'POST', '/volumes', { name: `scratch_${pool}`, region: config.region, size_gb: PROFILES[lane].scratchGb, require_unique_zone: false });
  try {
    await fly(config, 'POST', '/machines', { region: config.region, config: machineConfig(config, lane, pool, [{ volume: volume.id, path: '/scratch' }]) });
  } catch (error) {
    await fly(config, 'DELETE', `/volumes/${volume.id}`).catch(() => {});
    throw error;
  }
}

/** Exports that may start now per lane (within owner seats) and exports already rendering. */
export const demand = internalQuery({ args: {}, returns: v.object({ ultra: v.object({ waiting: v.number(), running: v.number() }), standard: v.object({ waiting: v.number(), running: v.number() }) }), handler: async ctx => {
  const versioned = (q: import('convex/server').FilterBuilder<import('convex/server').GenericTableInfo>) => q.or(q.eq(q.field('requiredProcessorVersion'), undefined), q.lte(q.field('requiredProcessorVersion'), MEDIA_PROCESSOR_VERSION));
  const running = await ctx.db.query('mediaTasks').withIndex('by_status_claimable_kind_created', q => q.eq('status', 'running').eq('claimable', false).eq('kind', 'render')).take(200);
  const result = { ultra: { waiting: 0, running: 0 }, standard: { waiting: 0, running: 0 } };
  for (const lane of LANES) {
    result[lane].waiting = (await seatedRenders(ctx, lane === 'ultra' ? 'ultra' : undefined, versioned, 100)).length;
    result[lane].running = running.filter(task => (task.lane === 'ultra') === (lane === 'ultra')).length;
  }
  return result;
}});

/** Bring up enough Fly machines for the exports that may start: stopped warm machines first
 * (image and volume already on their host, so they boot in seconds), then new warm machines
 * up to the pool size, then burst machines that are destroyed after their export. */
export const dispatch = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  const config = flyConfig();
  if (!config) return null;
  try {
    const [wanted, machines] = await Promise.all([ctx.runQuery(internal.flyRender.demand, {}), fly<FlyMachine[]>(config, 'GET', '/machines')]);
    for (const lane of LANES) {
      const mine = machines.filter(machine => machine.config?.metadata?.revline_lane === lane && machine.state !== 'destroyed');
      const active = mine.filter(machine => ACTIVE_STATES.has(machine.state)).length;
      // Started machines not yet holding an export will claim the waiting ones themselves.
      const idle = Math.max(0, active - wanted[lane].running);
      let need = Math.min(wanted[lane].waiting - idle, config.max[lane] - active);
      const warm = mine.filter(machine => machine.config?.metadata?.revline_pool === 'warm');
      for (const machine of warm) {
        if (need <= 0) break;
        if (machine.state !== 'stopped') continue;
        // Updating a stopped machine launches it; this also moves it to the current image.
        if (machine.config?.image === config.image) await fly(config, 'POST', `/machines/${machine.id}/start`);
        else await fly(config, 'POST', `/machines/${machine.id}`, { config: machineConfig(config, lane, 'warm', machine.config?.mounts ?? []) });
        need--;
      }
      for (let count = warm.length; need > 0 && count < config.warm[lane]; count++, need--) await createMachine(config, lane, 'warm');
      for (; need > 0; need--) await createMachine(config, lane, 'burst');
    }
    const volumes = await fly<FlyVolume[]>(config, 'GET', '/volumes');
    for (const volume of volumes) {
      const age = Date.now() - Date.parse(volume.created_at ?? '');
      if (volume.name === 'scratch_burst' && !volume.attached_machine_id && volume.state !== 'destroyed' && age > ORPHAN_VOLUME_MS) await fly(config, 'DELETE', `/volumes/${volume.id}`).catch(() => {});
    }
  } catch (error) {
    // The once-a-minute cron retries; the export stays queued meanwhile.
    console.error('Fly export dispatch failed:', error instanceof Error ? error.message : error);
  }
  return null;
}});
