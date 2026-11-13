export type SafeAreaPlatform = 'instagram' | 'tiktok';

/** A rectangle on the 1080×1920 frame, in pixels from the top left. */
export type SafeAreaRect = { x: number; y: number; w: number; h: number };
export type SafeArea = { top: SafeAreaRect; buttons: SafeAreaRect; bottom: SafeAreaRect };

/** Where each app's interface covers a 1080×1920 video, from the safe-area design. Approximate positions
 * from the apps' standard layouts; they vary a little by device and app version. */
export const SAFE_AREAS: Record<SafeAreaPlatform, SafeArea> = {
  instagram: {
    top: { x: 0, y: 0, w: 1080, h: 230 },
    buttons: { x: 960, y: 1100, w: 120, h: 420 },
    bottom: { x: 0, y: 1520, w: 1080, h: 400 },
  },
  tiktok: {
    top: { x: 0, y: 0, w: 1080, h: 240 },
    buttons: { x: 930, y: 930, w: 150, h: 570 },
    bottom: { x: 0, y: 1500, w: 1080, h: 420 },
  },
};
