import type { EditorSkill } from './index';

export const visualInspection: EditorSkill = {
  name: 'visual-inspection',
  description: 'Removing awkward moments from normal footage (talking heads, vlogs, podcasts): dead air, a frozen face, looking away or at a script, reaching for the camera, fidgeting, jumps and flashes. Find them with the transcript and readFrames moments, confirm each at 10 fps with your own eyes, cut with the speech tools. Read before any visually motivated cut. To recreate a reference or measure motion, see reference-footage instead.',
  body: `# Awkward moments in footage

For "remove the awkward moments", "cut where I look away", "clean up the dead air", script glances, camera fiddling, or any cut the picture motivates. You see the footage yourself with readFrames: no guessing from the transcript, no Gemini needed.

## 1. Find candidates (cheap)
Do both, then merge them into one list of SOURCE windows:
- Transcript: inspectAssetAnalysis (analyzeMedia transcribe first if there is none). Note pauses over about 0.7 s, false starts and restarts, "um/uh/so/like" before a restart, and the words around each gap.
- Picture: one readFrames momentsOnly:true over the whole clip (0 to its source duration). No image comes back, only the map:
  - holds: a second or more where the picture all but stops. During silence that is dead air or a frozen face; during speech it is usually just a calm speaker, so leave it.
  - small motion moments in the face or hand region (compare region to where the face is): looking away, at notes, down at the phone, fidgeting, hair or face touching, reaching for the camera.
  - big motion moments that cover most of the frame: standing up, walking out of frame, picking up or moving the camera.
  - cut moments: jumps from an earlier rough cut, flashes, frame drops.
  A moment while the speaker is mid-sentence and calm is ordinary talking: skip it. Strongest candidates: moments that sit in or next to a transcript pause, at the very start (before the first word) and the very end (after the last word).
For a clip under about 20 s you may instead read count 16 over the whole clip; it returns the moments too, plus a picture.

## 2. Confirm each candidate frame by frame
For every candidate, readFrames fps 10 over it, starting about 0.5 s before and ending about 0.5 s after (up to 3 s per read; split a longer one). Look at the grid yourself and decide:
- Awkward: eyes leave the lens and come back, the face freezes or goes blank, a hand comes up to the camera or face, the head drops to read, the camera shakes or is being set up, a flash or jump. Note the exact frame it starts and the frame the speaker is back (label times in the grid).
- Not awkward: a natural blink, a nod, a gesture while talking, a short glance mid-word. Keep it.
Several candidates close together can share one read. Never cut on the map alone; it says where the picture moves, not why.

## 3. Cut, keeping the speech whole
- Each cut runs from the frame the awkward thing starts to the frame the speaker is back, widened to the nearest word boundaries (word timings from inspectAssetAnalysis with start/end). Never cut inside a word. If the awkward moment happens while the speaker is talking, cut the whole sentence or phrase, or leave it and say so: do not cut words out of a sentence to hide a glance.
- Apply all cuts at once on the clip: cleanSpeech with keep (the SOURCE ranges between your cuts), or retainSourceRanges with tightenSilence:true. Both also remove pauses and fillers inside the kept ranges, so the transcript-only candidates are handled in the same call. Close gaps if several clips are left.
- Check: inspectTimeline for the new length, then getFrames at 2 to 4 of the new cut points to see the join reads (no frozen face, no half glance on either side).
- Tell the user what you removed, by time and what it was ("0:12 looked down at notes, 0:31 reached for the camera, 4.2 s of dead air at the start"), and what you looked at and kept.

## Long clips
momentsOnly reads the whole length cheaply, however long. Confirm only the candidates; do not page through a long clip at 10 fps. Use inspectVideo only when the user asks for something you must hear (laughing, a cough, a phone ringing) or search by meaning across a long clip; inspectFrames is for older flows and is not needed when readFrames can show the frames.

## Rules
- Only cut what the user asked about. "Clean it up" with no visual words is a speech cleanup (cleanSpeech), not this skill.
- A quiet pause alone is not an awkward moment, and a moment alone is not one either: confirm with frames.
- If frames leave it unclear, keep the footage and say what you were unsure of. Never claim a moment was removed that you did not see.
`,
};
