import { PostingError } from '../../adapter';

// Every error reason documented for videos.insert, videos.list, channels.list and the shared
// "core", "common request" and "request context" tables of the YouTube Data API, in plain words.
// https://developers.google.com/youtube/v3/docs/errors
// https://developers.google.com/youtube/v3/docs/videos/insert#errors
//
// `retryable` means "the same request can succeed later without the user changing anything".
// Two of those only succeed much later, so the scheduler should space retries by `code`:
// quotaExceeded resets at midnight Pacific Time, uploadLimitExceeded clears within about a day.
type Mapped = { message: string; retryable: boolean };

const RECONNECT = 'Reconnect the YouTube channel in Revline and try again.';

const REASONS: Record<string, Mapped> = {
  // Quota and rate limits.
  quotaExceeded: { message: "Revline has used up today's YouTube allowance. Posting resumes after midnight Pacific Time.", retryable: true },
  dailyLimitExceeded: { message: "Revline has used up today's YouTube allowance. Posting resumes after midnight Pacific Time.", retryable: true },
  rateLimitExceeded: { message: 'YouTube is receiving too many requests right now. Revline will try again shortly.', retryable: true },
  userRateLimitExceeded: { message: 'YouTube is receiving too many requests right now. Revline will try again shortly.', retryable: true },
  uploadLimitExceeded: { message: 'This channel has reached the number of videos YouTube lets it upload for now. Try again in about 24 hours.', retryable: true },

  // The video's details.
  invalidTitle: { message: 'YouTube rejected the title. It must not be empty, longer than 100 characters, or contain < or >.', retryable: false },
  invalidDescription: { message: 'YouTube rejected the description. It must be under 5,000 bytes and must not contain < or >.', retryable: false },
  invalidTags: { message: 'YouTube rejected the tags on this video.', retryable: false },
  invalidCategoryId: { message: 'YouTube rejected the video category.', retryable: false },
  invalidVideoMetadata: { message: "YouTube rejected the video's details.", retryable: false },
  invalidPublishAt: { message: 'YouTube rejected the scheduled publishing time.', retryable: false },
  invalidRecordingDetails: { message: 'YouTube rejected the recording details.', retryable: false },
  invalidVideoGameRating: { message: 'YouTube rejected the video game rating.', retryable: false },
  invalidFilename: { message: 'YouTube rejected the file name of the upload.', retryable: false },
  defaultLanguageNotSet: { message: 'YouTube needs a default language before translated details can be added.', retryable: false },
  mediaBodyRequired: { message: 'The upload reached YouTube without a video file.', retryable: false },
  forbiddenLicenseSetting: { message: 'This channel is not allowed to use the chosen license.', retryable: false },
  forbiddenPrivacySetting: { message: 'This channel is not allowed to use the chosen privacy setting.', retryable: false },

  // The account or channel.
  forbidden: { message: `YouTube refused this request for the connected channel. ${RECONNECT}`, retryable: false },
  insufficientPermissions: { message: `Revline was not given permission to do this on YouTube. ${RECONNECT}`, retryable: false },
  youtubeSignupRequired: { message: 'This Google account has no YouTube channel. Create a channel on YouTube, then connect again.', retryable: false },
  authenticatedUserNotChannel: { message: 'This Google account has no YouTube channel. Create a channel on YouTube, then connect again.', retryable: false },
  authenticatedUserAccountClosed: { message: 'This YouTube account is closed.', retryable: false },
  authenticatedUserAccountSuspended: { message: 'This YouTube account is suspended.', retryable: false },
  accountDelegationForbidden: { message: 'This Google account is not allowed to act for that YouTube channel.', retryable: false },
  channelClosed: { message: 'This YouTube channel is closed.', retryable: false },
  channelSuspended: { message: 'This YouTube channel is suspended.', retryable: false },
  channelNotFound: { message: `YouTube could not find the connected channel. ${RECONNECT}`, retryable: false },
  channelForbidden: { message: `YouTube refused access to the connected channel. ${RECONNECT}`, retryable: false },
  cmsUserAccountNotFound: { message: 'This account cannot act for that YouTube content owner.', retryable: false },
  contentOwnerAccountNotFound: { message: 'YouTube could not find that content owner account.', retryable: false },
  insufficientCapabilities: { message: 'This account lacks the YouTube permissions needed for this.', retryable: false },

  // The video being read.
  videoNotFound: { message: 'YouTube no longer has this video.', retryable: false },
};

// Request-shape errors (invalidPart, missingRequiredParameter, …) mean a bug in this adapter, not something
// the user can fix, so they share one message and keep YouTube's own text in the error code path below.
const REQUEST_BUG = new Set([
  'incompatibleParameters', 'invalidFilters', 'invalidPageToken', 'missingRequiredParameter', 'unexpectedParameter',
  'invalidLanguage', 'invalidMine', 'invalidPart', 'invalidRegionCode', 'unexpectedPart', 'unknownPart',
  'unsupportedLanguageCode', 'unsupportedRegionCode', 'invalidCriteria', 'videoChartNotFound', 'categoryNotFound',
]);

// OAuth token endpoint errors. https://developers.google.com/identity/protocols/oauth2/web-server#handlingresponse
const OAUTH: Record<string, Mapped> = {
  invalid_grant: { message: `YouTube access has expired or was removed. ${RECONNECT}`, retryable: false },
  invalid_client: { message: "Revline's YouTube app credentials are wrong. Check YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET.", retryable: false },
  deleted_client: { message: "Revline's YouTube app was deleted in Google Cloud.", retryable: false },
  unauthorized_client: { message: "Revline's YouTube app is not allowed to sign in this way.", retryable: false },
  redirect_uri_mismatch: { message: 'The redirect address does not match the one registered in Google Cloud.', retryable: false },
  invalid_request: { message: 'Google rejected the sign-in request.', retryable: false },
  invalid_scope: { message: 'Google rejected the permissions Revline asked for.', retryable: false },
  access_denied: { message: 'Access to YouTube was not granted.', retryable: false },
  admin_policy_enforced: { message: "This Google Workspace's administrator does not allow connecting YouTube to Revline.", retryable: false },
  org_internal: { message: "Revline's YouTube app only allows accounts from its own organisation.", retryable: false },
  disallowed_useragent: { message: "Google does not allow signing in from this in-app browser. Open Revline in your device's browser.", retryable: false },
};

type GoogleErrorBody = {
  error?: string | { code?: number; message?: string; errors?: { reason?: string; message?: string }[] };
  error_description?: string;
};

function byStatus(status: number): Mapped {
  if (status === 401) return { message: `YouTube did not accept the saved sign-in. ${RECONNECT}`, retryable: true };
  if (status === 403) return { message: `YouTube refused this request. ${RECONNECT}`, retryable: false };
  if (status === 404) return { message: 'YouTube could not find what was asked for.', retryable: false };
  if (status === 408 || status === 429 || status >= 500) return { message: 'YouTube is temporarily unavailable. Revline will try again.', retryable: true };
  return { message: 'YouTube rejected the request.', retryable: false };
}

/** Turns a failed Google response (Data API or OAuth token endpoint) into a PostingError. */
export function errorFromBody(status: number, text: string): PostingError {
  let body: GoogleErrorBody = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') body = parsed as GoogleErrorBody;
  } catch { /* not JSON: fall back to the status code */ }

  if (typeof body.error === 'string') {
    const mapped = OAUTH[body.error] ?? byStatus(status);
    return new PostingError(mapped.message, mapped.retryable, body.error);
  }
  const reason = body.error?.errors?.[0]?.reason;
  // Any rejected access token gets one code, whatever reason Google attaches (authError, authorizationRequired, …),
  // so the base can refresh on it. A dead refresh token then fails with invalid_grant, which is final.
  if (status === 401 && reason !== 'youtubeSignupRequired') {
    return new PostingError(byStatus(401).message, true, 'unauthorized');
  }
  if (reason && REASONS[reason]) return new PostingError(REASONS[reason].message, REASONS[reason].retryable, reason);
  if (reason && REQUEST_BUG.has(reason)) {
    return new PostingError(`Revline sent YouTube a request it did not understand (${reason}).`, false, reason);
  }
  const mapped = byStatus(status);
  return new PostingError(mapped.message, mapped.retryable, reason ?? `http${status}`);
}

export async function errorFromResponse(response: Response): Promise<PostingError> {
  const text = await response.text().catch(() => '');
  return errorFromBody(response.status, text);
}

// Why YouTube could not process an uploaded file (status.failureReason) or took it down (status.rejectionReason).
// https://developers.google.com/youtube/v3/docs/videos#status
const FAILURE: Record<string, string> = {
  codec: 'YouTube does not support the format this video is encoded in.',
  conversion: 'YouTube could not convert this video.',
  emptyFile: 'YouTube received an empty file.',
  invalidFile: 'YouTube could not read this file as a video.',
  tooSmall: 'The video file is too small for YouTube.',
  uploadAborted: 'The upload to YouTube was interrupted.',
};
const REJECTION: Record<string, string> = {
  claim: 'YouTube rejected the video because of a content claim.',
  copyright: 'YouTube rejected the video for copyright reasons.',
  duplicate: 'YouTube rejected the video as a duplicate of one already on the channel.',
  inappropriate: 'YouTube rejected the video as inappropriate.',
  legal: 'YouTube rejected the video for legal reasons.',
  length: 'YouTube rejected the video because it is too long for this channel.',
  termsOfUse: "YouTube rejected the video for breaking its Terms of Use.",
  trademark: 'YouTube rejected the video for trademark reasons.',
  uploaderAccountClosed: 'YouTube rejected the video because the account is closed.',
  uploaderAccountSuspended: 'YouTube rejected the video because the account is suspended.',
};

export function failureMessage(reason: string | undefined): string {
  return (reason && FAILURE[reason]) || 'YouTube could not process this video.';
}
export function rejectionMessage(reason: string | undefined): string {
  return (reason && REJECTION[reason]) || 'YouTube rejected this video.';
}
