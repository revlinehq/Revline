import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'reel',
  description: 'One-take talking-head or raw footage into a coherent short-form rough cut.',
  skills,
  tools,
  check,
  checks: {
    standard: {
      frames: 'sample',
      fullTools: false,
      boundedReads: true,
      instructions: 'For plain talking-head speech cleanup, verify retained ranges, duration, linked audio and caption timing from saved data with inspectTimeline and finish. No per-speech-cut frames or compulsory listening. Sample new or changed caption styling or framing once with getFrames; inspect picture changes such as J/L joins locally. Use getSound only for an uncertain short join or an actual audio concern. Explicit visual requests and unresolved uncertainty still need targeted inspection. Effects, motion and layered compositions use getFrames at each changed spot and one frame either side. No whole-video sweeps, reference comparisons, motion maps, pacing or sound-sync passes, effect review plans or repeated re-checks.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: verify retained ranges, linked audio and caption timing from saved data, check every cut and caption change with getFrames including one frame either side, and listen with getSound where a join is uncertain. finish renders every changed range.',
    },
  },
  instructions:
    'Read reel. Use saved transcript/audio first to clean false starts, accidental repeats, awkward pauses and abandoned takes. Preserve natural delivery, intentional repeats, full meaning and clean word boundaries. Inspect targeted visuals only when needed. Let the retained message determine duration unless the user specifies it. Add minimal synchronized captions without a background by default, respecting explicit no-captions or background styling. Reuse media preparation; no mandatory normalization or heavy full-film QA.',
};
