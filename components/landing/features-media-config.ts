export type FeatureMediaKind = 'titles' | 'moments' | 'beats' | 'subject' | 'captions' | 'transitions' | 'effects';

/** Short, local media keeps the gallery independent of accounts and editing services. */
export const FEATURE_MEDIA: Record<FeatureMediaKind, { src: string; poster: string; start: number; end: number }> = {
  titles: { src: '/demo/landing/nasa.mp4', poster: '/demo/landing/nasa.webp', start: 0, end: 12 },
  moments: { src: '/demo/landing/nasa.mp4', poster: '/demo/landing/nasa-shot-2.webp', start: 0, end: 12 },
  beats: { src: '/demo/landing/nasa-beats.mp4', poster: '/demo/landing/nasa-beats.webp', start: 0, end: 6 },
  subject: { src: '/demo/landing/nasa.mp4', poster: '/demo/landing/nasa-shot-3.webp', start: 7.7, end: 12 },
  captions: { src: '/demo/hormozi-distractions.mp4', poster: '/demo/landing/captions.webp', start: 2.5, end: 9.1 },
  transitions: { src: '/demo/landing/nasa.mp4', poster: '/demo/landing/nasa-shot-2.webp', start: 3.7, end: 8.7 },
  effects: { src: '/demo/landing/nasa.mp4', poster: '/demo/landing/nasa-shot-2.webp', start: 4.2, end: 7.7 },
};

export const FEATURE_MOMENTS = [
  { label: 'The opening', start: 0, poster: '/demo/landing/nasa-shot-1.webp' },
  { label: 'Liftoff', start: 4.8, poster: '/demo/landing/nasa-shot-2.webp' },
  { label: 'The climb', start: 7.7, poster: '/demo/landing/nasa-shot-3.webp' },
] as const;
export const FEATURE_BEAT_SECONDS = .5;
