import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'reel',
  label: 'Reel',
  description: 'One-take talking-head or raw footage into a coherent short-form rough cut.',
  skills,
  tools,
  check,
  instructions:
    'Read reel. Use saved transcript/audio first to clean false starts, accidental repeats, awkward pauses and abandoned takes. Preserve natural delivery, intentional repeats, full meaning and clean word boundaries. Inspect targeted visuals only when needed. Let the retained message determine duration unless the user specifies it. Add minimal synchronized captions without a background by default, respecting explicit no-captions or background styling. Reuse media preparation; no mandatory normalization or heavy full-film QA.',
};
