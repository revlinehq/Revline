import type { CheckRecipe, LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check, warn } from './check';
const full: CheckRecipe = { frames: 'full', fullTools: true, boundedReads: false, instructions: 'Full checks: check the frames launch-films-motions "Before handing back" lists with getFrames; finish runs the timing and limit checks on the saved code. A film bound to a reference also needs its reference comparisons.' };
export const definition: LaneDefinition = {
  id: 'motion',
  description: 'Launch films and standalone motion scenes.',
  skills,
  tools,
  check,
  warn,
  // Always full: the lane, not the request, sets these checks.
  checks: { standard: full, final: full },
  referenceMotion: 'bound',
  instructions:
    'Read launch-films-motions, gsap page revline and writing-scenes before building. Use readFrames and full-resolution trackReference to measure existing motion; motionMap gives a fast overview. Set timing while writing from launch-films-motions "Timing and easing". A film already bound to a reference uses remaking-videos page recreation and persisted reference comparisons, including timed OFF exceptions.',
};
