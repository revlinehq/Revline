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
      instructions: 'Batch changes, then call finish once. finish checks gaps, overlaps, lengths and timing from timeline data and renders no frames; once it passes, reply. The user reviews the result: never fetch frames to verify an edit. No whole-video sweeps, pacing or sound-sync passes, effect review plans or repeated re-checks. Reuse cached context and analysis. Read only a short source window when the edit needs it. Correct a visible defect locally and check only that correction.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Final export, publish or double-check request: call finish, which checks the timeline data (captions included) and renders no frames. Run checkPacing, checkSound or getFrames only for a concern the user named.',
    },
  },
  instructions:
    `Read footage-editing for source edits. ${SPEECH_EDIT_ORDER_SHORT} finish checks timeline data only; never fetch frames to verify an edit, the user reviews it. Use transcript and saved source analysis for speech decisions.`,
};
