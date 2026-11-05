import type { CheckRecipe, LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
const full: CheckRecipe = { frames: 'full', fullTools: true, boundedReads: false, instructions: 'Full checks: follow scene-engine page checklist. Check each key beat with getFrames and run checkPacing through the whole film; run checkSound after adding or retiming sound effects. A film bound to a reference also needs its reference comparisons.' };
export const definition: LaneDefinition = {
  id: 'motion',
  label: 'Motion',
  description: 'Launch films and standalone motion scenes.',
  skills,
  tools,
  check,
  // Always full: the lane, not the request, sets these checks.
  checks: { standard: full, final: full },
  referenceMotion: 'bound',
  instructions:
    'Read motion-design, gsap page revline and scene-engine before building. Use readFrames and full-resolution trackReference to measure existing motion; motionMap gives a fast overview. Check original films with checkPacing. A film already bound to a reference uses reference-footage page recreation and persisted reference comparisons, including timed OFF exceptions.',
};
