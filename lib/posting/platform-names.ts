import type { PostingPlatform } from './adapter';

/** Every platform Revline can post to, in the order pages list them. Safe to import in the browser. */
export const POSTING_PLATFORMS: readonly PostingPlatform[] = ['tiktok', 'instagram', 'youtube'];
export const PLATFORM_NAMES: Record<PostingPlatform, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };
