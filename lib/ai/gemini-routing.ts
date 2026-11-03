/** Shared by media workers and the editor, including the Cloudflare runner. */
export type GeminiRoute = 'direct' | 'convex-gateway';
export const GEMINI_GATEWAY_BODY_LIMIT = 16 * 1024 * 1024;
export const GEMINI_VIDEO_GATEWAY_LIMIT = 'Convex AI Gateway does not expose Gemini Files uploads or agentic video inspection. This tool needs the original video and audio; sampled frames would lose evidence. Restore direct Google billing, or use inspectFrames for a visual-only question.';

export function geminiFallbackFailure(status: number, detail: string) {
  if (status === 401 || status === 402) return true;
  if (status === 403) return /billing|quota|api.?key|auth|permission.denied|access.denied|consumer.*disabled/i.test(detail);
  if (status === 429) return /quota|billing|insufficient[_ -]?(?:credits?|funds)|credits?.*(?:exhaust|deplet)/i.test(detail);
  // Google sometimes reports invalid credentials as INVALID_ARGUMENT (400).
  return status === 400 && /API_KEY_(?:INVALID|EXPIRED)|API key (?:not valid|expired)/i.test(detail);
}

export function isGeminiFallbackFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { statusCode?: number; status?: number; responseBody?: string; message?: string; geminiFallback?: boolean };
  return failure.geminiFallback ?? geminiFallbackFailure(failure.statusCode ?? failure.status ?? 0, failure.responseBody ?? failure.message ?? '');
}

export async function withGeminiFallback<T>(key: string | undefined, direct: () => PromiseLike<T>, gateway: () => PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (key?.trim()) {
    try { return await direct(); }
    catch (error) {
      signal?.throwIfAborted();
      if (!isGeminiFallbackFailure(error)) throw error;
      console.warn('[gemini] Direct credentials, billing or quota unavailable; using Convex AI Gateway.');
    }
  }
  signal?.throwIfAborted();
  return await gateway();
}
