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
    'Read clipping. Discover moments from transcript, audio energy, scene cuts and clipping signals. Create one nonempty vertical tab per accepted highlight. findHighlights/checkClip are registration points for the find-highlights branch.',
};
