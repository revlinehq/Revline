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
    'Read reference-footage page recreation first. Measure at full source fps and resolution. Compare rendered pixels and motion across every rebuilt section before finish.',
};
