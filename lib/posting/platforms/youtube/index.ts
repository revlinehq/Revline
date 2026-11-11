import {
  PostingError,
  type AccountProfile,
  type AccountTokens,
  type PlatformAdapter,
  type PostStats,
  type PublishCheck,
  type PublishInput,
  type PublishResult,
} from '../../adapter';
import { failureMessage, rejectionMessage } from './errors';
import { getJson } from './http';
import { buildMetadata, isShort, type YouTubePublishOptions } from './metadata';
import { SCOPES, authUrl, exchangeCode, refresh, revoke } from './oauth';
import { CHUNK_BYTES, JOB_MAX_AGE_MS, UPLOAD_BUDGET_MS, decodeJob, encodeJob, readChunk, runUpload, startSession, type UploadJob, type VideoJob } from './upload';

export type { YouTubePublishOptions } from './metadata';

type ChannelList = {
  items?: { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string } | undefined> } }[];
};
type VideoList = {
  items?: {
    id: string;
    status?: { uploadStatus?: string; failureReason?: string; rejectionReason?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }[];
};

function videoUrl(job: VideoJob): string {
  return job.short ? `https://www.youtube.com/shorts/${job.id}` : `https://www.youtube.com/watch?v=${job.id}`;
}

function processing(job: UploadJob | VideoJob): { status: 'processing'; platformJobId: string } {
  return { status: 'processing', platformJobId: encodeJob(job) };
}

// The channel the token is tied to. Someone with several channels (Brand Accounts) chose one on Google's
// consent screen; connecting again and choosing another adds that channel as a separate account.
async function profile(tokens: AccountTokens): Promise<AccountProfile> {
  const list = await getJson<ChannelList>(tokens, 'channels', { part: 'snippet', mine: 'true' });
  const channel = list.items?.[0];
  if (!channel) {
    throw new PostingError('This Google account has no YouTube channel. Create a channel on YouTube, then connect again.', false, 'youtubeSignupRequired');
  }
  const snippet = channel.snippet ?? {};
  const thumbnails = snippet.thumbnails ?? {};
  return {
    platformAccountId: channel.id,
    // customUrl is the channel's handle ("@name") when it has one; the app writes the "@" itself.
    username: snippet.customUrl?.replace(/^@/, '') || snippet.title || channel.id,
    displayName: snippet.title,
    avatarUrl: (thumbnails.high ?? thumbnails.medium ?? thumbnails.default)?.url,
  };
}

async function publish(tokens: AccountTokens, input: PublishInput): Promise<PublishResult> {
  const deadline = Date.now() + UPLOAD_BUDGET_MS;
  const options = (input as PublishInput & { youtube?: YouTubePublishOptions }).youtube ?? {};
  // Fails on a bad title or caption before any quota is spent.
  const metadata = buildMetadata(input, options);

  // Read the first chunk before opening the session: it proves the file is reachable and gives its true size,
  // which YouTube must be told up front (input.videoBytes is not trusted for that).
  const first = await readChunk(input.videoUrl, 0, CHUNK_BYTES - 1);
  const session = await startSession(tokens, metadata, first.total, first.contentType, options.notifySubscribers);
  const job: UploadJob = { v: 1, kind: 'upload', session, source: input.videoUrl, bytes: first.total, short: isShort(input), at: Date.now() };

  try {
    const outcome = await runUpload(tokens, job, deadline, 0, first.data);
    // Uploaded is not yet published: YouTube still has to process the file and may reject it.
    return processing(outcome.done ? uploaded(job, outcome.videoId) : job);
  } catch (error) {
    // The session is open and holds whatever arrived. Throwing here would make the scheduler start a second
    // upload, so hand the session over for checkPublish to resume, unless it is gone or the failure is final.
    if (error instanceof PostingError && error.retryable && error.code !== 'uploadSessionExpired') return processing(job);
    throw error;
  }
}

function uploaded(job: UploadJob, videoId: string): VideoJob {
  return { v: 1, kind: 'video', id: videoId, short: job.short, at: Date.now() };
}

function tooOld(job: UploadJob | VideoJob): boolean {
  return Date.now() - job.at > JOB_MAX_AGE_MS;
}

async function checkUpload(tokens: AccountTokens, job: UploadJob): Promise<PublishCheck> {
  try {
    const outcome = await runUpload(tokens, job, Date.now() + UPLOAD_BUDGET_MS);
    if (outcome.done) return processing(uploaded(job, outcome.videoId));
    if (tooOld(job)) return { status: 'failed', error: 'The upload to YouTube did not finish within a day.', retryable: true };
    return processing(job);
  } catch (error) {
    if (!(error instanceof PostingError)) throw error;
    // A passing failure keeps the session for the next tick, but not for ever; an expired session cannot be
    // resumed at all. Either way "failed, retryable" makes the scheduler start a fresh publish.
    if (error.retryable && error.code !== 'uploadSessionExpired' && !tooOld(job)) return processing(job);
    return { status: 'failed', error: error.message, retryable: error.retryable };
  }
}

async function checkVideo(tokens: AccountTokens, job: VideoJob): Promise<PublishCheck> {
  let list: VideoList;
  try {
    list = await getJson<VideoList>(tokens, 'videos', { part: 'status', id: job.id });
  } catch (error) {
    if (!(error instanceof PostingError)) throw error;
    // The video exists; a passing failure only means "ask again later". Never "retryable" here: a new publish
    // would upload the video a second time.
    if (error.retryable && !tooOld(job)) return processing(job);
    return { status: 'failed', error: error.message, retryable: false };
  }
  const status = list.items?.[0]?.status;
  if (!status) return { status: 'failed', error: 'YouTube no longer has this video.', retryable: false };
  switch (status.uploadStatus) {
    case 'processed':
      return { status: 'published', platformPostId: job.id, url: videoUrl(job) };
    case 'failed':
      return { status: 'failed', error: failureMessage(status.failureReason), retryable: false };
    case 'rejected':
      return { status: 'failed', error: rejectionMessage(status.rejectionReason), retryable: false };
    case 'deleted':
      return { status: 'failed', error: 'The video was deleted from YouTube.', retryable: false };
    default:
      // 'uploaded': received, still being processed.
      if (tooOld(job)) return { status: 'failed', error: 'YouTube has not finished processing this video after a day. Check it in YouTube Studio.', retryable: false };
      return processing(job);
  }
}

async function checkPublish(tokens: AccountTokens, platformJobId: string): Promise<PublishCheck> {
  let job;
  try {
    job = decodeJob(platformJobId);
  } catch (error) {
    if (!(error instanceof PostingError)) throw error;
    return { status: 'failed', error: error.message, retryable: error.retryable };
  }
  return job.kind === 'upload' ? checkUpload(tokens, job) : checkVideo(tokens, job);
}

function count(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// The Data API has no share count (that lives in the YouTube Analytics API, behind another scope), so
// `shares` is left out. likeCount and commentCount are absent when the owner hides or disables them.
async function postStats(tokens: AccountTokens, platformPostId: string): Promise<PostStats> {
  const list = await getJson<VideoList>(tokens, 'videos', { part: 'statistics', id: platformPostId });
  const video = list.items?.[0];
  if (!video) throw new PostingError('YouTube no longer has this video.', false, 'videoNotFound');
  const statistics = video.statistics ?? {};
  return {
    views: count(statistics.viewCount),
    likes: count(statistics.likeCount),
    comments: count(statistics.commentCount),
    fetchedAt: Date.now(),
  };
}

export const youtube: PlatformAdapter = {
  platform: 'youtube',
  envKeys: { clientId: 'YOUTUBE_CLIENT_ID', clientSecret: 'YOUTUBE_CLIENT_SECRET' },
  scopes: SCOPES,
  authUrl,
  exchangeCode,
  refresh,
  profile,
  publish,
  checkPublish,
  postStats,
  revoke: (_credentials, tokens) => revoke(tokens),
};
