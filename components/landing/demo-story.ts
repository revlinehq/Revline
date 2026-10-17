import { NEUTRAL_MOTION } from '@/lib/editor/clip-effects';
import { DEFAULT_TEXT_APPEARANCE } from '@/lib/editor/text-style';
import type { Clip, MediaAsset, Timeline } from '@/lib/editor/types';

/** A prepared local example: no uploads, analysis or provider calls on the landing page. */
export const LANDING_DEMO_VIDEO = {
  src: '/demo/racing/landing.mp4',
  name: 'Race-day.mp4',
  poster: '/demo/racing/01-pit-entry.jpg',
  duration: 13.2,
};
export const LANDING_DEMO_PROMPT = 'Make a race-day edit. Cut between the pit stops and track, add bold titles and a subtle push-in.';
export const LANDING_DEMO_ASSETS: MediaAsset[] = [{
  _id: 'landing-race-day', kind: 'video', fileName: LANDING_DEMO_VIDEO.name,
  url: LANDING_DEMO_VIDEO.src, thumbnailUrl: LANDING_DEMO_VIDEO.poster,
  duration: LANDING_DEMO_VIDEO.duration, width: 1280, height: 720, audioExtracted: true,
}];

function footage(boundaries: number[]): Clip[] {
  return boundaries.slice(0, -1).map((start, index) => ({
    id: `landing-shot-${index}`, kind: 'video', assetId: LANDING_DEMO_ASSETS[0]._id,
    track: 1, volume: 0, audioSeparated: true, start, duration: boundaries[index + 1] - start, sourceStart: start,
  }));
}
const titles: Clip[] = [{ text: 'RACE DAY', start: 0, duration: 2 }, { text: 'EVERY SECOND', start: 4.4, duration: 1.8 }, { text: 'COUNTS', start: 10.2, duration: 3 }].map((timing, index) => ({
  id: `landing-title-${index}`, kind: 'graphic', track: 2, ...timing,
  sourceStart: 0, fontSize: 104, fontFamily: 'anton', color: '#FFFFFF', background: 'transparent',
  x: .5, y: .8, animation: 'none', textTemplate: { preset: 'slide-title' },
  textStyle: { ...DEFAULT_TEXT_APPEARANCE, shadowBlur: 8, shadowY: 3, shadowColor: '#000000A6', strokeWidth: 1 },
}));
const effect: Clip = {
  id: 'landing-wheel-push', kind: 'effect', effectPreset: 'quick-zoom-in', track: 1,
  start: 4.4, duration: 1.8, sourceStart: 0,
  motion: [
    { ...NEUTRAL_MOTION, time: 0 },
    { ...NEUTRAL_MOTION, time: .9, scale: 1.035, x: .0063, y: -.0042 },
    { ...NEUTRAL_MOTION, time: 1.8 },
  ],
};
const raw = footage([0, 13.2]);
// Match the six prepared source shots, including both wheel-change close-ups.
const cuts = footage([0, 2, 4.4, 6.2, 8.6, 10.2, 13.2]);
const timeline = (clips: Clip[]): Timeline => ({ fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 0, effects: 1 }, clips });
// Each split lands at the playhead before the next cut is revealed.
export const LANDING_DEMO_STEPS = [
  { timeline: timeline(raw), at: 4.4, message: 0 },
  { timeline: timeline(footage([0, 4.4, 13.2])), at: 4.4, message: 1 },
  { timeline: timeline(footage([0, 4.4, 10.2, 13.2])), at: 10.2, message: 1 },
  { timeline: timeline(footage([0, 2, 4.4, 10.2, 13.2])), at: 2, message: 1 },
  { timeline: timeline(footage([0, 2, 4.4, 6.2, 10.2, 13.2])), at: 6.2, message: 1 },
  { timeline: timeline(cuts), at: 8.6, message: 1 },
  { timeline: timeline([...cuts, titles[0]]), at: .8, message: 2 },
  { timeline: timeline([...cuts, ...titles, effect]), at: 5.3, message: 3 },
];
export const LANDING_DEMO_MESSAGES = [
  'I’ll cut between the pit stops and track, then add titles and a gentle push-in.',
  'Placing the racing shots into a tighter sequence.',
  'The sequence is in place. Adding bold titles over the footage.',
  'Titles are in. Adding a subtle push-in on the wheel change.',
  'Ready. Six clips, three animated titles and one subtle push-in. Here’s the edit.',
];
