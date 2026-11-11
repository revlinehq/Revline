// What a platform would refuse about a clip or its text, known before anything is exported or sent. Each rule is
// the platform's own documented limit (lib/posting/platforms/<platform>); the adapters check the same limits again
// at publish time, with the file in hand. Safe to import in the browser.
import type { PostingPlatform } from './adapter';
import { PLATFORM_NAMES } from './platform-names';
import { REEL_LIMITS } from './platforms/instagram/limits';
import { VIDEO_LIMITS } from './platforms/tiktok/settings';
import { DESCRIPTION_MAX_BYTES, TITLE_MAX_CHARS, titleFromCaption } from './platforms/youtube/metadata';

export type PostShape = { durationSeconds: number; width: number; height: number };
export type PostText = { caption: string; title?: string };

/** Why this platform cannot take a clip of this length and size, or an empty list. File size is only known after the export. */
export function shapeProblems(platform: PostingPlatform, { durationSeconds, width, height }: PostShape): string[] {
  const problems: string[] = [], name = PLATFORM_NAMES[platform], seconds = Math.round(durationSeconds * 10) / 10;
  if (!(durationSeconds > 0)) return ['The clip is empty.'];
  if (platform === 'instagram') {
    if (durationSeconds < REEL_LIMITS.minSeconds) problems.push(`${name} Reels must be at least ${REEL_LIMITS.minSeconds} seconds long; this clip is ${seconds} seconds.`);
    if (durationSeconds > REEL_LIMITS.maxSeconds) problems.push(`${name} Reels can be at most ${REEL_LIMITS.maxSeconds / 60} minutes long.`);
    if (width > REEL_LIMITS.maxWidth) problems.push(`${name} Reels can be at most ${REEL_LIMITS.maxWidth} pixels wide; this clip exports at ${width}×${height}.`);
  }
  if (platform === 'tiktok') {
    if (durationSeconds > VIDEO_LIMITS.maxDurationSeconds) problems.push(`${name} takes videos up to ${VIDEO_LIMITS.maxDurationSeconds / 60} minutes through apps; this clip is ${seconds} seconds.`);
    if ([width, height].some(side => side < VIDEO_LIMITS.minSidePx || side > VIDEO_LIMITS.maxSidePx)) problems.push(`${name} needs a width and height between ${VIDEO_LIMITS.minSidePx} and ${VIDEO_LIMITS.maxSidePx} pixels; this clip exports at ${width}×${height}.`);
  }
  return problems;
}

/** Why this platform cannot take this caption and title, or an empty list. */
export function textProblems(platform: PostingPlatform, { caption, title }: PostText): string[] {
  const problems: string[] = [], name = PLATFORM_NAMES[platform];
  if (platform === 'instagram') {
    if ([...caption].length > REEL_LIMITS.maxCaptionChars) problems.push(`${name} captions can be at most ${REEL_LIMITS.maxCaptionChars} characters.`);
    if ((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > REEL_LIMITS.maxHashtags) problems.push(`${name} captions can have at most ${REEL_LIMITS.maxHashtags} hashtags.`);
    if ((caption.match(/(^|[^\w@])@[\w.]+/g) ?? []).length > REEL_LIMITS.maxMentions) problems.push(`${name} captions can mention at most ${REEL_LIMITS.maxMentions} accounts.`);
  }
  if (platform === 'tiktok' && caption.length > VIDEO_LIMITS.maxCaptionLength) problems.push(`${name} captions can be at most ${VIDEO_LIMITS.maxCaptionLength} characters; this one is ${caption.length}.`);
  if (platform === 'youtube') {
    const given = title?.replace(/\s+/g, ' ').trim();
    if (!(given || titleFromCaption(caption))) problems.push(`${name} needs a title. Add a title or a caption.`);
    if (given && given.length > TITLE_MAX_CHARS) problems.push(`${name} titles can be at most ${TITLE_MAX_CHARS} characters; this one is ${given.length}.`);
    const bytes = new TextEncoder().encode(caption).length;
    if (bytes > DESCRIPTION_MAX_BYTES) problems.push(`The caption is too long for a ${name} description (${bytes} bytes; ${name} allows ${DESCRIPTION_MAX_BYTES}).`);
  }
  return problems;
}
