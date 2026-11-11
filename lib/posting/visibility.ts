import type { TikTokPrivacyLevel } from './platform-limits';

// Who can view a post, per platform. Safe to import in the browser. Instagram has no per-post privacy.
export const YOUTUBE_VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type YouTubeVisibility = (typeof YOUTUBE_VISIBILITIES)[number];
export const YOUTUBE_VISIBILITY_NAMES: Record<YouTubeVisibility, string> = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };

/** TikTok's privacy levels. */
export const TIKTOK_VISIBILITIES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const satisfies readonly TikTokPrivacyLevel[];
export const TIKTOK_VISIBILITY_NAMES: Record<TikTokPrivacyLevel, string> = { PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers', SELF_ONLY: 'Only me' };

export const isYouTubeVisibility = (value: unknown): value is YouTubeVisibility => (YOUTUBE_VISIBILITIES as readonly unknown[]).includes(value);
export const isTikTokVisibility = (value: unknown): value is TikTokPrivacyLevel => (TIKTOK_VISIBILITIES as readonly unknown[]).includes(value);

/**
 * What a post can actually be given, which is what Post Bridge lets Revline set: it has no YouTube privacy (videos
 * go out public) and takes TikTok as public or private only. The one place this is stated; the server checks
 * against it and the pages word their notes from it.
 */
export const VISIBILITY_OPTIONS: { youtube: readonly YouTubeVisibility[]; tiktok: readonly TikTokPrivacyLevel[] } = { youtube: ['public'], tiktok: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] };
/** "YouTube videos are posted as Public." */
export const YOUTUBE_VISIBILITY_NOTE = `YouTube videos are posted as ${VISIBILITY_OPTIONS.youtube.map(value => YOUTUBE_VISIBILITY_NAMES[value]).join(' or ')}.`;
