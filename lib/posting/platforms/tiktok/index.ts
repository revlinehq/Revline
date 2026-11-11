// TikTok adapter: Login Kit for Web (OAuth v2) + Content Posting API (Direct Post) + Display API (stats).
// Setup, limits and what the posting base still has to add: docs/posting/tiktok-setup.md
import { PostingError, type AccountProfile, type AccountTokens, type PlatformAdapter, type PlatformCredentials, type PostStats, type PublishCheck, type PublishInput, type PublishResult } from '../../adapter';
import { callApi, callRevoke, callToken } from './api';
import { creatorInfo, postInfo, validateVideo, type TikTokPrivacyLevel, type TikTokPublishInput } from './settings';
import { MAX_UPLOAD_BYTES, chunkPlan, uploadFromUrl } from './upload';

export { creatorInfo, VIDEO_LIMITS } from './settings';
export type { TikTokCreatorInfo, TikTokPostSettings, TikTokPrivacyLevel, TikTokPublishInput } from './settings';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
/** user.info.basic: account id, name, avatar. video.publish: Direct Post and creator info. video.list: read the account's own video stats. */
const SCOPES = ['user.info.basic', 'video.publish', 'video.list'];
/** A public post gets its id only after moderation. Past this wait, the post is reported as published without one. */
const PUBLIC_ID_WAIT_SECONDS = 10 * 60;
/** Marks a post that TikTok published but gave no id for (private posts never get one). */
const NO_ID_PREFIX = 'no-id:';

function tokensFrom(json: Record<string, unknown>, previous?: AccountTokens): AccountTokens {
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : Number(json.expires_in);
  const scope = typeof json.scope === 'string' ? json.scope : '';
  return {
    accessToken: String(json.access_token),
    // TikTok rotates the refresh token on every refresh; the old one stops working.
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : previous?.refreshToken,
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    scopes: scope ? scope.split(',').map((item) => item.trim()).filter(Boolean) : previous?.scopes ?? [],
  };
}

// The job id carries what checkPublish needs but the contract does not pass: the chosen privacy and the start time.
const encodeJob = (publishId: string, privacy: TikTokPrivacyLevel) => `${publishId}|${privacy}|${Math.floor(Date.now() / 1000)}`;
function decodeJob(platformJobId: string): { publishId: string; privacy?: string; startedAt?: number } {
  const parts = platformJobId.split('|');
  if (parts.length < 3) return { publishId: platformJobId };
  const startedAt = Number(parts[parts.length - 1]);
  return { publishId: parts.slice(0, -2).join('|'), privacy: parts[parts.length - 2], startedAt: Number.isFinite(startedAt) ? startedAt : undefined };
}

/** Post ids are 64-bit integers, which JSON.parse rounds; read them from the raw text. TikTok spells the field "publicaly". */
function postIds(raw: string): string[] {
  const match = /"public(?:al|l)y_available_post_id"\s*:\s*\[([^\]]*)\]/.exec(raw);
  return match ? match[1].match(/\d+/g) ?? [] : [];
}

const FAIL_REASONS: Record<string, { error: string; retryable: boolean }> = {
  file_format_check_failed: { error: 'TikTok does not accept this video\'s format. Use MP4 (H.264), WebM or MOV.', retryable: false },
  duration_check_failed: { error: 'TikTok rejected the video\'s length for this account.', retryable: false },
  frame_rate_check_failed: { error: 'TikTok needs a frame rate between 23 and 60 frames a second.', retryable: false },
  picture_size_check_failed: { error: 'TikTok needs the video\'s width and height to be between 360 and 4096 pixels.', retryable: false },
  internal: { error: 'TikTok had an internal error while processing the video. Try again.', retryable: true },
  video_pull_failed: { error: 'TikTok could not download the video from Revline. Try again.', retryable: true },
  photo_pull_failed: { error: 'TikTok could not download the media from Revline. Try again.', retryable: true },
  publish_cancelled: { error: 'The post was cancelled before TikTok published it.', retryable: false },
  auth_removed: { error: 'The TikTok account disconnected Revline before the post finished. Reconnect the account.', retryable: false },
  spam_risk_too_many_posts: { error: 'This TikTok account reached its daily limit for posts made through apps. Post again tomorrow.', retryable: false },
  spam_risk_user_banned_from_posting: { error: 'TikTok has blocked this account from posting.', retryable: false },
  spam_risk_text: { error: 'TikTok flagged the caption as spam. Change the caption and post again.', retryable: false },
  spam_risk: { error: 'TikTok flagged this post as spam and did not publish it.', retryable: false },
};

async function videoInit(tokens: AccountTokens, post: Record<string, unknown>, source: Record<string, unknown>) {
  const { data } = await callApi(tokens.accessToken, 'POST', '/v2/post/publish/video/init/', 'start the post', { body: { post_info: post, source_info: source }, startsPost: true });
  const publishId = typeof data.publish_id === 'string' ? data.publish_id : '';
  if (!publishId) throw new PostingError('TikTok accepted the post but returned no job id. Try again.', true, 'missing_publish_id');
  return { publishId, uploadUrl: typeof data.upload_url === 'string' ? data.upload_url : '' };
}

async function publish(tokens: AccountTokens, input: PublishInput): Promise<PublishResult> {
  validateVideo(input);
  const creator = await creatorInfo(tokens);
  const post = postInfo(input as TikTokPublishInput, creator);
  try {
    // Preferred: TikTok pulls the file from Revline's storage. Needs the media domain verified in the developer portal.
    const { publishId } = await videoInit(tokens, post, { source: 'PULL_FROM_URL', video_url: input.videoUrl });
    return { status: 'processing', platformJobId: encodeJob(publishId, post.privacy_level) };
  } catch (error) {
    if (!(error instanceof PostingError) || error.code !== 'url_ownership_unverified') throw error;
    if (input.videoBytes > MAX_UPLOAD_BYTES) throw error;
  }
  // Fallback while the media domain is unverified: copy the file to TikTok in chunks.
  const plan = chunkPlan(input.videoBytes);
  const { publishId, uploadUrl } = await videoInit(tokens, post, { source: 'FILE_UPLOAD', video_size: input.videoBytes, chunk_size: plan.chunkSize, total_chunk_count: plan.totalChunkCount });
  if (!uploadUrl) throw new PostingError('TikTok returned no upload address for the video. Try again.', true, 'missing_upload_url');
  try {
    await uploadFromUrl(uploadUrl, input.videoUrl, input.videoBytes, plan);
  } catch (error) {
    // Best effort: release the half-finished job so it does not count against the account.
    await callApi(tokens.accessToken, 'POST', '/v2/post/publish/cancel/', 'cancel the post', { body: { publish_id: publishId } }).catch(() => {});
    throw error;
  }
  return { status: 'processing', platformJobId: encodeJob(publishId, post.privacy_level) };
}

async function postUrl(tokens: AccountTokens, postId: string | null): Promise<string> {
  if (postId) {
    const shareUrl = await callApi(tokens.accessToken, 'POST', '/v2/video/query/', 'read the post link', { query: { fields: 'id,share_url' }, body: { filters: { video_ids: [postId] } } })
      .then(({ data }) => (Array.isArray(data.videos) ? (data.videos[0] as { share_url?: unknown } | undefined)?.share_url : undefined))
      .catch(() => undefined);
    if (typeof shareUrl === 'string' && shareUrl) return shareUrl;
  }
  // A passing failure here is thrown so the next poll tries again, rather than saving a link that leads nowhere.
  const username = await creatorInfo(tokens).then((creator) => creator.username).catch((error: unknown) => {
    if (error instanceof PostingError && error.retryable) throw error;
    return '';
  });
  if (!username) return 'https://www.tiktok.com/';
  return postId ? `https://www.tiktok.com/@${username}/video/${postId}` : `https://www.tiktok.com/@${username}`;
}

/**
 * A thrown PostingError means the status could not be read (retryable: poll again). A returned `failed` means TikTok
 * dropped the post (retryable: publishing it again may work).
 */
async function checkPublish(tokens: AccountTokens, platformJobId: string): Promise<PublishCheck> {
  const { publishId, privacy, startedAt } = decodeJob(platformJobId);
  let result;
  try {
    result = await callApi(tokens.accessToken, 'POST', '/v2/post/publish/status/fetch/', 'read the post status', { body: { publish_id: publishId } });
  } catch (error) {
    if (error instanceof PostingError && (error.code === 'invalid_publish_id' || error.code === 'token_not_authorized_for_specified_publish_id')) return { status: 'failed', error: error.message, retryable: false };
    throw error;
  }
  const status = typeof result.data.status === 'string' ? result.data.status : '';
  if (status === 'FAILED') {
    const reason = typeof result.data.fail_reason === 'string' ? result.data.fail_reason : '';
    return { status: 'failed', ...(FAIL_REASONS[reason] ?? { error: `TikTok could not publish the video${reason ? ` (${reason})` : ''}.`, retryable: false }) };
  }
  if (status !== 'PUBLISH_COMPLETE') return { status: 'processing', platformJobId };
  const [postId] = postIds(result.raw);
  if (postId) return { status: 'published', platformPostId: postId, url: await postUrl(tokens, postId) };
  // TikTok gives an id only to public posts that passed moderation. Wait for it on a public post, within reason.
  const waited = startedAt === undefined ? Infinity : Date.now() / 1000 - startedAt;
  if (privacy === 'PUBLIC_TO_EVERYONE' && waited < PUBLIC_ID_WAIT_SECONDS) return { status: 'processing', platformJobId };
  return { status: 'published', platformPostId: `${NO_ID_PREFIX}${publishId}`, url: await postUrl(tokens, null) };
}

async function postStats(tokens: AccountTokens, platformPostId: string): Promise<PostStats> {
  const notPublic = new PostingError('TikTok shares stats only for public posts. This post is private or still in review.', false, 'post_not_public');
  let postId = platformPostId;
  if (platformPostId.startsWith(NO_ID_PREFIX)) {
    // The post had no id when it was published; TikTok adds one to the job once the post is public.
    const { raw } = await callApi(tokens.accessToken, 'POST', '/v2/post/publish/status/fetch/', 'read the post status', { body: { publish_id: platformPostId.slice(NO_ID_PREFIX.length) } });
    postId = postIds(raw)[0] ?? '';
  }
  if (!/^\d+$/.test(postId)) throw notPublic;
  const { data } = await callApi(tokens.accessToken, 'POST', '/v2/video/query/', 'read the post\'s stats', { query: { fields: 'id,view_count,like_count,comment_count,share_count' }, body: { filters: { video_ids: [postId] } } });
  const video = Array.isArray(data.videos) ? (data.videos[0] as Record<string, unknown> | undefined) : undefined;
  if (!video) throw new PostingError('TikTok has no public post with this id on this account. It may have been deleted or made private.', false, 'post_not_found');
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0);
  return { views: count(video.view_count), likes: count(video.like_count), comments: count(video.comment_count), shares: count(video.share_count), fetchedAt: Date.now() };
}

async function profile(tokens: AccountTokens): Promise<AccountProfile> {
  const { data } = await callApi(tokens.accessToken, 'GET', '/v2/user/info/', 'read the account\'s profile', { query: { fields: 'open_id,display_name,avatar_url' } });
  const user = (typeof data.user === 'object' && data.user !== null ? data.user : {}) as Record<string, unknown>;
  const openId = typeof user.open_id === 'string' ? user.open_id : '';
  if (!openId) throw new PostingError('TikTok did not return an account id. Connect the account again.', false, 'missing_open_id');
  const displayName = typeof user.display_name === 'string' && user.display_name ? user.display_name : undefined;
  // The @handle comes with the posting permission (creator info), so the connect screen needs no extra profile scope.
  const username = await creatorInfo(tokens).then((creator) => creator.username).catch(() => '');
  return { platformAccountId: openId, username: username || displayName || openId, displayName, avatarUrl: typeof user.avatar_url === 'string' && user.avatar_url ? user.avatar_url : undefined };
}

export const tiktok: PlatformAdapter = {
  platform: 'tiktok',
  envKeys: { clientId: 'TIKTOK_CLIENT_KEY', clientSecret: 'TIKTOK_CLIENT_SECRET' },
  scopes: SCOPES,
  authUrl(credentials: PlatformCredentials, state: string): string {
    // Login Kit for Web takes no PKCE parameters (only desktop and mobile do); `state` is the CSRF protection.
    const query = new URLSearchParams({ client_key: credentials.clientId, scope: SCOPES.join(','), response_type: 'code', redirect_uri: credentials.redirectUri, state });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  },
  /** `code` must be the URL-decoded value from the callback (URLSearchParams already decodes it). */
  async exchangeCode(credentials: PlatformCredentials, code: string): Promise<AccountTokens> {
    return tokensFrom(await callToken({ client_key: credentials.clientId, client_secret: credentials.clientSecret, code, grant_type: 'authorization_code', redirect_uri: credentials.redirectUri }, 'finish connecting the account'));
  },
  async refresh(credentials: PlatformCredentials, tokens: AccountTokens): Promise<AccountTokens> {
    if (!tokens.refreshToken) throw new PostingError('This TikTok connection cannot be renewed. Connect the account again.', false, 'missing_refresh_token');
    return tokensFrom(await callToken({ client_key: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, 'renew the connection'), tokens);
  },
  profile,
  publish,
  checkPublish,
  postStats,
  async revoke(credentials: PlatformCredentials, tokens: AccountTokens): Promise<void> {
    let accessToken = tokens.accessToken;
    // TikTok revokes by access token, and one lasts a day: an expired one is renewed first so there is something to revoke.
    if (tokens.expiresAt !== undefined && tokens.expiresAt <= Date.now() && tokens.refreshToken) {
      accessToken = String((await callToken({ client_key: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, 'renew the connection')).access_token);
    }
    await callRevoke({ client_key: credentials.clientId, client_secret: credentials.clientSecret, token: accessToken }, 'disconnect the account');
  },
};
