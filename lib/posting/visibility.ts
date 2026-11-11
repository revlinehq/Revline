import type { TikTokPrivacyLevel } from './platforms/tiktok/settings';

// Who can view a post, per platform. Safe to import in the browser. Instagram has no per-post privacy.
export const YOUTUBE_VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type YouTubeVisibility = (typeof YOUTUBE_VISIBILITIES)[number];
export const YOUTUBE_VISIBILITY_NAMES: Record<YouTubeVisibility, string> = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };
/** What a YouTube post uses until the user has chosen once; after that, their last choice. */
export const YOUTUBE_FIRST_VISIBILITY: YouTubeVisibility = 'public';

/** TikTok's privacy levels. Which of them one account may use comes from its creator info. */
export const TIKTOK_VISIBILITIES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const satisfies readonly TikTokPrivacyLevel[];
export const TIKTOK_VISIBILITY_NAMES: Record<TikTokPrivacyLevel, string> = { PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers', SELF_ONLY: 'Only me' };

export const isYouTubeVisibility = (value: unknown): value is YouTubeVisibility => (YOUTUBE_VISIBILITIES as readonly unknown[]).includes(value);
export const isTikTokVisibility = (value: unknown): value is TikTokPrivacyLevel => (TIKTOK_VISIBILITIES as readonly unknown[]).includes(value);
