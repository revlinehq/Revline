export class AnalysisError extends Error {
  constructor(message: string, public status: number, public retryable?: boolean, public geminiBilling?: boolean) { super(message); }
}

/** Keep the reason useful without persisting signed URLs, commands or local paths. */
export function mediaErrorMessage(error: unknown) {
  const data = (error as { data?: unknown } | null)?.data;
  const message = (typeof data === 'string' ? data : error instanceof Error ? error.message : 'Media processing failed.')
    .replace(/\b(workerSecret|api[_-]?key|access[_-]?token|token|secret|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  if (/fetch failed|ECONNRESET|socket hang up|UND_ERR_|terminated/i.test(message)) return 'The media connection was interrupted. Retry this step if automatic recovery does not finish.';
  if (/^Command failed: (?:ffmpeg|ffprobe)\b/.test(message)) {
    const detail = message.split('\n').slice(1).join(' ').replace(/https?:\/\/[^\s<>"']+/g, '[media URL]').replace(/\/(?:home|tmp|app)\/[^\s:'"]+/g, '[worker path]').trim().slice(0, 600);
    return `Could not read source media${detail ? `: ${detail}` : '. The media connection or decoder stopped; retry this step.'}`;
  }
  if (/spawn .* ENOENT/.test(message)) return 'A required media runtime is missing on this worker. Restart the worker after installing its pinned dependencies.';
  return message.replace(/https?:\/\/[^\s<>"']+/g, '[media URL]').replace(/\/(?:home|tmp|app)\/[^\s:'"]+/g, '[worker path]').slice(0, 1000);
}

/** Match actual disk exhaustion, including FFmpeg stderr, without classifying network errors as permanent. */
export function isMediaDiskFull(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && /\b(?:ENOSPC|SQLITE_FULL)\b|No space left on device|database or disk is full|needs more free disk space/i.test(value)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if ('code' in value && (value.code === 'ENOSPC' || value.code === 'SQLITE_FULL')) return true;
    for (const key of ['message', 'stderr', 'cause', 'data']) {
      if (key in value) pending.push(Reflect.get(value, key));
    }
    if ('errors' in value && Array.isArray(value.errors)) pending.push(...value.errors);
  }
  return false;
}

/** Explicit provider policy wins over status defaults, including throttling. */
export function isRetryableAnalysisError(error: unknown) {
  if (isMediaDiskFull(error)) return false;
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
