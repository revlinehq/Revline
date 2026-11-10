import { PostingError, type AccountTokens } from '../../adapter';
import { errorFromResponse } from './errors';

export const API = 'https://www.googleapis.com/youtube/v3';

/** One request, headers and body together, may not take longer than this. */
export const REQUEST_TIMEOUT_MS = 90_000;

/**
 * fetch plus reading the response inside `handle`, under one timeout that aborts the connection, so a stalled
 * body cannot keep downloading in the background. A network failure, a timeout or an unreadable body becomes a
 * retryable PostingError; a PostingError thrown by `handle` passes through.
 */
export async function exchange<T>(url: string, init: RequestInit, what: string, handle: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await handle(await fetch(url, { ...init, signal: controller.signal }));
  } catch (error) {
    if (error instanceof PostingError) throw error;
    throw new PostingError(`Could not reach ${what}. Revline will try again.`, true, 'network');
  } finally {
    clearTimeout(timer);
    // Drops whatever is left of the response; a no-op once the body was read to the end.
    controller.abort();
  }
}

export function bearer(tokens: AccountTokens): Record<string, string> {
  return { Authorization: `Bearer ${tokens.accessToken}` };
}

export function getJson<T>(tokens: AccountTokens, path: string, params: Record<string, string>): Promise<T> {
  return exchange(`${API}/${path}?${new URLSearchParams(params)}`, { headers: bearer(tokens) }, 'YouTube', async (response) => {
    if (!response.ok) throw await errorFromResponse(response);
    return (await response.json()) as T;
  });
}

/** Reads a body of unknown length, giving up (null) once it passes `cap` bytes. */
export async function readCapped(response: Response, cap: number): Promise<ArrayBuffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) return null;
    parts.push(value);
  }
  const whole = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    whole.set(part, offset);
    offset += part.byteLength;
  }
  return whole.buffer;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
