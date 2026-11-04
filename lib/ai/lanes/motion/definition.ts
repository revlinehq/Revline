import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'motion',
  label: 'Motion',
  description: 'Launch films and standalone motion scenes.',
  skills,
  tools,
  check,
  referenceMotion: 'bound',
  instructions:
    'Read motion-design, gsap page revline and scene-engine before building. Check original films with checkPacing. A film already bound to a reference uses reference-footage page recreation and persisted reference comparisons, including timed OFF exceptions.',
};
