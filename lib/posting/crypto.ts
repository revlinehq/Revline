import type { AccountTokens } from './adapter';

// Account tokens are stored AES-256-GCM encrypted, and OAuth `state` values are HMAC-signed, with keys derived
// from one server secret (POSTING_TOKEN_KEY). Web Crypto only, so Convex queries, mutations and actions can run it.
const text = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
function unhex(value: string) {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error('Stored value is malformed');
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
/** A separate key per purpose, so a token ciphertext can never stand in for a state signature. */
async function derive(secret: string, purpose: string) {
  return crypto.subtle.digest('SHA-256', text.encode(`revline-posting:${purpose}:${secret}`));
}

export async function encryptTokens(secret: string, tokens: AccountTokens) {
  const key = await crypto.subtle.importKey('raw', await derive(secret, 'tokens'), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, text.encode(JSON.stringify(tokens)));
  return `v1.${hex(iv)}.${hex(new Uint8Array(sealed))}`;
}
export async function decryptTokens(secret: string, value: string): Promise<AccountTokens> {
  const [version, iv, sealed] = value.split('.');
  if (version !== 'v1' || !iv || !sealed) throw new Error('Stored account tokens are malformed');
  const key = await crypto.subtle.importKey('raw', await derive(secret, 'tokens'), 'AES-GCM', false, ['decrypt']);
  const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv) }, key, unhex(sealed));
  return JSON.parse(new TextDecoder().decode(opened)) as AccountTokens;
}

async function stateKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', await derive(secret, 'state'), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
/** `state` for the OAuth round trip: the stored single-use nonce plus its signature. */
export async function signState(secret: string, nonce: string) {
  const signature = await crypto.subtle.sign('HMAC', await stateKey(secret, 'sign'), text.encode(nonce));
  return `${nonce}.${hex(new Uint8Array(signature))}`;
}
/** The nonce of a `state` this server signed, or null. */
export async function verifyState(secret: string, state: string) {
  const [nonce, signature, extra] = state.split('.');
  if (!nonce || !signature || extra !== undefined || !/^(?:[0-9a-f]{2})+$/.test(signature)) return null;
  const valid = await crypto.subtle.verify('HMAC', await stateKey(secret, 'verify'), unhex(signature), text.encode(nonce));
  return valid ? nonce : null;
}
