export type MediaToken = {
  operation: 'read' | 'download' | 'part' | 'control' | 'prepareUpload' | 'cacheWrite';
  expires: number;
  key?: string;
  uploadId?: string;
  partNumber?: number;
  size?: number;
  fileName?: string;
  storageUrl?: string;
  upload?: { ownerId: string; projectId: string; fileName: string; contentType: string };
};
const encoder = new TextEncoder();
export function safeDownloadFileName(value: string) {
  const name = value.replace(/[\x00-\x1f\x7f/\\":;]/g, '').trim().slice(0, 180);
  // Encoding repairs a lone surrogate, including one split by the length bound.
  return new TextDecoder().decode(encoder.encode(name)) || 'Revline export.mp4';
}
export function attachmentDisposition(value: string) {
  const name = safeDownloadFileName(value);
  const fallback = name.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
function encode(bytes: Uint8Array) {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signMediaToken(secret: string, value: MediaToken) {
  const payload = encode(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyMediaToken(secret: string, token: string): Promise<MediaToken | null> {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || token.length > 4096) return null;
    if (!await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), encoder.encode(payload))) return null;
    const value: MediaToken = JSON.parse(new TextDecoder().decode(decode(payload)));
    return Number.isFinite(value.expires) && value.expires > Date.now() ? value : null;
  } catch { return null; }
}

/** What the media Worker vouches for when it stores one multipart part. */
export type StoredPartClaim = { key: string; uploadId: string; partNumber: number; size: number; etag: string };
const receiptText = (part: StoredPartClaim) => encoder.encode(['part-receipt', part.key, part.uploadId, part.partNumber, part.size, part.etag].join('\n'));
/** The Worker's proof that it stored this part. A resumed upload presents it, so the
 * server decides which parts already exist instead of trusting the browser's notes. */
export async function signPartReceipt(secret: string, part: StoredPartClaim) {
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), receiptText(part))));
}
export async function verifyPartReceipt(secret: string, part: StoredPartClaim, receipt: string) {
  try { return receipt.length <= 128 && await crypto.subtle.verify('HMAC', await signingKey(secret), decode(receipt), receiptText(part)); }
  catch { return false; }
}
