import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'reel',
  description: 'One talking-head take or rough cut into a reel or short: "edit my rough for a reel", "make this a reel", "clean my rough cut". Reads the take as a script first.',
  skills,
  tools,
  check,
  checks: {
    standard: {
      frames: 'sample',
      fullTools: false,
      boundedReads: true,
      instructions: 'For plain talking-head speech cleanup, finish checks the cut against the saved script plan (opening line, closing line, whole sentences, requested length); verify retained ranges, duration, linked audio and caption timing from saved data with inspectTimeline and finish. No per-speech-cut frames or compulsory listening. Sample new or changed caption styling or framing once with getFrames; inspect picture changes such as J/L joins locally. Use getSound only for an uncertain short join or an actual audio concern. Explicit visual requests and unresolved uncertainty still need targeted inspection. Effects, motion and layered compositions use getFrames at each changed spot and one frame either side. No whole-video sweeps, reference comparisons, motion maps, pacing or sound-sync passes, effect review plans or repeated re-checks.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: verify retained ranges, linked audio and caption timing from saved data, check every cut and caption change with getFrames including one frame either side, and listen with getSound where a join is uncertain. finish renders every changed range.',
    },
  },
  instructions:
    'Read reel. The request means: keep the whole intended script in order, remove mistakes and dead air, tighten, add captions, vertical 9:16. Never reorder or drop content unless the user asked or a stated length needs it. Order of work: 1) readScript on the take: every line, the opening line (after setup talk and restarted attempts; the last complete take of it), the closing line (before "cut" and trailing talk), repeated takes. 2) planScript: what the piece is about and its beats (hook, points, tangents, payoff, call to action) with priorities; tell the user in one line what you will keep. 3) One cut with the ranges planScript returns (retainSourceRanges, tightenSilence:true). 4) Captions. 5) finish. Never cut before planScript. Never start after the opening line or stop before the closing line unless the user asked. For a stated length drop whole lower-priority beats, tangents and redundant takes; never the opening, the payoff or part of a sentence. Without a stated length the script sets the duration. Ask with askUser only when readScript reports two different complete openings. Preserve natural delivery and intentional repeats. Add minimal synchronized captions without a background by default, respecting explicit no-captions or background styling. Reuse media preparation; no mandatory normalization or heavy full-film QA.',
};
