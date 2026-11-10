// HTTP plumbing for the Instagram API with Instagram Login: one request helper and the error mapping.
// Error shapes and codes come from:
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
// https://developers.facebook.com/docs/graph-api/guides/error-handling
// https://developers.facebook.com/docs/graph-api/overview/rate-limiting
import { PostingError } from '../../adapter';

/** The one place the Graph API version is pinned. v27.0 is the version Meta's docs use as of 2026-11. */
export const INSTAGRAM_API_VERSION = 'v27.0';
export const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const CODE_EXCHANGE_URL = 'https://api.instagram.com/oauth/access_token';
export const GRAPH_HOST = 'https://graph.instagram.com';
export const GRAPH_URL = `${GRAPH_HOST}/${INSTAGRAM_API_VERSION}`;

type Mapped = { message: string; retryable: boolean };

const RECONNECT = 'Instagram no longer accepts this connection. Reconnect the Instagram account.';

/** Publishing subcodes (`error_subcode`, and the `status` of a container whose status_code is ERROR). */
const SUBCODES: Record<number, Mapped> = {
  2207001: { message: 'Instagram had a server error. It will be tried again.', retryable: true },
  2207003: { message: 'Instagram took too long to download the video. It will be tried again.', retryable: true },
  2207006: { message: 'Instagram could not find the upload. The permission to post may be missing; reconnect the account.', retryable: false },
  2207008: { message: 'Instagram was not ready to publish yet. It will be tried again.', retryable: true },
  2207010: { message: 'The caption is too long for Instagram (2,200 characters at most).', retryable: false },
  2207020: { message: 'The upload expired before it was published. It will be uploaded again.', retryable: true },
  2207023: { message: 'Instagram did not recognise the kind of media sent.', retryable: false },
  2207026: { message: 'Instagram does not support this video format. Use an MP4 or MOV file with H.264 or HEVC video and AAC audio.', retryable: false },
  2207027: { message: 'Instagram is still processing the video. It will be checked again.', retryable: true },
  2207032: { message: 'Instagram could not create the post. It will be tried again.', retryable: true },
  2207040: { message: 'The caption mentions too many accounts (20 at most).', retryable: false },
  2207042: { message: 'This Instagram account reached its limit of posts for the last 24 hours. It will be tried again later.', retryable: true },
  2207050: { message: 'This Instagram account is restricted or inactive. Open the Instagram app to fix it.', retryable: false },
  2207051: { message: 'Instagram blocked this post as possible spam.', retryable: false },
  2207052: { message: 'Instagram could not download the video from its web address. It will be tried again.', retryable: true },
  2207053: { message: 'Instagram had an unknown upload error. It will be uploaded again.', retryable: true },
  2207057: { message: 'The cover frame position is outside the video.', retryable: false },
  // Authentication subcodes that come with code 190.
  458: { message: RECONNECT, retryable: false },
  459: { message: 'Instagram asks the account owner to log in and confirm their account before it can be used here.', retryable: false },
  460: { message: 'The Instagram password changed. Reconnect the Instagram account.', retryable: false },
  463: { message: 'The Instagram connection expired. Reconnect the Instagram account.', retryable: false },
  464: { message: 'Instagram asks the account owner to log in and confirm their account before it can be used here.', retryable: false },
  467: { message: RECONNECT, retryable: false },
};

const MISSING_PERMISSION: Mapped = {
  message: 'Instagram refused because a permission is missing. Reconnect the account and allow every permission asked for.',
  retryable: false,
};
const RATE_LIMITED: Mapped = { message: 'Instagram is limiting requests right now. It will be tried again later.', retryable: true };

const CODES: Record<number, Mapped> = {
  [-2]: { message: 'Instagram timed out handling the video. It will be tried again.', retryable: true },
  [-1]: { message: 'Instagram had a server error. It will be tried again.', retryable: true },
  1: { message: 'Instagram had an unknown error. It will be tried again.', retryable: true },
  2: { message: 'Instagram is temporarily unavailable. It will be tried again.', retryable: true },
  3: MISSING_PERMISSION,
  4: RATE_LIMITED,
  9: { message: 'This Instagram account reached its limit of posts for the last 24 hours. It will be tried again later.', retryable: true },
  10: MISSING_PERMISSION,
  17: RATE_LIMITED,
  24: { message: 'Instagram could not find the upload or post. It may have been deleted, or the permission was removed.', retryable: false },
  25: { message: 'This Instagram account is restricted or inactive. Open the Instagram app to fix it.', retryable: false },
  32: RATE_LIMITED,
  102: { message: RECONNECT, retryable: false },
  190: { message: 'The Instagram connection expired or was removed. Reconnect the Instagram account.', retryable: false },
  341: RATE_LIMITED,
  352: { message: 'Instagram does not support this video format. Use an MP4 or MOV file with H.264 or HEVC video and AAC audio.', retryable: false },
  368: { message: 'Instagram temporarily blocked this account from posting for breaking its rules.', retryable: false },
  506: { message: 'Instagram refused a duplicate of the previous post.', retryable: false },
  613: RATE_LIMITED,
  9004: { message: 'Instagram could not download the video from its web address. It will be tried again.', retryable: true },
  9007: { message: 'Instagram is still processing the video. It will be checked again.', retryable: true },
  36004: { message: 'The caption is too long for Instagram (2,200 characters at most).', retryable: false },
  80002: RATE_LIMITED,
};

type GraphErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  error_user_msg?: string;
};

/** Plain-words message and retry flag for a failed container, from the subcode in its `status` field. */
export function describeContainerError(status: string | undefined): Mapped & { code: string } {
  const subcode = Number(/\d{7}/.exec(status ?? '')?.[0]);
  const known = SUBCODES[subcode];
  if (known) return { ...known, code: String(subcode) };
  return {
    message: status ? `Instagram could not process the video (${status}).` : 'Instagram could not process the video.',
    retryable: false,
    code: Number.isFinite(subcode) ? String(subcode) : 'container_error',
  };
}

function toPostingError(httpStatus: number, body: unknown): PostingError {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  // The code-exchange endpoint answers `{ error_type, code, error_message }` instead of the Graph shape.
  if (typeof record.error_message === 'string') {
    if (httpStatus === 429 || httpStatus >= 500) {
      return new PostingError('Instagram sign-in is temporarily unavailable. Try connecting again shortly.', true, 'oauth_unavailable');
    }
    return new PostingError(
      `Instagram did not accept the sign-in (${record.error_message}). The link may have expired or been used already; connect again.`,
      false,
      'oauth_rejected',
    );
  }
  const error = (record.error && typeof record.error === 'object' ? record.error : {}) as GraphErrorBody;
  const label = error.error_subcode ?? error.code;
  const code = label === undefined ? `http_${httpStatus}` : String(label);
  const known =
    (error.error_subcode !== undefined ? SUBCODES[error.error_subcode] : undefined) ??
    (error.code !== undefined ? CODES[error.code] : undefined) ??
    (error.code !== undefined && error.code >= 200 && error.code <= 299 ? MISSING_PERMISSION : undefined);
  if (known) return new PostingError(known.message, known.retryable, code);
  if (error.type === 'OAuthException' && httpStatus === 401) return new PostingError(RECONNECT, false, code);
  const retryable = error.is_transient === true || httpStatus === 429 || httpStatus >= 500;
  const detail = error.error_user_msg || error.message;
  const message = retryable
    ? 'Instagram is temporarily unavailable. It will be tried again.'
    : detail
      ? `Instagram refused the request: ${detail}`
      : `Instagram refused the request (HTTP ${httpStatus}).`;
  return new PostingError(message, retryable, code);
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  /** Query parameters. For Graph calls the access token is sent here, as the docs show. */
  query?: Record<string, string>;
  /** Form-encoded body, for POST. */
  form?: Record<string, string>;
};

/** Longest wait for one answer, so a stalled connection becomes a retryable error instead of a dead action. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Calls an Instagram endpoint and returns its JSON, or throws a PostingError that never contains a token. */
export async function instagramRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(options.query ?? {})) target.searchParams.set(key, value);
  let response: Response;
  let body: unknown = null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(target, {
      method: options.method ?? 'GET',
      signal: abort.signal,
      ...(options.form
        ? {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(options.form).toString(),
          }
        : {}),
    });
    body = await response.json().catch(() => null);
  } catch {
    throw new PostingError('Could not reach Instagram. It will be tried again.', true, 'network');
  } finally {
    clearTimeout(timer);
  }
  const hasError = body !== null && typeof body === 'object' && ('error' in body || 'error_message' in body);
  if (!response.ok || hasError) throw toPostingError(response.status, body);
  if (body === null || typeof body !== 'object') {
    throw new PostingError('Instagram sent an answer that could not be read. It will be tried again.', true, 'bad_response');
  }
  return body as T;
}

/** Some Instagram Login endpoints wrap their answer in `{ data: [ ... ] }`; others return it flat. */
export function unwrap<T>(body: T | { data?: T[] }): T {
  const wrapped = (body as { data?: T[] }).data;
  return Array.isArray(wrapped) && wrapped.length > 0 ? wrapped[0] : (body as T);
}
