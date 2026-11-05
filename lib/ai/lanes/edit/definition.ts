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
  checks: {
    standard: {
      frames: 'changes',
      fullTools: false,
      boundedReads: true,
      instructions: 'Batch changes, then use getFrames at every changed spot and one frame either side (t - 1/fps, t, t + 1/fps, clamped inside the timeline). Zero rendered checks is never completion. No whole-video sweeps, reference comparisons, motion maps, pacing or sound-sync passes, effect review plans or repeated re-checks. Reuse cached context and analysis. Read only a short source window when the edit needs it. Correct a visible defect locally and check only that correction.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: check every changed range with getFrames, including one frame either side of each change. With motion or sound support loaded, also run checkPacing or checkSound on ranges where motion, timing or sound changed. finish renders every changed range.',
    },
  },
  instructions:
    'Read footage-editing for source edits. Verify changed ranges with rendered frames. Use transcript and saved source analysis for speech decisions.',
};
