// What each platform takes, from its own documentation: checked before a clip is exported or sent
// (lib/posting/precheck.ts). Post Bridge's reference states no video limits of its own. Safe to import in the browser.

/** Instagram Reels. https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media */
export const REEL_LIMITS = { minSeconds: 3, maxSeconds: 15 * 60, maxBytes: 300 * 1024 * 1024, maxWidth: 1920, maxCaptionChars: 2200, maxHashtags: 30, maxMentions: 20 } as const;

/** TikTok videos posted through an app. https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide */
export const VIDEO_LIMITS = {
  maxBytes: 4 * 1024 ** 3, minSidePx: 360, maxSidePx: 4096, maxDurationSeconds: 600,
  /** Caption length, counted in UTF-16 units as TikTok does. */
  maxCaptionLength: 2200,
} as const;
export type TikTokPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
/** The per-post choices TikTok requires the user to make themselves. Absent means off; without a privacy level the post is "Only me". */
export type TikTokPostSettings = { privacyLevel?: TikTokPrivacyLevel; allowComment?: boolean; allowDuet?: boolean; allowStitch?: boolean; yourBrand?: boolean; brandedContent?: boolean };

/** YouTube's video resource. https://developers.google.com/youtube/v3/docs/videos#snippet */
export const TITLE_MAX_CHARS = 100;
export const DESCRIPTION_MAX_BYTES = 5000;

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, /[\uD800-\uDBFF]/.test(text[max - 1]) ? max - 1 : max);
}
/** A YouTube title from the caption: its first line, shortened at a word boundary. */
export function titleFromCaption(caption: string): string {
  const line = caption.split(/\r?\n/).map(part => part.replace(/\s+/g, ' ').trim()).find(part => part.length > 0) ?? '';
  if (line.length <= TITLE_MAX_CHARS) return line;
  const head = cut(line, TITLE_MAX_CHARS - 1), space = head.lastIndexOf(' ');
  return `${(space > TITLE_MAX_CHARS / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}
