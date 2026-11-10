// Instagram adapter: connect a professional (business or creator) account and post a Reel to it.
// Route: Instagram API with Instagram Login ("Business Login for Instagram"), which needs no Facebook Page.
// Setup and the reasons for this route: docs/posting/instagram-setup.md
//
// Flow, per https://developers.facebook.com/docs/instagram-platform/content-publishing:
//   publish       -> POST /<IG_ID>/media (media_type=REELS, video_url): Instagram downloads and processes the file
//   checkPublish  -> GET /<CONTAINER_ID>?fields=status_code; once FINISHED, POST /<IG_ID>/media_publish, then read the permalink
import {
  PostingError,
  type AccountProfile,
  type AccountTokens,
  type PlatformAdapter,
  type PostStats,
  type PublishCheck,
} from '../../adapter';
import {
  AUTHORIZE_URL,
  CODE_EXCHANGE_URL,
  GRAPH_HOST,
  GRAPH_URL,
  describeContainerError,
  instagramRequest,
  unwrap,
} from './api';
import { assertPostable } from './limits';

const SCOPE_BASIC = 'instagram_business_basic';
const SCOPE_PUBLISH = 'instagram_business_content_publish';
const SCOPE_INSIGHTS = 'instagram_business_manage_insights';
const SCOPES = [SCOPE_BASIC, SCOPE_PUBLISH, SCOPE_INSIGHTS];

const DAY_MS = 24 * 60 * 60 * 1000;
/** A container that is not published within 24 hours expires. */
const CONTAINER_LIFETIME_MS = DAY_MS;
/** How long checkPublish keeps asking when Instagram cannot be reached, before giving up without a re-upload. */
const GIVE_UP_MS = 2 * DAY_MS;

type TokenResponse = { access_token: string; expires_in?: number; user_id?: string | number; permissions?: string | string[] };
type MeResponse = { id?: string; user_id?: string | number; username?: string; name?: string; profile_picture_url?: string };
type MediaItem = { id: string; permalink?: string; timestamp?: string };

function longLivedTokens(response: TokenResponse, scopes: string[]): AccountTokens {
  if (!response.access_token) {
    throw new PostingError('Instagram did not return a connection. Connect the account again.', false, 'no_token');
  }
  return {
    accessToken: response.access_token,
    // Instagram has no separate refresh token: the long-lived token itself is refreshed.
    ...(response.expires_in ? { expiresAt: Date.now() + response.expires_in * 1000 } : {}),
    scopes,
  };
}

async function fetchMe(tokens: AccountTokens): Promise<MeResponse & { accountId: string }> {
  const me = unwrap(
    await instagramRequest<MeResponse | { data?: MeResponse[] }>(`${GRAPH_URL}/me`, {
      query: { fields: 'user_id,username,name,profile_picture_url', access_token: tokens.accessToken },
    }),
  );
  // `user_id` is the Instagram professional account ID used for publishing; `id` is app-scoped.
  const accountId = String(me.user_id ?? me.id ?? '');
  if (!accountId) throw new PostingError('Instagram did not say which account this is. Reconnect the account.', false, 'no_account_id');
  return { ...me, accountId };
}

/** Throws a retryable error when the account has used up its API posts for the last 24 hours. */
async function assertUnderDailyLimit(tokens: AccountTokens, accountId: string): Promise<void> {
  let used = 0;
  let total = Infinity;
  try {
    const body = await instagramRequest<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      `${GRAPH_URL}/${accountId}/content_publishing_limit`,
      { query: { fields: 'quota_usage,config', access_token: tokens.accessToken } },
    );
    used = body.data?.[0]?.quota_usage ?? 0;
    total = body.data?.[0]?.config?.quota_total ?? Infinity;
  } catch {
    // This check is a courtesy; if it cannot be read, the publish call itself reports the limit.
    return;
  }
  if (used >= total) {
    throw new PostingError(
      `This Instagram account already posted ${used} times through apps in the last 24 hours, which is Instagram's limit. It will be tried again later.`,
      true,
      'daily_limit',
    );
  }
}

const jobId = (accountId: string, containerId: string, startedAt: number) => `${accountId}:${containerId}:${startedAt}`;

const recentMedia = async (tokens: AccountTokens, accountId: string) =>
  (
    await instagramRequest<{ data?: MediaItem[] }>(`${GRAPH_URL}/${accountId}/media`, {
      query: { fields: 'id,permalink,timestamp', limit: '10', access_token: tokens.accessToken },
    })
  ).data ?? [];

/** Reads the public link of a post that was just made. Never throws: the post is live whatever happens here. */
async function permalinkOf(tokens: AccountTokens, accountId: string, mediaId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const media = await instagramRequest<MediaItem>(`${GRAPH_URL}/${mediaId}`, {
        query: { fields: 'permalink', access_token: tokens.accessToken },
      });
      if (media.permalink) return media.permalink;
    } catch {
      // A new post can be unreadable for a moment; try again, then look for it in the account's list.
    }
  }
  try {
    return (await recentMedia(tokens, accountId)).find((item) => item.id === mediaId)?.permalink || null;
  } catch {
    return null;
  }
}

/**
 * A container can be PUBLISHED without us holding the post's ID (the publish call succeeded but its answer was lost).
 * The container does not name its post, so find the single post the account made since this job started.
 */
async function recoverPublished(tokens: AccountTokens, accountId: string, startedAt: number): Promise<PublishCheck> {
  const since = startedAt - 60_000;
  const candidates = (await recentMedia(tokens, accountId)).filter((item) => {
    const postedAt = Date.parse((item.timestamp ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isFinite(postedAt) && postedAt >= since && Boolean(item.permalink);
  });
  if (candidates.length === 1) {
    return { status: 'published', platformPostId: candidates[0].id, url: candidates[0].permalink as string };
  }
  return {
    status: 'failed',
    error: 'Instagram says this video was posted, but its link could not be found. Check the Instagram account before posting it again.',
    retryable: false,
  };
}

export const instagram: PlatformAdapter = {
  platform: 'instagram',
  envKeys: { clientId: 'INSTAGRAM_CLIENT_ID', clientSecret: 'INSTAGRAM_CLIENT_SECRET' },
  scopes: SCOPES,

  authUrl(credentials, state) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(','));
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchangeCode(credentials, code) {
    // The code is valid for one hour and one use. Instagram appends "#_" to the redirect; it is not part of the code.
    const shortLived = unwrap(
      await instagramRequest<TokenResponse | { data?: TokenResponse[] }>(CODE_EXCHANGE_URL, {
        method: 'POST',
        form: {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: credentials.redirectUri,
          code: code.replace(/#_$/, ''),
        },
      }),
    );
    if (!shortLived.access_token) {
      throw new PostingError('Instagram did not return a connection. Connect the account again.', false, 'no_token');
    }
    const granted = (Array.isArray(shortLived.permissions) ? shortLived.permissions : (shortLived.permissions ?? '').split(','))
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (granted.length > 0 && !granted.includes(SCOPE_PUBLISH)) {
      throw new PostingError(
        'Instagram did not give permission to post. Connect again and leave every permission switched on.',
        false,
        'publish_permission_missing',
      );
    }
    // The short-lived token lasts one hour; trade it for the 60-day one straight away.
    const longLived = await instagramRequest<TokenResponse>(`${GRAPH_HOST}/access_token`, {
      query: { grant_type: 'ig_exchange_token', client_secret: credentials.clientSecret, access_token: shortLived.access_token },
    });
    return longLivedTokens(longLived, granted.length > 0 ? granted : [...SCOPES]);
  },

  async refresh(_credentials, tokens) {
    const now = Date.now();
    if (tokens.expiresAt !== undefined) {
      if (tokens.expiresAt <= now) {
        throw new PostingError('The Instagram connection expired. Reconnect the Instagram account.', false, 'token_expired');
      }
      // Instagram only refreshes a token that is at least 24 hours old; a 60-day token with more than 59 days left is younger.
      if (tokens.expiresAt - now > 59 * DAY_MS) return tokens;
    }
    const refreshed = await instagramRequest<TokenResponse>(`${GRAPH_HOST}/refresh_access_token`, {
      query: { grant_type: 'ig_refresh_token', access_token: tokens.accessToken },
    });
    return longLivedTokens(refreshed, tokens.scopes);
  },

  async profile(tokens): Promise<AccountProfile> {
    const me = await fetchMe(tokens);
    return {
      platformAccountId: me.accountId,
      username: me.username ?? me.accountId,
      ...(me.name ? { displayName: me.name } : {}),
      ...(me.profile_picture_url ? { avatarUrl: me.profile_picture_url } : {}),
    };
  },

  async publish(tokens, input) {
    assertPostable(input);
    const { accountId } = await fetchMe(tokens);
    await assertUnderDailyLimit(tokens, accountId);
    const startedAt = Date.now();
    // Reels have no title; only the caption is shown.
    const container = await instagramRequest<{ id?: string }>(`${GRAPH_URL}/${accountId}/media`, {
      method: 'POST',
      form: {
        media_type: 'REELS',
        video_url: input.videoUrl,
        caption: input.caption,
        share_to_feed: 'true',
        access_token: tokens.accessToken,
      },
    });
    if (!container.id) throw new PostingError('Instagram did not accept the upload. It will be tried again.', true, 'no_container');
    return { status: 'processing', platformJobId: jobId(accountId, container.id, startedAt) };
  },

  async checkPublish(tokens, platformJobId): Promise<PublishCheck> {
    const [accountId, containerId, startedAtText] = platformJobId.split(':');
    const startedAt = Number(startedAtText);
    if (!accountId || !containerId || !Number.isFinite(startedAt)) {
      return { status: 'failed', error: 'This Instagram upload can no longer be followed. Post the video again.', retryable: true };
    }
    const stillProcessing: PublishCheck = { status: 'processing', platformJobId };
    try {
      const container = await instagramRequest<{ status_code?: string; status?: string }>(`${GRAPH_URL}/${containerId}`, {
        query: { fields: 'status_code,status', access_token: tokens.accessToken },
      });
      switch (container.status_code) {
        case 'FINISHED': {
          const published = await instagramRequest<{ id?: string }>(`${GRAPH_URL}/${accountId}/media_publish`, {
            method: 'POST',
            form: { creation_id: containerId, access_token: tokens.accessToken },
          });
          // If the ID or link cannot be read, the next check finds the container PUBLISHED and recovers the post.
          const url = published.id ? await permalinkOf(tokens, accountId, published.id) : null;
          return published.id && url ? { status: 'published', platformPostId: published.id, url } : stillProcessing;
        }
        case 'PUBLISHED':
          return await recoverPublished(tokens, accountId, startedAt);
        case 'ERROR': {
          const failure = describeContainerError(container.status);
          return { status: 'failed', error: failure.message, retryable: failure.retryable };
        }
        case 'EXPIRED':
          return { status: 'failed', error: 'The upload expired before it was published. It will be uploaded again.', retryable: true };
        default:
          // IN_PROGRESS, or a state this version does not know yet.
          if (Date.now() - startedAt > CONTAINER_LIFETIME_MS) {
            return { status: 'failed', error: 'Instagram did not finish processing the video within 24 hours.', retryable: true };
          }
          return stillProcessing;
      }
    } catch (error) {
      if (!(error instanceof PostingError)) throw error;
      // A passing problem (network, rate limit, daily post limit) must never start a second upload: the publish call may
      // have gone through. Keep checking the same container until it resolves or expires.
      if (!error.retryable) return { status: 'failed', error: error.message, retryable: false };
      if (Date.now() - startedAt <= GIVE_UP_MS) return stillProcessing;
      // Never answer "retryable" here: whether the video was posted is unknown, and a retry would upload it again.
      return {
        status: 'failed',
        error: 'Instagram could not be reached to confirm this post. Check the Instagram account before posting it again.',
        retryable: false,
      };
    }
  },

  async postStats(tokens, platformPostId): Promise<PostStats> {
    const totals: Record<string, number> = {};
    try {
      // https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
      const insights = await instagramRequest<{
        data?: { name?: string; values?: { value?: number }[]; total_value?: { value?: number } }[];
      }>(`${GRAPH_URL}/${platformPostId}/insights`, {
        query: { metric: 'views,likes,comments,shares', access_token: tokens.accessToken },
      });
      for (const metric of insights.data ?? []) {
        const value = metric.values?.[0]?.value ?? metric.total_value?.value;
        if (metric.name && typeof value === 'number') totals[metric.name] = value;
      }
    } catch (error) {
      // Without the insights permission the like and comment counts below are still readable; an expired connection
      // fails that read too and is reported from there. Views then stay 0, so leave a trace of why.
      if (!(error instanceof PostingError) || error.retryable) throw error;
      console.warn(`Instagram insights unavailable for post ${platformPostId}: ${error.message}`);
    }
    if (totals.likes === undefined || totals.comments === undefined) {
      // Insights can lag by up to 48 hours and come back empty; the post itself carries live like and comment counts.
      const media = await instagramRequest<{ like_count?: number; comments_count?: number }>(`${GRAPH_URL}/${platformPostId}`, {
        query: { fields: 'like_count,comments_count', access_token: tokens.accessToken },
      });
      totals.likes ??= media.like_count ?? 0;
      totals.comments ??= media.comments_count ?? 0;
    }
    return {
      views: totals.views ?? 0,
      likes: totals.likes,
      comments: totals.comments,
      ...(totals.shares !== undefined ? { shares: totals.shares } : {}),
      fetchedAt: Date.now(),
    };
  },
};
