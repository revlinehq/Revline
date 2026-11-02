import { ConvexError } from 'convex/values';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/** A fresh native authorization code avoids retaining Apple refresh tokens. */
export async function revokeAppleAccount(code: string | undefined, externalIds: string[]) {
  if (!code || code.length > 4096) throw new ConvexError('Confirm your Apple account before deleting it.');
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const teamId = process.env.APPLE_SIGN_IN_TEAM_ID;
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID;
  const privateKey = process.env.APPLE_SIGN_IN_PRIVATE_KEY;
  if (!bundleId || !teamId || !keyId || !privateKey) {
    throw new ConvexError('Apple account deletion is temporarily unavailable. Please contact support.');
  }
  const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
  const secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId).setSubject(bundleId).setAudience('https://appleid.apple.com')
    .setIssuedAt().setExpirationTime('5m').sign(key);
  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: bundleId, client_secret: secret, code, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new ConvexError('Apple could not confirm this request. Confirm your Apple account again.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('id_token' in data) || typeof data.id_token !== 'string') {
    throw new ConvexError('Apple did not return a verified account.');
  }
  const { payload } = await jwtVerify(data.id_token, appleKeys, {
    algorithms: ['RS256'], issuer: 'https://appleid.apple.com', audience: bundleId,
  });
  if (!payload.sub || !externalIds.includes(payload.sub)) {
    throw new ConvexError('Confirm the Apple account linked to your Revline account.');
  }
  const refresh = 'refresh_token' in data && typeof data.refresh_token === 'string' ? data.refresh_token : undefined;
  const access = 'access_token' in data && typeof data.access_token === 'string' ? data.access_token : undefined;
  const token = refresh ?? access;
  if (!token) throw new ConvexError('Apple did not return a token to revoke.');
  const revoked = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: bundleId, client_secret: secret, token, token_type_hint: refresh ? 'refresh_token' : 'access_token' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!revoked.ok) throw new ConvexError('Apple access could not be revoked. Try again before deleting your account.');
}
