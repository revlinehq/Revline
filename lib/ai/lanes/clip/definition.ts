import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'clip',
  label: 'Clip',
  description: 'Long streams and podcasts into separate shorts.',
  skills,
  tools,
  check,
  instructions:
    'Read clipping. findHighlights returns saved transcript/helpers without whole-video Gemini. Speech-led moments use transcript/voice; gaming/action uses targeted inspectVideo windows only where visual context matters. Silent footage uses bounded adaptive video discovery; stills/cuts alone cannot establish action. Preserve source audio/framing unless requested otherwise. No automatic normalization or heavy QA. Persist planClips, build accepted tabs, then finishClipping and finish directly; cheap data checks run inline. Optional checkClip checks only an explicit concern and reuses unchanged results. Disclose skipped checks and visual coverage.',
};
