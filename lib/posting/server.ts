import type { PlatformAdapter, PlatformCredentials, PostingPlatform } from './adapter';
import { adapters } from './platforms';
import { TIKTOK_VISIBILITIES, YOUTUBE_VISIBILITIES, type YouTubeVisibility } from './visibility';
import type { TikTokPrivacyLevel } from './platforms/tiktok/settings';

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

/**
 * Who posts for Revline: Post Bridge (`postbridge`), or Revline's own platform apps (`native`). One server setting,
 * POSTING_PROVIDER, read on every call, so it is switched without a deploy. An account belongs to the provider it was
 * connected through; under the other one it reads as needing a reconnect.
 */
export type PostingProvider = 'postbridge' | 'native';
export const postingProvider = (): PostingProvider => process.env.POSTING_PROVIDER === 'postbridge' ? 'postbridge' : 'native';
/** Revline's Post Bridge API key. Server only: never returned by a function or logged. */
export const postBridgeKey = () => process.env.POSTBRIDGE_API_KEY || null;
export const accountProvider = (account: { provider?: 'postbridge' }): PostingProvider => account.provider ?? 'native';
/** Whether accounts of this platform can be connected and posted to right now. */
export const platformLive = (platform: PostingPlatform) => postingProvider() === 'postbridge' ? !!postBridgeKey() : !!livePlatform(platform);
/** Where Post Bridge sends the user back after the platform's consent screen: Connected accounts, which then reads the new account. */
export const accountsUrl = () => `${process.env.APP_ORIGIN}/accounts`;

/**
 * Who can view a post, as far as the provider in use lets Revline set it. Post Bridge has no YouTube privacy (videos
 * go out public) and takes TikTok as public or private only.
 */
export function visibilityOptions(): { youtube: readonly YouTubeVisibility[]; tiktok: readonly TikTokPrivacyLevel[] } {
  return postingProvider() === 'postbridge' ? { youtube: ['public'], tiktok: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] } : { youtube: YOUTUBE_VISIBILITIES, tiktok: TIKTOK_VISIBILITIES };
}
