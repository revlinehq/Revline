import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'edit',
  label: 'Edit',
  description: 'Timeline edits, trims, captions, sound and color.',
  skills,
  tools,
  check,
  instructions:
    'Read footage-editing for source edits. Verify changed ranges with rendered frames. Use transcript and saved source analysis for speech decisions.',
};
