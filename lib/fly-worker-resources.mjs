import { z } from 'zod';

// The user's budget is per machine, independent of lane seats and machine counts.
export const FLY_WORKER_GUEST = Object.freeze({ cpu_kind: 'performance', cpus: 4, memory_mb: 8192 });
export const FLY_RENDER_CPU_ENV = Object.freeze({
  REVLINE_RENDER_WORKERS: '2', REVLINE_RENDER_FFMPEG_SLOTS: '2', REVLINE_RENDER_ENCODE_THREADS: '4',
  MEDIA_PROCESSOR_THREADS: '4', MEDIA_PREVIEW_CPUS: '4',
});
export const FLY_PROCESSOR_CPU_ENV = Object.freeze({
  ...FLY_RENDER_CPU_ENV, BEAT_TRACK_THREADS: '4', OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4', OMP_THREAD_LIMIT: '4',
});

/** Preserve the existing four-CPU override; reject legacy eight-CPU settings.
 * @param {string | undefined} raw */
export function flyProcessorGuest(raw) {
  if (raw !== undefined && Number(raw) !== FLY_WORKER_GUEST.cpus) throw new Error('FLY_PROCESSOR_CPUS must be 4 (per-machine maximum: 4 CPUs / 8192 MB).');
  return FLY_WORKER_GUEST;
}

const chunkGuestSchema = z.object({
  cpu_kind: z.enum(['performance', 'shared']),
  cpus: z.number().int().min(1).max(FLY_WORKER_GUEST.cpus),
  memory_mb: z.number().int().min(256).max(FLY_WORKER_GUEST.memory_mb),
}).strict();
const chunkEnvSchema = z.record(z.string(), z.string());

/** Validate operator-provided chunk settings before any Fly request.
 * @param {{ guest?: unknown, env?: unknown }} settings */
export function flyChunkResources({ guest, env }) {
  const parsedGuest = chunkGuestSchema.parse(guest === undefined ? FLY_WORKER_GUEST : guest);
  const parsedEnv = chunkEnvSchema.parse(env === undefined ? {} : env);
  const defaults = Object.fromEntries(Object.entries(FLY_PROCESSOR_CPU_ENV).map(([name, value]) => [name, String(Math.min(Number(value), parsedGuest.cpus))]));
  for (const name of Object.keys(defaults)) {
    if (parsedEnv[name] === undefined) continue;
    const value = Number(parsedEnv[name]);
    if (!Number.isInteger(value) || value < 1 || value > parsedGuest.cpus) throw new Error(`${name} must be between 1 and ${parsedGuest.cpus} for this chunk machine.`);
  }
  return { chunkGuest: parsedGuest, chunkEnv: { ...defaults, ...parsedEnv } };
}
