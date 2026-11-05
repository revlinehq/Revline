import { z } from 'zod';

// Temporary chunk budget; permanent service limits come from the dashboard.
export const EXPORT_CHUNK_GUEST = Object.freeze({ cpu_kind: 'performance', cpus: 4, memory_mb: 8192 });
export const EXPORT_CHUNK_CPU_ENV = Object.freeze({
  REVLINE_RENDER_WORKERS: '2', REVLINE_RENDER_FFMPEG_SLOTS: '2', REVLINE_RENDER_ENCODE_THREADS: '4',
  MEDIA_PROCESSOR_THREADS: '4', MEDIA_PREVIEW_CPUS: '4',
});
export const EXPORT_CHUNK_NATIVE_ENV = Object.freeze({
  ...EXPORT_CHUNK_CPU_ENV, BEAT_TRACK_THREADS: '4', OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4', OMP_THREAD_LIMIT: '4',
});

const chunkGuestSchema = z.object({
  cpu_kind: z.enum(['performance', 'shared']),
  cpus: z.number().int().min(1).max(EXPORT_CHUNK_GUEST.cpus),
  memory_mb: z.number().int().min(256).max(EXPORT_CHUNK_GUEST.memory_mb),
}).strict();
const chunkEnvSchema = z.record(z.string(), z.string());

/** Validate operator-provided chunk settings before any chunk allocation.
 * @param {{ guest?: unknown, env?: unknown }} settings */
export function exportChunkResources({ guest, env }) {
  const parsedGuest = chunkGuestSchema.parse(guest === undefined ? EXPORT_CHUNK_GUEST : guest);
  const parsedEnv = chunkEnvSchema.parse(env === undefined ? {} : env);
  const defaults = Object.fromEntries(Object.entries(EXPORT_CHUNK_NATIVE_ENV).map(([name, value]) => [name, String(Math.min(Number(value), parsedGuest.cpus))]));
  for (const name of Object.keys(defaults)) {
    if (parsedEnv[name] === undefined) continue;
    const value = Number(parsedEnv[name]);
    if (!Number.isInteger(value) || value < 1 || value > parsedGuest.cpus) throw new Error(`${name} must be between 1 and ${parsedGuest.cpus} for this chunk machine.`);
  }
  return { chunkGuest: parsedGuest, chunkEnv: { ...defaults, ...parsedEnv } };
}
