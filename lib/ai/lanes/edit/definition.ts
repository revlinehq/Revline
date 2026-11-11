import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'edit',
  description: 'Timeline edits, trims, captions, sound and color.',
  skills,
  tools,
  check,
  checks: {
    standard: {
      frames: 'changes',
      fullTools: false,
      boundedReads: true,
      instructions: 'Batch changes, then look at the changed spots with getFrames: one call, one contact sheet (a cut edge is the frame before it and the frame after; finish names the times). Scan sparse first and zoom only where something looks wrong; never render consecutive frames to watch a clip. Zero rendered checks is never completion. No whole-video sweeps, pacing or sound-sync passes, effect review plans or repeated re-checks. Reuse cached context and analysis. Read only a short source window when the edit needs it. Correct a visible defect locally and check only that correction.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: check every changed spot with getFrames (a cut edge is the frame before it and the frame after), up to 16 times per call. With footage-editing loaded, also run checkPacing or checkSound on ranges where motion, timing or sound changed. finish renders every changed range.',
    },
  },
  instructions:
    'Read footage-editing for source edits. Verify changed ranges with rendered frames. Use transcript and saved source analysis for speech decisions.',
};
