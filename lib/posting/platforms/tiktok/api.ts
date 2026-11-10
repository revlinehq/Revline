// Transport for TikTok's v2 API: one place that sends requests and turns every documented error into a PostingError.
// Error tables: https://developers.tiktok.com/doc/tiktok-api-v2-error-handling,
// https://developers.tiktok.com/doc/oauth-error-handling and the "Error codes" section of each Content Posting page.
import { PostingError } from '../../adapter';

export const API_ORIGIN = 'https://open.tiktokapis.com';
const REQUEST_TIMEOUT_MS = 30_000;

type ErrorRule = { message: string; retryable: boolean };

/** Every error code TikTok documents for the endpoints this adapter calls, in plain words. */
const ERROR_RULES: Record<string, ErrorRule> = {
  // Shared API errors.
  access_token_invalid: { message: 'TikTok no longer accepts this connection\'s access token. Refresh the token and try again; if that fails, reconnect the TikTok account.', retryable: true },
  scope_not_authorized: { message: 'This TikTok account did not grant the permission this needs. Reconnect the account and approve every permission.', retryable: false },
  scope_permission_missed: { message: 'This TikTok connection is missing a permission for the requested data. Reconnect the account and approve every permission.', retryable: false },
  rate_limit_exceeded: { message: 'TikTok is rate-limiting requests for this account. Try again in a minute.', retryable: true },
  internal_error: { message: 'TikTok had an internal error. Try again later.', retryable: true },
  invalid_params: { message: 'TikTok rejected the request as invalid.', retryable: false },
  invalid_param: { message: 'TikTok rejected the post settings or video details as invalid.', retryable: false },
  invalid_file_upload: { message: 'TikTok rejected the video file: it does not meet TikTok\'s format requirements.', retryable: false },
  // Content Posting API.
  spam_risk_too_many_posts: { message: 'This TikTok account reached its daily limit for posts made through apps (about 15 in 24 hours, shared by every app). Post again tomorrow.', retryable: false },
  spam_risk_user_banned_from_posting: { message: 'TikTok has blocked this account from posting.', retryable: false },
  spam_risk_text: { message: 'TikTok flagged the caption as spam. Change the caption and post again.', retryable: false },
  spam_risk: { message: 'TikTok flagged this post as spam and did not publish it.', retryable: false },
  reached_active_user_cap: { message: 'Revline reached TikTok\'s limit on how many accounts can post through it in 24 hours. Try again tomorrow.', retryable: false },
  unaudited_client_can_only_post_to_private_accounts: { message: 'Until TikTok has audited Revline, it can only post to TikTok accounts that are set to private. Set the account to private in TikTok, or wait for the audit.', retryable: false },
  url_ownership_unverified: { message: 'TikTok could not confirm that Revline owns the address the video is served from. The media domain must be verified in the TikTok developer portal.', retryable: false },
  privacy_level_option_mismatch: { message: 'The chosen "who can view" setting is not available for this TikTok account. Choose another one.', retryable: false },
  invalid_publish_id: { message: 'TikTok does not recognise this post job.', retryable: false },
  token_not_authorized_for_specified_publish_id: { message: 'This post job belongs to a different TikTok connection.', retryable: false },
  // OAuth (the `error` field of /v2/oauth/token/).
  access_denied: { message: 'TikTok access was denied. Connect the account again and approve the request.', retryable: false },
  invalid_client: { message: 'TikTok rejected Revline\'s app credentials. Check TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.', retryable: false },
  invalid_grant: { message: 'The TikTok sign-in expired, was already used, or was revoked, or the redirect address does not match the registered one. Connect the account again.', retryable: false },
  invalid_request: { message: 'TikTok rejected the sign-in request. Check that the redirect address matches the one registered for the app.', retryable: false },
  invalid_scope: { message: 'TikTok rejected the requested permissions. Check that every scope is added to the app in the TikTok developer portal.', retryable: false },
  unauthorized_client: { message: 'The TikTok app is not allowed to sign accounts in this way. Check the app\'s Login Kit setup.', retryable: false },
  unsupported_grant_type: { message: 'TikTok rejected the sign-in request type.', retryable: false },
  unsupported_response_type: { message: 'TikTok rejected the sign-in request type.', retryable: false },
  server_error: { message: 'TikTok had an internal error during sign-in. Try again later.', retryable: true },
  temporarily_unavailable: { message: 'TikTok sign-in is temporarily unavailable. Try again later.', retryable: true },
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Builds the PostingError for a failed call. `what` finishes the sentence "TikTok could not …". */
export function tiktokError(what: string, status: number, code: string, detail: string, logId: string): PostingError {
  const rule = ERROR_RULES[code];
  if (rule) return new PostingError(rule.message, rule.retryable, code);
  const suffix = `${detail ? `: ${detail}` : ''}${logId ? ` (TikTok log ${logId})` : ''}`;
  if (status === 429) return new PostingError(ERROR_RULES.rate_limit_exceeded.message, true, code || 'rate_limit_exceeded');
  if (status >= 500) return new PostingError(`TikTok had a server error and could not ${what}. Try again later.`, true, code || `http_${status}`);
  if (status === 401) return new PostingError(ERROR_RULES.access_token_invalid.message, true, code || 'access_token_invalid');
  return new PostingError(`TikTok could not ${what}${suffix || ` (HTTP ${status})`}.`, false, code || `http_${status}`);
}

export type Sent = { status: number; ok: boolean; raw: string; json: Json };
export type SendOptions = {
  timeoutMs?: number;
  /**
   * For a request that starts a post: a retry could publish the video twice, so a timeout or dropped connection is
   * reported as not retryable instead.
   */
  startsPost?: boolean;
};

/** fetch with one timeout that covers the headers and the body. A network failure or timeout is retryable unless the request starts a post. */
export async function send(url: string, init: RequestInit, what: string, options: SendOptions = {}): Promise<Sent> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let json: Json = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isObject(parsed)) json = parsed;
    } catch { /* not JSON: callers fall back to the HTTP status */ }
    return { status: response.status, ok: response.ok, raw, json };
  } catch {
    if (options.startsPost) throw new PostingError('TikTok did not confirm whether the post started. Check the TikTok account before posting again.', false, 'publish_unconfirmed');
    throw new PostingError(`Could not reach TikTok to ${what}. Try again.`, true, 'network_error');
  } finally {
    clearTimeout(timer);
  }
}

export type ApiResult = { data: Json; raw: string };

/**
 * Calls a resource endpoint with the account's access token. TikTok answers `{ data, error: { code, message, log_id } }`
 * and reports some failures with HTTP 200, so success is "2xx and error.code is ok (or absent)".
 * `raw` is the untouched response text, for values JSON.parse cannot hold (64-bit post ids).
 */
export async function callApi(accessToken: string, method: 'GET' | 'POST', path: string, what: string, options: { query?: Record<string, string>; body?: Json; startsPost?: boolean } = {}): Promise<ApiResult> {
  const url = new URL(path, API_ORIGIN);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await send(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(method === 'POST' ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
  }, what, { startsPost: options.startsPost });
  const { raw, json } = response;
  // The error object is nested under `error` on endpoint pages and flat in the error-handling page's example; read both.
  const error = isObject(json.error) ? json.error : json;
  const code = text(error.code);
  if (!response.ok || (code && code !== 'ok')) throw tiktokError(what, response.status, code === 'ok' ? '' : code, text(error.message), text(error.log_id) || text(error.logid));
  return { data: isObject(json.data) ? json.data : {}, raw };
}

/** Calls /v2/oauth/token/ (form-encoded). Its errors are `{ error, error_description, log_id }`, sometimes with HTTP 200. */
export async function callToken(form: Record<string, string>, what: string): Promise<Json> {
  const response = await send(`${API_ORIGIN}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams(form).toString(),
  }, what);
  const { json } = response;
  const code = text(json.error);
  if (!response.ok || code || !text(json.access_token)) throw tiktokError(what, response.status, code, text(json.error_description), text(json.log_id));
  return json;
}
