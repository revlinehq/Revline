export class AnalysisError extends Error {
  constructor(message: string, public status: number, public retryable?: boolean) { super(message); }
}

/** Explicit provider policy wins over status defaults, including throttling. */
export function isRetryableAnalysisError(error: unknown) {
  return !(error instanceof AnalysisError) || (error.retryable ?? error.status >= 500);
}

/** Convex task leases last this long from each claim or heartbeat. */
export const MEDIA_TASK_LEASE_MS = 60_000;
/** Includes the initial attempt; imports resume saved downloads within this budget. */
export const MAX_MEDIA_TASK_ATTEMPTS = 3;
/** Convex rejects a renewal once the attempt's lease expired or was replaced. */
export const MEDIA_LEASE_LOST = 'Media task lease is no longer active';
export function isMediaLeaseLost(error: unknown) {
  const data = (error as { data?: unknown } | null)?.data;
  return [error instanceof Error ? error.message : String(error), typeof data === 'string' ? data : ''].some(text => text.includes(MEDIA_LEASE_LOST));
}
