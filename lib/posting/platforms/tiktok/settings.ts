// The creator-info query that must precede every post, the per-post settings TikTok requires the user to choose,
// and the documented video limits. Rules: https://developers.tiktok.com/doc/content-sharing-guidelines
// Limits: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
import { PostingError, type AccountTokens, type PublishInput } from '../../adapter';
import { callApi } from './api';

export type TikTokPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';

/** What the post screen must show before a post: who is posting, which privacy levels they may pick, and which interactions they have turned off. */
export type TikTokCreatorInfo = {
  username: string;
  nickname: string;
  avatarUrl: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoDurationSeconds: number;
};

/**
 * The per-post choices TikTok requires the user to make. The shared PublishInput cannot carry them yet, so publish()
 * reads them from an optional `tiktok` field on its input; without it the safe defaults below apply.
 */
export type TikTokPostSettings = {
  /** Must be one of the creator's privacyLevelOptions. Default: SELF_ONLY ("Only me"). */
  privacyLevel?: TikTokPrivacyLevel;
  /** TikTok requires these to start unchecked, so each defaults to false. */
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  /** Commercial content disclosure: promotes the creator's own business ("Your brand"). */
  yourBrand?: boolean;
  /** Commercial content disclosure: a paid partnership ("Branded content"). Cannot be posted as SELF_ONLY. */
  brandedContent?: boolean;
  /** Labels the video as AI-generated. */
  aiGenerated?: boolean;
  /** Frame used as the cover, in milliseconds. Default: the first frame. */
  coverTimestampMs?: number;
};
export type TikTokPublishInput = PublishInput & { tiktok?: TikTokPostSettings };

export const VIDEO_LIMITS = {
  maxBytes: 4 * 1024 ** 3,
  minSidePx: 360,
  maxSidePx: 4096,
  /** The longest video any account can post through the API; each account's own limit comes from creator info. */
  maxDurationSeconds: 600,
  /** Caption length, counted in UTF-16 units as TikTok does. */
  maxCaptionLength: 2200,
} as const;

const PRIVACY_LEVELS: readonly string[] = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
const invalid = (message: string, code: string) => new PostingError(message, false, code);

/** https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info (20 requests a minute per account). */
export async function creatorInfo(tokens: AccountTokens): Promise<TikTokCreatorInfo> {
  const { data } = await callApi(tokens.accessToken, 'POST', '/v2/post/publish/creator_info/query/', 'read the account\'s posting settings');
  const options = Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [];
  return {
    username: typeof data.creator_username === 'string' ? data.creator_username : '',
    nickname: typeof data.creator_nickname === 'string' ? data.creator_nickname : '',
    avatarUrl: typeof data.creator_avatar_url === 'string' ? data.creator_avatar_url : '',
    privacyLevelOptions: options.filter((option): option is TikTokPrivacyLevel => typeof option === 'string' && PRIVACY_LEVELS.includes(option)),
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoDurationSeconds: typeof data.max_video_post_duration_sec === 'number' ? data.max_video_post_duration_sec : VIDEO_LIMITS.maxDurationSeconds,
  };
}

/** Checks the video against TikTok's documented limits before any API call. Frame rate (23–60) and codec are not in PublishInput, so TikTok checks those. */
export function validateVideo(input: PublishInput): void {
  let url: URL | null = null;
  try { url = new URL(input.videoUrl); } catch { /* reported below */ }
  if (!url || url.protocol !== 'https:') throw invalid('The video address must be an https link.', 'invalid_video_url');
  if (!Number.isSafeInteger(input.videoBytes) || input.videoBytes <= 0) throw invalid('The video file is empty or its size is unknown.', 'invalid_video_size');
  if (input.videoBytes > VIDEO_LIMITS.maxBytes) throw invalid('The video is larger than 4 GB, the most TikTok accepts.', 'video_too_large');
  for (const side of [input.width, input.height]) {
    if (!Number.isFinite(side) || side < VIDEO_LIMITS.minSidePx || side > VIDEO_LIMITS.maxSidePx) throw invalid(`TikTok needs the video's width and height to be between ${VIDEO_LIMITS.minSidePx} and ${VIDEO_LIMITS.maxSidePx} pixels; this one is ${input.width}×${input.height}.`, 'video_resolution');
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) throw invalid('The video has no duration.', 'video_duration');
  if (input.durationSeconds > VIDEO_LIMITS.maxDurationSeconds) throw invalid('The video is longer than 10 minutes, the most TikTok accepts through apps.', 'video_too_long');
  if (input.caption.length > VIDEO_LIMITS.maxCaptionLength) throw invalid(`The caption is ${input.caption.length} characters; TikTok allows ${VIDEO_LIMITS.maxCaptionLength}.`, 'caption_too_long');
}

/** Turns the user's choices (or the defaults) into TikTok's `post_info`, enforcing what this creator is allowed to do. */
export function postInfo(input: TikTokPublishInput, creator: TikTokCreatorInfo): Record<string, unknown> & { privacy_level: TikTokPrivacyLevel } {
  const settings = input.tiktok ?? {};
  if (input.durationSeconds > creator.maxVideoDurationSeconds) throw invalid(`This TikTok account can post videos up to ${creator.maxVideoDurationSeconds} seconds; this one is ${Math.ceil(input.durationSeconds)} seconds.`, 'video_too_long');
  const privacy = settings.privacyLevel ?? 'SELF_ONLY';
  if (!creator.privacyLevelOptions.includes(privacy)) throw invalid('The chosen "who can view" setting is not available for this TikTok account. Choose another one.', 'privacy_level_option_mismatch');
  if (settings.brandedContent && privacy === 'SELF_ONLY') throw invalid('Branded content cannot be posted as "Only me". Choose a wider audience or turn branded content off.', 'branded_content_private');
  return {
    ...(input.caption ? { title: input.caption } : {}),
    privacy_level: privacy,
    disable_comment: creator.commentDisabled || settings.allowComment !== true,
    disable_duet: creator.duetDisabled || settings.allowDuet !== true,
    disable_stitch: creator.stitchDisabled || settings.allowStitch !== true,
    brand_organic_toggle: settings.yourBrand === true,
    brand_content_toggle: settings.brandedContent === true,
    ...(settings.aiGenerated ? { is_aigc: true } : {}),
    ...(typeof settings.coverTimestampMs === 'number' && settings.coverTimestampMs >= 0 ? { video_cover_timestamp_ms: Math.round(settings.coverTimestampMs) } : {}),
  };
}
