import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
import { SPEECH_EDIT_ORDER_SHORT } from '../../editor-style';
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
      instructions: 'Batch changes, then render with getFrames exactly the pendingFrameTimes that tool results list: changed picture edges and one frame either side, one frame for newly added media, none for sound, footage that only moved or a speech cut on plain footage. A listed time left unrendered is never completion. No whole-video sweeps, pacing or sound-sync passes, effect review plans or repeated re-checks. Reuse cached context and analysis. Read only a short source window when the edit needs it. Correct a visible defect locally and check only that correction.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: check every changed range with getFrames, including one frame either side of each change. With footage-editing loaded, also run checkPacing or checkSound on ranges where motion, timing or sound changed. finish renders every changed range.',
    },
  },
  instructions:
    `Read footage-editing for source edits. ${SPEECH_EDIT_ORDER_SHORT} Use transcript and saved source analysis for speech decisions. Verify changed ranges with rendered frames after the edits.`,
};
