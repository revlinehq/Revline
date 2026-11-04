import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'explainer',
  label: 'Explainer',
  description: 'Scripted, narrated explainer films.',
  skills,
  tools,
  check,
  instructions:
    'Read explainer and explainer-scenes. Confirm the script and voice, then build around the measured narration word times.',
};
