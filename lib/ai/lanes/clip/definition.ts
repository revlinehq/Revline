import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'clip',
  description: 'Long streams and podcasts into separate shorts.',
  skills,
  tools,
  check,
  checks: {
    standard: {
      frames: 'data',
      fullTools: false,
      boundedReads: false,
      instructions: 'finishClipping validates saved data inline: accepted candidates, populated tabs, names, source ranges and durations. Speech-led moments use transcript and voice evidence; confirm visuals with short inspectVideo windows only for action moments. checkClip QA runs only when the user asks for it. No automatic normalization.',
    },
    final: {
      frames: 'data',
      fullTools: false,
      boundedReads: false,
      clipQa: ['decode-health', 'framing'],
      instructions: 'Full checks for a final export, publish or double-check request: run checkClip on every accepted tab (framing and decode-health are required), fix what it reports, then finishClipping and finish. No automatic normalization.',
    },
  },
  instructions:
    'Read clipping. findHighlights returns saved transcript/helpers without whole-video Gemini, measuring missing scene cuts and audio peaks first; if it reports signalsPending, call it again shortly instead of treating the source as empty. Speech-led moments use transcript/voice; gaming/action uses targeted inspectVideo windows only where visual context matters. Silent footage uses bounded adaptive video discovery; stills/cuts alone cannot establish action. Preserve source audio/framing unless requested otherwise. No automatic normalization or heavy QA. Persist planClips, build accepted tabs, then finishClipping and finish directly; cheap data checks run inline. Optional checkClip checks only an explicit concern and reuses unchanged results. Disclose skipped checks and visual coverage.',
};
