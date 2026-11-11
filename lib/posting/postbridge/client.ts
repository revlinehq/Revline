// Post Bridge's REST API (https://api.post-bridge.com/reference), as far as posting needs it. Plain fetch, so Convex
// actions can run it. The API key is Revline's own (POSTBRIDGE_API_KEY on the server): every user's social accounts
// live in that one Post Bridge workspace, so nothing here decides whose account an id is. Callers pass ids they read
// from the owner's own rows (convex/postingBridge.ts) and check `externalRef` on what comes back.
import { PostingError } from '../adapter';

const API = 'https://api.post-bridge.com/v1';
const TIMEOUT_MS = 30_000;
/** Post Bridge allows 10 requests a second per key and asks for 429s to be retried with backoff. */
const RATE_LIMIT_WAITS_MS = [1_000, 3_000];
const PAGE = 100, MAX_PAGES = 20;
const SERVICE = 'The posting service';

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The reason Post Bridge gave for refusing a request: `error` is a string or a list of strings, `message` likewise. */
function reason(body: unknown): string {
  const { error, message } = record(body);
  for (const value of [error, message]) {
    if (typeof value === 'string' && value) return value;
    const lines = list(value).filter((line): line is string => typeof line === 'string');
    if (lines.length) return lines.join(' ');
  }
  return '';
}

type Call = { query?: [string, string][]; body?: Json; timeoutMs?: number };
/**
 * One API call. Throws PostingError: retryable for a request that did not get through (network, timeout, 429, 5xx),
 * not retryable for one Post Bridge refused. `status` is on the error's code as `http_<status>`.
 */
async function call(apiKey: string, method: 'GET' | 'POST' | 'DELETE', path: string, { query = [], body, timeoutMs = TIMEOUT_MS }: Call = {}): Promise<unknown> {
  const url = new URL(`${API}${path}`);
  for (const [name, value] of query) url.searchParams.append(name, value);
  for (let attempt = 0; ; attempt++) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeoutMs);
    let response: Response, parsed: unknown = null;
    try {
      response = await fetch(url, { method, signal: abort.signal, headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      parsed = await response.json().catch(() => null);
    } catch {
      throw new PostingError(`${SERVICE} did not answer. Revline will try again.`, true, 'network');
    } finally { clearTimeout(timer); }
    if (response.ok) return parsed;
    if (response.status === 429 && attempt < RATE_LIMIT_WAITS_MS.length) { await wait(RATE_LIMIT_WAITS_MS[attempt]); continue; }
    const code = `http_${response.status}`;
    if (response.status === 429 || response.status >= 500) throw new PostingError(`${SERVICE} is busy right now. Revline will try again.`, true, code);
    // A wrong or revoked key is Revline's to fix, not the user's.
    if (response.status === 401 || response.status === 403) throw new PostingError('Posting is not available right now. Please try again later.', true, code);
    throw new PostingError(reason(parsed) || `${SERVICE} refused this request.`, false, code);
  }
}
const status = (error: unknown) => error instanceof PostingError && error.code?.startsWith('http_') ? Number(error.code.slice(5)) : 0;

// ---------------------------------------------------------------- social accounts

export type BridgeAccount = {
  id: number; platform: string; username: string; pictureUrl?: string; needsReconnect: boolean;
  /** The reference of the connect link that connected it: which Revline user it belongs to. Null for an account connected in Post Bridge's own dashboard. */
  externalRef: string | null;
  /** When it was last connected or reconnected through a connect link. */
  linkedAt?: number;
};
function account(value: unknown): BridgeAccount | null {
  const row = record(value), linked = text(row.connected_via_link_at);
  if (typeof row.id !== 'number' || typeof row.platform !== 'string' || typeof row.username !== 'string') return null;
  const linkedAt = linked ? Date.parse(linked) : NaN;
  return {
    id: row.id, platform: row.platform, username: row.username.replace(/^@/, ''), needsReconnect: row.needs_reconnect === true, externalRef: text(row.external_ref) ?? null,
    ...(text(row.profile_picture_url) ? { pictureUrl: text(row.profile_picture_url) } : {}), ...(Number.isFinite(linkedAt) ? { linkedAt } : {}),
  };
}

/** The account cap of Revline's Post Bridge plan is reached: no link can be made until it is raised there. */
export const PLAN_FULL = 'plan_full';
/** A link that connects one account of `platform` and tags it with `externalRef`. The person approves on the platform's own consent screen and lands on `returnUrl`. */
export async function createConnectLink(apiKey: string, input: { platform: string; returnUrl: string; externalRef: string; expiresInSeconds: number }): Promise<string> {
  let body: unknown;
  try { body = await call(apiKey, 'POST', '/social-accounts/connect-link', { body: { platform: input.platform, return_url: input.returnUrl, external_ref: input.externalRef, expires_in: input.expiresInSeconds } }); }
  catch (error) {
    if (status(error) === 402) throw new PostingError('Revline cannot connect more accounts right now. Please try again later.', false, PLAN_FULL);
    throw error;
  }
  const url = text(record(body).url);
  if (!url || !/^https:\/\//.test(url)) throw new PostingError(`${SERVICE} returned no connect link. Please try again.`, true, 'no_link');
  return url;
}

/** Every account tagged with `externalRef`. `complete` is false when the listing stopped early, so nothing may be concluded from an account's absence. */
export async function listAccounts(apiKey: string, externalRef: string): Promise<{ accounts: BridgeAccount[]; complete: boolean }> {
  const accounts: BridgeAccount[] = [];
  // The offset moves by what actually came back, so a page size Post Bridge lowers on its side skips nothing.
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const body = record(await call(apiKey, 'GET', '/social-accounts', { query: [['external_ref', externalRef], ['limit', String(PAGE)], ['offset', String(offset)]] }));
    const rows = list(body.data);
    for (const row of rows) { const parsed = account(row); if (parsed) accounts.push(parsed); }
    offset += rows.length;
    if (!rows.length || record(body.meta).next == null) return { accounts, complete: true };
  }
  return { accounts, complete: false };
}
/** One account, or null when Post Bridge no longer has it. */
export async function getAccount(apiKey: string, id: number): Promise<BridgeAccount | null> {
  try { return account(await call(apiKey, 'GET', `/social-accounts/${id}`)); }
  catch (error) { if (status(error) === 404) return null; throw error; }
}
/** Disconnect an account at Post Bridge, which frees its slot on the plan. An account that is already gone counts as done. */
export async function deleteAccount(apiKey: string, id: number): Promise<void> {
  try { await call(apiKey, 'DELETE', `/social-accounts/${id}`); }
  catch (error) { if (status(error) !== 404) throw error; }
}

// ---------------------------------------------------------------- media and posts

/** A media record and the signed address its file is PUT to. Post Bridge deletes the file once the post using it has published, or after a day unused. */
export async function createUpload(apiKey: string, input: { name: string; mimeType: 'video/mp4'; bytes: number }): Promise<{ mediaId: string; uploadUrl: string }> {
  const body = record(await call(apiKey, 'POST', '/media/create-upload-url', { body: { name: input.name, mime_type: input.mimeType, size_bytes: input.bytes } }));
  const mediaId = text(body.media_id), uploadUrl = text(body.upload_url);
  if (!mediaId || !uploadUrl || !/^https:\/\//.test(uploadUrl)) throw new PostingError(`${SERVICE} returned no upload address. Revline will try again.`, true, 'no_upload');
  return { mediaId, uploadUrl };
}

export type BridgePostInput = {
  caption: string; socialAccountId: number;
  /** The uploaded file, or a link Post Bridge downloads the file from. */
  media: { mediaId: string } | { url: string };
  /** `platform_configurations`, keyed by platform. */
  configurations: Json;
};
/**
 * Create a post that publishes at once (no `scheduled_at`: Revline's own scheduler decides when this is called).
 * A request that may have reached Post Bridge is never retryable: sending it again could post twice.
 */
export async function createPost(apiKey: string, input: BridgePostInput): Promise<string> {
  let body: unknown;
  try {
    body = await call(apiKey, 'POST', '/posts', { timeoutMs: 60_000, body: {
      caption: input.caption, social_accounts: [input.socialAccountId], platform_configurations: input.configurations,
      ...('mediaId' in input.media ? { media: [input.media.mediaId] } : { media_urls: [input.media.url] }),
    } });
  } catch (error) {
    // A 429 was refused before anything was created, so it can be sent again.
    if (error instanceof PostingError && error.retryable && status(error) !== 429) throw new PostingError('Posting stopped before the posting service confirmed it. Check the account first, then retry if the video is not there.', false, error.code);
    throw error;
  }
  const id = text(record(body).id);
  if (!id) throw new PostingError('The posting service did not confirm this post. Check the account first, then retry if the video is not there.', false, 'no_post_id');
  return id;
}
/** A post's own state: `scheduled`, `processing`, `posted` or `failed`. Null when Post Bridge no longer has it. */
export async function getPostStatus(apiKey: string, postId: string): Promise<string | null> {
  try { return text(record(await call(apiKey, 'GET', `/posts/${encodeURIComponent(postId)}`)).status) ?? ''; }
  catch (error) { if (status(error) === 404) return null; throw error; }
}

export type BridgeResult = { id: string; socialAccountId: number; success: boolean; error: string; url?: string; platformPostId?: string };
/** What happened on each account a post went to. Empty until Post Bridge has an outcome. */
export async function postResults(apiKey: string, postId: string): Promise<BridgeResult[]> {
  // One post goes to one account, so the first page holds its whole outcome.
  const body = record(await call(apiKey, 'GET', '/post-results', { query: [['post_id', postId]] }));
  return list(body.data).flatMap(value => {
    const row = record(value), data = record(row.platform_data), failure = row.error;
    if (typeof row.id !== 'string' || row.post_id !== postId || typeof row.social_account_id !== 'number') return [];
    const error = typeof failure === 'string' ? failure : failure == null ? '' : reason(failure) || reason({ error: record(failure).message }) || JSON.stringify(failure).slice(0, 300);
    // TikTok's `id` is its publish id; the public video id arrives later as `platform_video_id`.
    const platformPostId = text(data.platform_video_id) ?? text(data.id);
    return [{ id: row.id, socialAccountId: row.social_account_id, success: row.success === true, error, ...(text(data.url) ? { url: text(data.url) } : {}), ...(platformPostId ? { platformPostId } : {}) }];
  });
}

// ---------------------------------------------------------------- analytics

export type BridgeStats = { resultId: string; views: number; likes: number; comments: number; shares: number; url?: string };
/** The latest numbers for these post results, in one request. A result Post Bridge has no numbers for yet is absent. Up to 50 ids per call. */
export async function analytics(apiKey: string, resultIds: string[]): Promise<BridgeStats[]> {
  const wanted = new Set(resultIds), stats: BridgeStats[] = [];
  for (let offset = 0; wanted.size && offset < resultIds.length;) {
    const body = record(await call(apiKey, 'GET', '/analytics', { query: [...resultIds.map(id => ['post_result_id', id] as [string, string]), ['limit', String(resultIds.length)], ['offset', String(offset)], ['timeframe', 'all']] }));
    const rows = list(body.data);
    for (const value of rows) {
      const row = record(value);
      if (typeof row.post_result_id !== 'string' || !wanted.has(row.post_result_id)) continue;
      stats.push({ resultId: row.post_result_id, views: count(row.view_count), likes: count(row.like_count), comments: count(row.comment_count), shares: count(row.share_count), ...(text(row.share_url) ? { url: text(row.share_url) } : {}) });
    }
    offset += rows.length;
    if (!rows.length || record(body.meta).next == null) break;
  }
  return stats;
}
/** Ask Post Bridge to read fresh numbers from the platforms. It allows this once every 30 minutes per account, so a refusal or a slow answer is not an error. */
export async function syncAnalytics(apiKey: string): Promise<void> {
  await call(apiKey, 'POST', '/analytics/sync', { timeoutMs: 90_000 }).catch(() => {});
}
