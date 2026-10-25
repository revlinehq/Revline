import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { accountLimit } from './lib/account_limits';
import { flyRendersEnabled, seatedRenders } from './lib/render_seats';

type Lane = 'ultra' | 'standard';
const LANES: Lane[] = ['ultra', 'standard'];
// Ultra exports get a 16-vCPU machine with more capture workers; regular exports 4 vCPUs.
const PROFILES: Record<Lane, { guest: { cpu_kind: 'performance'; cpus: number; memory_mb: number }; env: Record<string, string> }> = {
  ultra: { guest: { cpu_kind: 'performance', cpus: 16, memory_mb: 32768 }, env: { MEDIA_LANE: 'ultra', REVLINE_RENDER_WORKERS: '8', REVLINE_RENDER_FFMPEG_SLOTS: '4', REVLINE_RENDER_ENCODE_THREADS: '16' } },
  standard: { guest: { cpu_kind: 'performance', cpus: 4, memory_mb: 8192 }, env: { REVLINE_RENDER_WORKERS: '3', REVLINE_RENDER_FFMPEG_SLOTS: '2', REVLINE_RENDER_ENCODE_THREADS: '4' } },
};
// A machine whose worker found no export for this long exits; Fly then stops it and billing stops.
const IDLE_MS = '60000';
const ACTIVE_STATES = new Set(['created', 'starting', 'started', 'replacing']);
type FlyMachine = { id: string; state: string; config?: { image?: string; metadata?: Record<string, string> } };

function flyConfig() {
  const token = process.env.FLY_API_TOKEN, app = process.env.FLY_RENDER_APP, image = process.env.FLY_RENDER_IMAGE;
  if (!flyRendersEnabled() || !token || !app || !image) return null;
  return { token, app, image, region: process.env.FLY_RENDER_REGION || 'iad', max: { ultra: accountLimit('FLY_RENDER_MAX_ULTRA', 10, 0, 100), standard: accountLimit('FLY_RENDER_MAX_STANDARD', 10, 0, 100) } as Record<Lane, number> };
}

async function fly<T>(config: NonNullable<ReturnType<typeof flyConfig>>, method: string, path: string, body?: unknown): Promise<T> {
  // Deploy tokens are "FlyV1 …" macaroons sent as-is; plain API tokens use Bearer.
  const authorization = config.token.startsWith('FlyV1 ') ? config.token : `Bearer ${config.token}`;
  const response = await fetch(`https://api.machines.dev/v1/apps/${config.app}${path}`, { method, headers: { authorization, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Fly ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
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

/** Bring up enough Fly machines for the exports that may start: stopped machines first
 * (their image is already on the host, so they boot in seconds), then new ones. */
export const dispatch = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  const config = flyConfig();
  if (!config) return null;
  try {
    const [wanted, machines] = await Promise.all([ctx.runQuery(internal.flyRender.demand, {}), fly<FlyMachine[]>(config, 'GET', '/machines')]);
    for (const lane of LANES) {
      const mine = machines.filter(machine => machine.config?.metadata?.revline_lane === lane);
      const active = mine.filter(machine => ACTIVE_STATES.has(machine.state)).length;
      // Started machines not yet holding an export will claim the waiting ones themselves.
      const idle = Math.max(0, active - wanted[lane].running);
      let need = Math.min(wanted[lane].waiting - idle, config.max[lane] - active);
      for (const machine of mine) {
        if (need <= 0) break;
        if (machine.state !== 'stopped') continue;
        // A stopped machine on an older image is replaced rather than started.
        if (machine.config?.image !== config.image) { await fly(config, 'DELETE', `/machines/${machine.id}?force=true`).catch(() => {}); continue; }
        await fly(config, 'POST', `/machines/${machine.id}/start`); need--;
      }
      for (; need > 0; need--) {
        const profile = PROFILES[lane];
        await fly(config, 'POST', '/machines', { region: config.region, config: {
          image: config.image, guest: profile.guest, restart: { policy: 'no' }, auto_destroy: false, metadata: { revline_lane: lane },
          env: { ...profile.env, MEDIA_RENDERS_ONLY: 'true', MEDIA_WORKER_CONCURRENCY: '1', MEDIA_WORKER_IDLE_MS: IDLE_MS },
        } });
      }
    }
  } catch (error) {
    // The once-a-minute cron retries; the export stays queued meanwhile.
    console.error('Fly export dispatch failed:', error instanceof Error ? error.message : error);
  }
  return null;
}});
