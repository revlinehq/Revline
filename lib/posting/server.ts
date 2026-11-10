import type { PlatformAdapter, PlatformCredentials, PostingPlatform } from './adapter';
import { adapters } from './platforms';

// Server-only: reads the deployment's environment. Imported by convex/posting*, never by the browser.
export const TOKEN_KEY_ENV = 'POSTING_TOKEN_KEY';

/** The secret that encrypts account tokens and signs OAuth state. */
export function tokenSecret() {
  const secret = process.env[TOKEN_KEY_ENV];
  if (!secret || secret.length < 32) throw new Error('Posting is not configured on this server.');
  return secret;
}
/**
 * Where platforms send the user back after they approve the connection: a signed-in page of the app, so the
 * account is only stored for the same Revline user who started connecting it.
 */
export function callbackUrl() {
  return process.env.POSTING_CALLBACK_URL ?? `${process.env.APP_ORIGIN}/accounts/callback`;
}
/**
 * A platform is live when its adapter is registered and both of its credentials are set on the server
 * (and the token key exists, without which an account could not be stored). Otherwise it reads "Coming soon".
 */
export function livePlatform(platform: PostingPlatform): { adapter: PlatformAdapter; credentials: PlatformCredentials } | null {
  const adapter = adapters[platform];
  if (!adapter) return null;
  const clientId = process.env[adapter.envKeys.clientId], clientSecret = process.env[adapter.envKeys.clientSecret], key = process.env[TOKEN_KEY_ENV];
  if (!clientId || !clientSecret || !key || key.length < 32) return null;
  return { adapter, credentials: { clientId, clientSecret, redirectUri: callbackUrl() } };
}
