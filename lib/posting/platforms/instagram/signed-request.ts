// Meta's `signed_request`, the body of the Deauthorize and Data Deletion Request callbacks.
// Format, from the parser in https://developers.facebook.com/docs/apps/delete-data (read 2026-11-11):
//   <base64url(HMAC-SHA256(payload, app secret))>.<payload>      payload = base64url(JSON)
// The signature covers the encoded payload exactly as received. The JSON carries `algorithm` ("HMAC-SHA256"),
// `issued_at` (seconds) and `user_id`, the person who removed the app or asked for their data to be deleted.

export type SignedRequest = { ok: true; userId: string; issuedAt?: number } | { ok: false; reason: 'malformed' | 'signature' };

/** A signed request older than this is refused, so a captured one cannot be sent again later. */
const MAX_AGE_MS = 24 * 3600_000;

function base64UrlBytes(text: string) {
  if (!text || !/^[A-Za-z0-9_-]+={0,2}$/.test(text)) throw new Error('Not base64url');
  const plain = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(plain + '='.repeat((4 - plain.length % 4) % 4)), char => char.charCodeAt(0));
}

/**
 * Check a `signed_request` against the app secret(s) and read who it is about. Nothing in the payload is read before
 * its signature matches; the comparison is WebCrypto's HMAC verify, which takes the same time for any wrong signature.
 */
export async function readSignedRequest(signedRequest: string, secrets: string[], now = Date.now()): Promise<SignedRequest> {
  const dot = signedRequest.indexOf('.'), payload = signedRequest.slice(dot + 1);
  let signature: Uint8Array<ArrayBuffer>;
  try {
    if (dot < 1) throw new Error('No signature');
    signature = base64UrlBytes(signedRequest.slice(0, dot));
    base64UrlBytes(payload);
  } catch { return { ok: false, reason: 'malformed' }; }
  const signed = new TextEncoder().encode(payload);
  let verified = false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (await crypto.subtle.verify('HMAC', key, signature, signed)) verified = true;
  }
  if (!verified) return { ok: false, reason: 'signature' };
  let data: Record<string, unknown>, json: string;
  try {
    json = new TextDecoder().decode(base64UrlBytes(payload));
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not an object');
    data = parsed as Record<string, unknown>;
  } catch { return { ok: false, reason: 'malformed' }; }
  if (typeof data.algorithm !== 'string' || data.algorithm.toUpperCase() !== 'HMAC-SHA256') return { ok: false, reason: 'malformed' };
  // An id sent as a bare number is read from the text: Instagram's 17-digit ids do not survive JSON.parse as numbers.
  const userId = typeof data.user_id === 'string' ? data.user_id : typeof data.user_id === 'number' ? /"user_id"\s*:\s*(\d+)/.exec(json)?.[1] ?? '' : '';
  if (!userId) return { ok: false, reason: 'malformed' };
  const issued = typeof data.issued_at === 'string' ? Number(data.issued_at) : data.issued_at;
  const issuedAt = typeof issued === 'number' && Number.isFinite(issued) && issued > 0 ? issued * 1000 : undefined;
  if (issuedAt !== undefined && issuedAt < now - MAX_AGE_MS) return { ok: false, reason: 'malformed' };
  return { ok: true, userId, ...(issuedAt !== undefined ? { issuedAt } : {}) };
}
