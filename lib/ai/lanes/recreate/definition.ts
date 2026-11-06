import type { CheckRecipe, LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
const full: CheckRecipe = { frames: 'full', fullTools: true, boundedReads: false, instructions: 'Full checks plus reference comparison: follow remaking-videos page recreation and the writing-scenes checklist. Run compareReference and compareMotion across every rebuilt section, or mark an unmeasurable window OFF with its time and reason, before finish.' };
export const definition: LaneDefinition = {
  id: 'recreate',
  description: 'Rebuild the motion and timing of a reference video.',
  skills,
  tools,
  check,
  // Always full: the lane, not the request, sets these checks.
  checks: { standard: full, final: full },
  referenceMotion: 'required',
  instructions:
    'Read remaking-videos page recreation first. Use motionMap for an overview, then trackReference at full source fps and resolution for each moving element. Pick a visible frameTime and a clean backgroundTime for calibrated opacity; sharpness is relative, never blur in pixels. Compare rendered pixels and motion across every rebuilt section before finish.',
};
