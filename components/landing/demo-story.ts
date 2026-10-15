import { NEUTRAL_MOTION } from '@/lib/editor/clip-effects';
import { DEFAULT_TEXT_APPEARANCE } from '@/lib/editor/text-style';
import type { Clip, MediaAsset, Timeline } from '@/lib/editor/types';

/** A prepared local example: no uploads, analysis or provider calls on the landing page. */
export const LANDING_DEMO_VIDEO = {
  src: '/demo/landing/nasa.mp4',
  name: 'Artemis-launch.mp4',
  poster: '/demo/landing/nasa.webp',
  duration: 12,
};
export const LANDING_DEMO_PROMPT = 'Make this launch cinematic. Find the best moments, add bold titles and a subtle push-in.';
export const LANDING_DEMO_ASSETS: MediaAsset[] = [{
  _id: 'landing-nasa-launch', kind: 'video', fileName: LANDING_DEMO_VIDEO.name,
  url: LANDING_DEMO_VIDEO.src, thumbnailUrl: LANDING_DEMO_VIDEO.poster,
  duration: LANDING_DEMO_VIDEO.duration, width: 1280, height: 720, audioExtracted: true,
}];

function footage(boundaries: number[]): Clip[] {
  return boundaries.slice(0, -1).map((start, index) => ({
    id: `landing-shot-${index}`, kind: 'video', assetId: LANDING_DEMO_ASSETS[0]._id,
    track: 1, volume: 0, audioSeparated: true, start, duration: boundaries[index + 1] - start, sourceStart: start,
  }));
}
const titles: Clip[] = [{ text: 'ARTEMIS II', start: 0, duration: 4.6 }, { text: 'LIFTOFF.', start: 4.8, duration: 2.7 }, { text: 'A NEW CHAPTER.', start: 7.7, duration: 4.1 }].map((timing, index) => ({
  id: `landing-title-${index}`, kind: 'graphic', track: 2, ...timing,
  sourceStart: 0, fontSize: 104, fontFamily: 'anton', color: '#FFFFFF', background: 'transparent',
  x: .5, y: .8, animation: 'none', textTemplate: { preset: 'slide-title' },
  textStyle: { ...DEFAULT_TEXT_APPEARANCE, shadowBlur: 8, shadowY: 3, shadowColor: '#000000A6', strokeWidth: 1 },
}));
const effect: Clip = {
  id: 'landing-launch-push', kind: 'effect', effectPreset: 'quick-zoom-in', track: 1,
  start: 4.8, duration: 2.9, sourceStart: 0,
  motion: [
    { ...NEUTRAL_MOTION, time: 0 },
    { ...NEUTRAL_MOTION, time: 1, scale: 1.035, y: .005 },
    { ...NEUTRAL_MOTION, time: 2.9 },
  ],
};
const raw = footage([0, 12]);
const firstCuts = footage([0, 4.8, 7.7, 12]);
// Source shots switch from the pad to liftoff at 4.8s, then tracking ascent at 7.7s.
const cuts = footage([0, 2.4, 4.8, 6.3, 7.7, 12]);
const timeline = (clips: Clip[]): Timeline => ({ fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 0, effects: 1 }, clips });
export const LANDING_DEMO_STAGES = [
  timeline(raw),
  timeline(firstCuts),
  timeline(cuts),
  timeline([...cuts, titles[0]]),
  timeline([...cuts, ...titles, effect]),
];
export const LANDING_DEMO_MESSAGES = [
  'I’ll build around the launch, then add clean titles and a gentle push-in.',
  'Placing the launch moments into a tighter sequence.',
  'The sequence is in place. Adding bold titles over the footage.',
  'Titles are in. Keeping the motion subtle so the launch stays the focus.',
  'Ready. Five clips, three animated titles and one subtle push-in. Here’s the edit.',
];
