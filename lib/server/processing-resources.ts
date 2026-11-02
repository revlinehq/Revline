import { availableParallelism } from 'node:os';

/** Hosted processors own the whole machine; local workers retain their two-thread budget. */
export function processingThreads() {
  const configured = Number(process.env.MEDIA_PROCESSOR_THREADS ?? 2);
  if (!Number.isInteger(configured) || configured < 1 || configured > 64) throw new Error('MEDIA_PROCESSOR_THREADS must be between 1 and 64.');
  return Math.min(configured, availableParallelism());
}

/** Divide the host budget between simultaneous preview chunks, including short sources. */
export function previewResources(chunks: number) {
  const configured = Number(process.env.MEDIA_PREVIEW_CPUS ?? processingThreads());
  if (!Number.isInteger(configured) || configured < 1 || configured > 64) throw new Error('MEDIA_PREVIEW_CPUS must be between 1 and 64.');
  const cpus = Math.min(configured, availableParallelism());
  const parallel = Math.max(1, Math.min(2, cpus, chunks));
  return { parallel, threads: Math.max(1, Math.floor(cpus / parallel)) };
}
