import { PostingError, type AccountTokens, type PlatformCredentials } from '../../adapter';
import { errorFromResponse } from './errors';
import { exchange } from './http';

// OAuth 2.0 for web server apps.
// https://developers.google.com/identity/protocols/oauth2/web-server
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// The narrowest pair that covers the adapter: youtube.upload starts uploads, youtube.readonly reads the
// connected channel (channels.list mine=true) and the uploaded video's status and statistics, including
// while it is private. https://developers.google.com/youtube/v3/guides/authentication
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export function authUrl(credentials: PlatformCredentials, state: string): string {
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: credentials.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    // offline + consent: Google returns a refresh token on every connect, not only the first one.
    access_type: 'offline',
    // select_account: someone with several Google accounts or Brand Account channels picks the one to
    // connect; the token is then tied to that single channel.
    prompt: 'consent select_account',
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  return exchange(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }, 'Google', async (response) => {
    if (!response.ok) throw await errorFromResponse(response);
    return (await response.json()) as TokenResponse;
  });
}

function toTokens(body: TokenResponse, previous?: AccountTokens): AccountTokens {
  if (!body.access_token) throw new PostingError('Google did not return access to YouTube. Try connecting again.', false, 'noAccessToken');
  return {
    accessToken: body.access_token,
    // A refresh response carries no refresh token: keep the one we have.
    refreshToken: body.refresh_token ?? previous?.refreshToken,
    // Milliseconds since the epoch.
    expiresAt: typeof body.expires_in === 'number' ? Date.now() + body.expires_in * 1000 : undefined,
    scopes: body.scope ? body.scope.split(' ').filter(Boolean) : previous?.scopes ?? [],
  };
}

export async function exchangeCode(credentials: PlatformCredentials, code: string): Promise<AccountTokens> {
  const tokens = toTokens(await tokenRequest({
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: credentials.redirectUri,
    grant_type: 'authorization_code',
  }));
  // Google lets people untick individual permissions on the consent screen, so the granted scopes can be
  // fewer than requested. Both are needed: refuse the connection rather than fail later at upload time.
  const missing = SCOPES.filter((scope) => !tokens.scopes.includes(scope));
  if (missing.length > 0) {
    throw new PostingError('Revline needs both YouTube permissions to post and show stats. Connect again and leave both ticked.', false, 'missingScopes');
  }
  if (!tokens.refreshToken) {
    throw new PostingError('Google did not grant long-term access to YouTube. Try connecting again.', false, 'noRefreshToken');
  }
  return tokens;
}

export async function refresh(credentials: PlatformCredentials, tokens: AccountTokens): Promise<AccountTokens> {
  if (!tokens.refreshToken) {
    throw new PostingError('YouTube access has expired. Reconnect the YouTube channel in Revline and try again.', false, 'noRefreshToken');
  }
  return toTokens(await tokenRequest({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  }), tokens);
}

/**
 * Revokes Revline's access when a user disconnects, which the YouTube API Services Developer Policies require
 * (III.D.2). Revoking the refresh token ends the whole grant, access token included.
 * https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
 */
export async function revoke(tokens: AccountTokens): Promise<void> {
  await exchange(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken }).toString(),
  }, 'Google', async (response) => {
    // 400 means the token was already invalid, which is the state we wanted.
    if (!response.ok && response.status !== 400) throw await errorFromResponse(response);
  });
}
