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
      instructions: 'For plain talking-head speech cleanup, finish checks the cut against the saved script plan (opening line, closing line, whole sentences, requested length); verify retained ranges, duration, linked audio and caption timing from saved data with inspectTimeline and finish. finish renders no frames; captions (words, timing, overlap, reading speed, line length, position, style) are verified from timeline data. The user reviews the result: no frame reads, checkSpots or listening to verify an edit. checkSpots, getFrames and getSound run only for a concern the user named. No whole-video sweeps, reference comparisons, motion maps, pacing or sound-sync passes, effect review plans or repeated re-checks.',
    },
    final: {
      frames: 'changes',
      fullTools: true,
      boundedReads: false,
      instructions: 'Final export, publish or double-check request: verify retained ranges, linked audio and caption timing from saved data with inspectTimeline and finish, which renders no frames. getSound, getFrames and checkSpots run only for a concern the user named.',
    },
  },
  // Speech edges and the first and last frame are measured locally; only flagged spots cost frames.
  eyes: {
    spots: 'speech-edges',
    flags: ['no-face', 'head-away', 'eyes-down', 'eyes-off-camera', 'blink', 'reach', 'movement'],
    frames: { firstLook: 3, extraRound: 5, broll: 6, total: 27 },
    // finish never waits on looks: checkSpots runs only when the user asks about cut edges.
    failsFinish: 'none',
    status: 'enforced',
  },
  instructions:
    'Read reel. The request means: keep the whole intended script in order, remove mistakes and dead air, tighten, add captions, vertical 9:16. Never reorder or drop content unless the user asked or a stated length needs it. Order of work: 1) readScript on the take: every line, the opening line (after setup talk and restarted attempts; the last complete take of it), the closing line (before "cut" and trailing talk), repeated takes. 2) planScript: what the piece is about and its beats (hook, points, tangents, payoff, call to action) with priorities; tell the user in one line what you will keep. 3) One cut with the ranges planScript returns (retainSourceRanges, tightenSilence:true). No frame reads before it. Then readCutScript: fix the repeats, clipped words and half sentences it flags. 4) An opening clip, b-roll or images the user asked for go on now, at transcript times. 5) Captions. 6) finish, then reply: the user reviews the result, so no frame checks. Never cut before planScript. Never start after the opening line or stop before the closing line unless the user asked. For a stated length drop whole lower-priority beats, tangents and redundant takes; never the opening, the payoff or part of a sentence. Without a stated length the script sets the duration. Ask with askUser only when readScript reports two different complete openings. B-roll (shots readScript lists with no speaker in frame) is footage, not silence: keep it where the user placed it; use other footage as cutaways over the matching line, talking audio kept, only when the user asks. Preserve natural delivery and intentional repeats. Add minimal synchronized captions without a background by default, respecting explicit no-captions or background styling. Reuse media preparation; no mandatory normalization or heavy full-film QA.',
};
