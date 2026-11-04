import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'clip',
  label: 'Clip',
  description: 'Long streams and podcasts into separate shorts.',
  skills,
  tools,
  check,
  instructions:
    'Read clipping and call findHighlights once. Podcast/talk defaults to transcript-first: pass sourceType, select grounded spoken hooks/payoffs from saved words, register planClips found, preserve source framing/aspect and audio. No Gemini, source frames, speaker tracking, normalization or rendered checks unless requested. Gaming/action and explicit visual requests use the visual path (visualReview:true for podcast/talk) with targeted evidence. Build each accepted tab, batch checkClip, then finishClipping and finish; both use the persisted mode and ledger. Never claim skipped visual checks passed.',
};
