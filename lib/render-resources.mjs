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

// HyperFrames' libx264 presets (draft ultrafast/28, standard medium/18, high
// slow/15) after Revline's cheaper searches. configureRenderX264 maps the
// producer's arguments to these; the FFmpeg-only export encodes with them.
export const RENDER_X264 = Object.freeze({
  draft: Object.freeze({ producerPreset: 'ultrafast', preset: 'ultrafast', producerCrf: 28, crf: 28 }),
  standard: Object.freeze({ producerPreset: 'medium', preset: 'fast', producerCrf: 18, crf: 18 }),
  high: Object.freeze({ producerPreset: 'slow', preset: 'medium', producerCrf: 15, crf: 16 }),
});

/** Map the producer's x264 arguments for one RENDER_X264 entry to Revline's cheaper searches. */
export function configureRenderX264(x264) {
  if (x264.preset !== x264.producerPreset) process.env.REVLINE_RENDER_X264_PRESET = `${x264.producerPreset}=${x264.preset}`;
  if (x264.crf !== x264.producerCrf) process.env.REVLINE_RENDER_X264_CRF = `${x264.producerCrf}=${x264.crf}`;
}

/** Size renderer parallelism from this host's CPUs and memory. Env values override. */
export function renderResources() {
  const limit = process.constrainedMemory?.() ?? 0;
  const memory = limit > 0 ? Math.min(limit, totalmem()) : totalmem();
  const lowMemory = memory < LOW_MEMORY_BYTES;
  const cpus = Math.max(1, availableParallelism());
  const hostedCpus = process.env.RAILWAY_SERVICE_ID
    ? Math.min(cpus, boundedInteger('MEDIA_PROCESSOR_THREADS', Math.min(64, cpus), 64))
    : null;
  // Two capture workers use both vCPUs of the hosted profile; more would
  // contend with the encoder and need re-measuring against the memory budget.
  // Hosted overrides must fit this worker, including settings inherited from an old image.
  const workers = boundedInteger('REVLINE_RENDER_WORKERS', lowMemory ? 1 : Math.min(2, cpus), hostedCpus ?? 16);
  return {
    workers,
    lowMemory,
    ffmpegSlots: boundedInteger('REVLINE_RENDER_FFMPEG_SLOTS', lowMemory ? 1 : Math.min(2, cpus), hostedCpus ?? 8),
    encodeThreads: boundedInteger('REVLINE_RENDER_ENCODE_THREADS', Math.min(4, cpus), hostedCpus ?? 16),
    memoryMb: Math.floor(memory / MIB),
  };
}

/**
 * Sizing for an export whose frames are drawn on a GPU (scripts/render-gpu.mjs): the CPU
 * no longer rasterizes, so more capture workers fit. Measured on a 16-thread, 15 GB PC with a
 * 25 s 1080x1920 60 fps mirror-blur montage: 2 workers 189 s, 6 workers 132 s, 8 no faster
 * (CPU-bound, x264 included). x264 keeps its preset and CRF; only its thread count grows.
 * Env values still override; small hosts keep their profile.
 */
export function gpuRenderResources(resources = renderResources()) {
  // Hosted processors have no GPU and their own thread bound (MEDIA_PROCESSOR_THREADS).
  if (resources.lowMemory || process.env.RAILWAY_SERVICE_ID) return resources;
  const cpus = Math.max(1, availableParallelism());
  // Each capture browser holds roughly a gigabyte; leave room for the encoder and the host.
  const byMemory = Math.max(1, Math.floor((resources.memoryMb - 4096) / 1200));
  return {
    ...resources,
    workers: boundedInteger('REVLINE_RENDER_WORKERS', Math.max(resources.workers, Math.min(6, Math.floor(cpus / 2), byMemory)), 16),
    ffmpegSlots: boundedInteger('REVLINE_RENDER_FFMPEG_SLOTS', Math.max(resources.ffmpegSlots, Math.min(4, Math.floor(cpus / 4))), 8),
    encodeThreads: boundedInteger('REVLINE_RENDER_ENCODE_THREADS', Math.max(resources.encodeThreads, Math.min(8, cpus)), 16),
  };
}

/** Bound native decoder work while preserving HyperFrames' process ownership. */
export function configureRenderFfmpeg(directory, resources = renderResources()) {
  // The deployed media worker and local Linux development use util-linux flock.
  if (process.platform !== 'linux') return;
  execFileSync('flock', ['--version'], { stdio: 'ignore', timeout: 5000 });
  const binary = findFfBinary('ffmpeg');
  if (!binary) throw new Error('FFmpeg is unavailable for video export.');
  process.env.REVLINE_RENDER_FFMPEG_BINARY = binary;
  process.env.REVLINE_RENDER_FFMPEG_LOCK = join(directory, '.render-ffmpeg.lock');
  process.env.REVLINE_RENDER_FFMPEG_SLOTS = String(resources.ffmpegSlots);
  process.env.REVLINE_RENDER_ENCODE_THREADS = String(resources.encodeThreads);
  process.env.HYPERFRAMES_FFMPEG_PATH = fileURLToPath(new URL('../scripts/render-ffmpeg.sh', import.meta.url));
}
