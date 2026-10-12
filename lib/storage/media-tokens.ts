export type MediaToken = {
  operation: 'read' | 'part' | 'control';
  expires: number;
  key?: string;
  uploadId?: string;
  partNumber?: number;
  size?: number;
};
const encoder = new TextEncoder();
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
