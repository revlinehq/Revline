import { isMediaDiskFull } from './errors';

/** Retry transport failures, including a response body interrupted after headers. */
export function isTransientMediaError(error: unknown): boolean {
  if (isMediaDiskFull(error)) return false;
  const detail = error as { status?: number; code?: string; message?: string; stderr?: string; cause?: unknown } | null;
  if (typeof detail?.status === 'number') return detail.status === 408 || detail.status === 429 || detail.status >= 500;
  if (error instanceof Error && error.name === 'TimeoutError') return true;
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)/.test(detail?.code ?? '')) return true;
  return /fetch failed|terminated|socket hang up|connection reset|connection (?:timed out|refused)|network error|premature (?:close|end)|download was incomplete|HTTP (?:error )?(?:408|429|5\d\d)|Server returned 5\d\d|input\/output error|TLS.*(?:error|terminated)/i.test(`${detail?.message ?? ''} ${detail?.stderr ?? ''}`)
    || !!detail?.cause && isTransientMediaError(detail.cause);
}

export async function retryMediaOperation<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await work(); }
    catch (error) {
      signal?.throwIfAborted();
      if (attempt >= 3 || !isTransientMediaError(error)) throw error;
      const delay = 500 * 2 ** attempt + Math.random() * 250;
      const detail = error as { status?: number; code?: string; cause?: { code?: string } };
      const code = detail.code ?? detail.cause?.code;
      console.warn('[media-network] Transient media request interrupted; retrying.', { attempt: attempt + 2, delayMs: Math.round(delay), ...(typeof detail.status === 'number' ? { status: detail.status } : {}), ...(code && /^[A-Z0-9_]+$/.test(code) ? { code } : {}) });
      await new Promise<void>((resolve, reject) => {
        const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, delay);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}
