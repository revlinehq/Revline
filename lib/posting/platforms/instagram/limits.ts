// Documented limits for Reels published through the Instagram API, checked before any call is made.
// Source: "Reel Specifications" and the `caption` parameter in
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
import { PostingError, type PublishInput } from '../../adapter';

export const REEL_LIMITS = {
  minSeconds: 3,
  maxSeconds: 15 * 60,
  maxBytes: 300 * 1024 * 1024,
  maxWidth: 1920,
  minAspect: 0.01,
  maxAspect: 10,
  maxCaptionChars: 2200,
  maxHashtags: 30,
  maxMentions: 20,
} as const;

const reject = (message: string, code: string) => new PostingError(message, false, code);

/** Throws a non-retryable PostingError when Instagram would refuse this video or caption. */
export function assertPostable(input: PublishInput): void {
  let url: URL | null = null;
  try {
    url = new URL(input.videoUrl);
  } catch {
    url = null;
  }
  const host = (url?.hostname ?? '').toLowerCase();
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  const isPrivateAddress = octets
    ? octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    : host.startsWith('['); // IPv6 literals are loopback or private in practice; a public file has a host name.
  const isPrivateHost = isPrivateAddress || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost');
  if (!url || !/^https?:$/.test(url.protocol) || isPrivateHost) {
    throw reject('Instagram downloads the video itself, so it needs a public web address for the file.', 'video_url_not_public');
  }
  if (!(input.durationSeconds >= REEL_LIMITS.minSeconds)) {
    throw reject(`Instagram Reels must be at least ${REEL_LIMITS.minSeconds} seconds long.`, 'video_too_short');
  }
  if (input.durationSeconds > REEL_LIMITS.maxSeconds) {
    throw reject('Instagram Reels can be at most 15 minutes long.', 'video_too_long');
  }
  if (!(input.videoBytes > 0)) {
    throw reject('The video file is empty.', 'video_empty');
  }
  if (input.videoBytes > REEL_LIMITS.maxBytes) {
    throw reject('Instagram Reels can be at most 300 MB. Export at a lower quality and try again.', 'video_too_large');
  }
  if (!(input.width > 0) || !(input.height > 0)) {
    throw reject('The video has no readable width and height.', 'video_size_unknown');
  }
  if (input.width > REEL_LIMITS.maxWidth) {
    throw reject(`Instagram Reels can be at most ${REEL_LIMITS.maxWidth} pixels wide. Export at 1080p and try again.`, 'video_too_wide');
  }
  const aspect = input.width / input.height;
  if (aspect < REEL_LIMITS.minAspect || aspect > REEL_LIMITS.maxAspect) {
    throw reject('Instagram does not accept this video shape. Use 9:16 for Reels.', 'video_aspect_unsupported');
  }
  // Counted in characters, not UTF-16 units, so emoji do not count double.
  if ([...input.caption].length > REEL_LIMITS.maxCaptionChars) {
    throw reject(`Instagram captions can be at most ${REEL_LIMITS.maxCaptionChars} characters.`, 'caption_too_long');
  }
  if ((input.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > REEL_LIMITS.maxHashtags) {
    throw reject(`Instagram captions can have at most ${REEL_LIMITS.maxHashtags} hashtags.`, 'caption_too_many_hashtags');
  }
  if ((input.caption.match(/(^|[^\w@])@[\w.]+/g) ?? []).length > REEL_LIMITS.maxMentions) {
    throw reject(`Instagram captions can mention at most ${REEL_LIMITS.maxMentions} accounts.`, 'caption_too_many_mentions');
  }
}
