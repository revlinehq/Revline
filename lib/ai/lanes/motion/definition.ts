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
  instructions:
    'Read motion-design, gsap page revline and scene-engine before building. Check the finished motion with checkPacing.',
};
