import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'recreate',
  label: 'Recreate',
  description: 'Rebuild the motion and timing of a reference video.',
  skills,
  tools,
  check,
  referenceMotion: 'required',
  instructions:
    'Read reference-footage page recreation first. Use motionMap for an overview, then trackReference at full source fps and resolution for each moving element. Pick a visible frameTime and a clean backgroundTime for calibrated opacity; sharpness is relative, never blur in pixels. Compare rendered pixels and motion across every rebuilt section before finish.',
};
