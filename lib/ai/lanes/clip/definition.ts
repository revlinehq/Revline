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
      instructions: 'Cuts at source ranges you were given ("cut 50-71 s into a clip"): build each tab and call finish. It needs no findHighlights, planClips or finishClipping and no whole-source analysis; it checks each new tab’s length (15–60 s), its source footage and the first and last frames of every cut for a stray frame of a neighbouring shot. Moments Revline chose (findHighlights/planClips, /clip, "find the best moments"): finishClipping validates saved data inline: accepted candidates, populated tabs, names, source ranges and durations. Speech-led moments use transcript and voice evidence; confirm visuals with short inspectVideo windows only for action moments. checkClip QA runs only when the user asks for it. finish requires no getFrames evidence; a follow-up edit to a finished short (restyle, mute, trim) finishes on saved timeline data. No automatic normalization.',
    },
    final: {
      frames: 'data',
      fullTools: false,
      boundedReads: false,
      // Clip finish never requires rendered frames; framing QA runs only when the user asks for it.
      clipQa: ['decode-health'],
      instructions: 'Full checks for a final export, publish or double-check request. Cuts at source ranges you were given: build the tabs and call finish; no plan or analysis is needed, and finish checks length, source footage and every cut edge. Moments Revline chose (findHighlights/planClips): run checkClip on every accepted tab (decode-health is required; add framing only when the user asks for it), fix what it reports, then finishClipping and finish. No getFrames evidence and no automatic normalization.',
    },
  },
  // Policy slot only: the shared eyes can already measure these flags at each clip's first and last second, but the clip
  // lane's own detectors (cut mid-action, facecam cropped out, black or blurred frame, UI over the subject) are not built,
  // so no tool or finish check applies this yet. No gaze rules: gameplay has none.
  // The one edge check that is enforced lives outside this policy: finish reads the frames at every cut edge of a
  // range-cut clip for a stray frame of a neighbouring shot (./edges.ts).
  eyes: {
    spots: 'clip-edges',
    flags: ['no-face', 'movement'],
    frames: { firstLook: 3, extraRound: 5, broll: 0, total: 27 },
    failsFinish: 'none',
    status: 'slot',
  },
  instructions:
    'Read clipping. Two paths. Given source ranges ("cut 50-71 s into a clip"): do not call findHighlights, planClips or finishClipping; createTimeline per clip, addMedia with the range, then finish, which runs cheap checks only (length 15–60 s, source footage, the frames at every cut edge). Asked to choose the moments ("find the best moments", /clip): findHighlights returns saved transcript/helpers without whole-video Gemini, measuring missing scene cuts and audio peaks first; if it reports signalsPending, call it again shortly instead of treating the source as empty. Speech-led moments use transcript/voice; gaming/action uses targeted inspectVideo windows only where visual context matters. Silent footage uses bounded adaptive video discovery; stills/cuts alone cannot establish action. Preserve source audio/framing unless requested otherwise. No automatic normalization or heavy QA. On that path persist planClips, build accepted tabs, then finishClipping and finish directly; cheap data checks run inline. Optional checkClip checks only an explicit concern and reuses unchanged results. Disclose skipped checks and visual coverage.',
};
