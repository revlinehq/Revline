import { availableParallelism } from 'node:os';

/** Hosted processors own the whole machine; local workers retain their two-thread budget. */
export function processingThreads() {
  const configured = Number(process.env.MEDIA_PROCESSOR_THREADS ?? 2);
  if (!Number.isInteger(configured) || configured < 1 || configured > 64) throw new Error('MEDIA_PROCESSOR_THREADS must be between 1 and 64.');
  return Math.min(configured, availableParallelism());
}
