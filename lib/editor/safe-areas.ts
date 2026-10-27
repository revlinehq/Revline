/** Where platform UI covers a 9:16 video, as fractions of the frame. Instagram follows Meta's Reels ad
 * spec (14% top, 35% bottom, 6% sides; the action buttons fill the right 21% from 60% down). TikTok
 * follows its in-feed safe-zone template on 1080×1920 (240px top, 660px bottom, 120px sides; a 180px
 * button column from 840px down). Organic layouts are close but vary by device and app version. */
export type SafeAreaPlatform = 'instagram' | 'tiktok';
export type SafeArea = { label: string; top: number; bottom: number; left: number; right: number; actions: { width: number; top: number } };

export const SAFE_AREAS: Record<SafeAreaPlatform, SafeArea> = {
  instagram: { label: 'Instagram Reels', top: .14, bottom: .35, left: .06, right: .06, actions: { width: .21, top: .6 } },
  tiktok: { label: 'TikTok', top: 240 / 1920, bottom: 660 / 1920, left: 120 / 1080, right: 120 / 1080, actions: { width: 180 / 1080, top: 840 / 1920 } },
};
