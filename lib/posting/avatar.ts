// Downloading a connected account's picture so Revline can keep its own copy: platform picture URLs expire.
/** A picture larger than this is not saved; the account shows its initials instead. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const AVATAR_TIMEOUT_MS = 10_000;

/**
 * The picture at `url`, or null when there is none worth saving: no URL, not https, not a jpeg/png/webp/gif,
 * over 2 MB, or unreachable. Never throws, so a missing picture cannot fail connecting an account.
 */
export async function downloadAvatar(url: string | undefined): Promise<Blob | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), AVATAR_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: abort.signal });
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!response.ok || !response.body || !AVATAR_TYPES.has(type) || Number(response.headers.get('content-length') ?? 0) > AVATAR_MAX_BYTES) { abort.abort(); return null; }
    // The length header can be missing or wrong, so the bytes are counted as they arrive.
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > AVATAR_MAX_BYTES) { abort.abort(); return null; }
      chunks.push(value);
    }
    return size ? new Blob(chunks, { type }) : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
