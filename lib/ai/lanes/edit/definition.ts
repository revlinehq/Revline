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
      instructions: 'Batch changes, then call finish. finish draws a few frames spread over the changed spots itself and returns them with its result: look at them, and use getFrames only for a spot that looks wrong or needs a closer look. Never fetch a frame per change. Gaps, overlaps, lengths and timing are checked from timeline data, not frames. No whole-video sweeps, pacing or sound-sync passes, effect review plans or repeated re-checks. Reuse cached context and analysis. Read only a short source window when the edit needs it. Correct a visible defect locally and check only that correction.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: call finish, which checks the timeline data and draws up to 8 frames of what changed (new cuts first, then overlays, one caption sample) and returns them; look at them, and use getFrames only for a spot that looks wrong. Captions are verified from timeline data, never from frames. With footage-editing loaded, also run checkPacing or checkSound on ranges where motion, timing or sound changed.',
    },
  },
  instructions:
    `Read footage-editing for source edits. ${SPEECH_EDIT_ORDER_SHORT} finish checks timeline data and draws the few frames it needs itself; never fetch a frame per change or per caption. Use transcript and saved source analysis for speech decisions.`,
};
