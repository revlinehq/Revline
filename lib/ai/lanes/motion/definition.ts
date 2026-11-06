import type { CheckRecipe, LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
const full: CheckRecipe = { frames: 'full', fullTools: true, boundedReads: false, instructions: 'Full checks: follow scene-engine page checklist. Check each key beat with getFrames. A film bound to a reference also needs its reference comparisons.' };
export const definition: LaneDefinition = {
  id: 'motion',
  description: 'Launch films and standalone motion scenes.',
  skills,
  tools,
  check,
  // Always full: the lane, not the request, sets these checks.
  checks: { standard: full, final: full },
  referenceMotion: 'bound',
  instructions:
    'Read launch-films-motions, gsap page revline and scene-engine before building. Use readFrames and full-resolution trackReference to measure existing motion; motionMap gives a fast overview. Set timing while writing from launch-films-motions "Timing and easing". A film already bound to a reference uses reference-footage page recreation and persisted reference comparisons, including timed OFF exceptions.',
};
