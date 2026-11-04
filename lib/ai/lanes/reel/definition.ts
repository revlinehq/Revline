import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'reel',
  label: 'Reel',
  description: 'Talking head or raw footage into a 30–60 second reel.',
  skills,
  tools,
  check,
  instructions:
    'Read reel. Use source transcript and audio activity for takes and dead air. Finish a 30–60 second vertical edit with synced captions and a measured, normalized mix.',
};
