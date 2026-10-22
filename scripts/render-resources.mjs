import { execFileSync } from 'node:child_process';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFfBinary } from '@hyperframes/parsers/ff-binaries';

const MIB = 1024 * 1024;
// Below this, keep the original one-worker, low-memory profile (the legacy
// 6 GiB container). The 2-vCPU/8 GiB profile reports slightly under 8 GiB.
const LOW_MEMORY_BYTES = 6.5 * 1024 * MIB;

function boundedInteger(name, fallback, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}.`);
  return value;
}

/** Size renderer parallelism from this host's CPUs and memory. Env values override. */
export function renderResources() {
  const limit = process.constrainedMemory?.() ?? 0;
  const memory = limit > 0 ? Math.min(limit, totalmem()) : totalmem();
  const lowMemory = memory < LOW_MEMORY_BYTES;
  const cpus = Math.max(1, availableParallelism());
  // Two capture workers use both vCPUs of the hosted profile; more would
  // contend with the encoder and need re-measuring against the memory budget.
  const workers = boundedInteger('REVLINE_RENDER_WORKERS', lowMemory ? 1 : Math.min(2, cpus), 4);
  return {
    workers,
    lowMemory,
    memoryMb: Math.floor(memory / MIB),
  };
}

/** Bound native decoder work while preserving HyperFrames' process ownership. */
export function configureRenderFfmpeg(directory) {
  // The deployed media worker and local Linux development use util-linux flock.
  if (process.platform !== 'linux') return;
  execFileSync('flock', ['--version'], { stdio: 'ignore', timeout: 5000 });
  const binary = findFfBinary('ffmpeg');
  if (!binary) throw new Error('FFmpeg is unavailable for video export.');
  process.env.REVLINE_RENDER_FFMPEG_BINARY = binary;
  process.env.REVLINE_RENDER_FFMPEG_LOCK = join(directory, '.render-ffmpeg.lock');
  process.env.HYPERFRAMES_FFMPEG_PATH = fileURLToPath(new URL('./render-ffmpeg.sh', import.meta.url));
}
