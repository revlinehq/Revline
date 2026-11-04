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
    'Read clipping and call findHighlights once. Gemini is the default judge; when unavailable, stop Gemini for the run and review transcript/audio/cuts with targeted source frames, then register grounded found moments in planClips. Create one nonempty vertical tab per accepted highlight. Batch checkClip; finishClipping and lane finish must both pass the persisted ledger before reporting the exact tab list.',
};
