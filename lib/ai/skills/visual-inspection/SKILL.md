---
name: "visual-inspection"
description: "Finds and removes awkward moments the picture shows from normal footage (talking heads, vlogs, podcasts): dead air, a frozen face, looking away or at a script, reaching for the camera, fidgeting, jumps and flashes. Read before any visually motivated cut."
---
# Awkward moments in footage

A good result removes only the moments the user named, each one confirmed in frames, with every cut on word boundaries so the speech stays whole. The reply says what was removed, by time, and what was looked at and kept.

This covers "remove the awkward moments", "cut where I look away", "clean up the dead air", script glances, camera fiddling, or any cut the picture motivates. The agent looks at the footage itself with readFrames: no guessing from the transcript, no Gemini needed.

## Workflow
1. Find candidates and merge them into one list of SOURCE windows (see Find candidates).
2. Confirm each candidate frame by frame (see Confirm).
3. Apply all cuts at once on the clip: cleanSpeech with keep (the SOURCE ranges between the cuts), or retainSourceRanges with tightenSilence:true. The transcript-only candidates (pauses, fillers) are handled in the same call. Close gaps if several clips are left.
4. Verify with the checks footage-editing page `edit-lanes` sets for the lane. In the reel lane, the source join sequences already read in step 1 count as the join evidence; do not render them again.
5. Reject any join that lands on a frozen face or a half glance, and fix it.
6. Tell the user what was removed, by time and what it was ("0:12 looked down at notes, 0:31 reached for the camera, 4.2 s of dead air at the start"), and what was looked at and kept.

## Find candidates

### Reel lane
- Read one cached readFrames overview grid (count 12, stillsOnly:true) for orientation.
- Confirm each proposed join with a short SOURCE sequence around the retained outgoing end and incoming start (about 0.3–0.5 s at 10 fps). Batch explicit times with stillsOnly:true.
- Revisit only suspicious joins.
- Do not run a whole-source motion map, and do not infer a look-up from isolated stills.

### Other workflows
- Transcript: inspectAssetAnalysis (analyzeMedia transcribe first if there is none). Note pauses over about 0.7 s, false starts and restarts, "um/uh/so/like" before a restart, and the words around each gap.
- Picture: readFrames momentsOnly:true across the whole source (outside the reel lane, or in it when its full checks run). Read each moment with the table below.
- Short clip: for a clip under about 20 s, readFrames count 16 over the whole clip may replace the moments map; it returns the moments plus a picture.
- Skip a moment while the speaker is mid-sentence and calm: that is ordinary talking.
- Strongest candidates: moments in or next to a transcript pause, at the very start (before the first word) and at the very end (after the last word).

| Moment in the map | What it may be |
| --- | --- |
| Hold (a second or more where the picture all but stops) | During silence: dead air or a frozen face. A hold while speaking is kept. |
| Small motion in the face or hand region (compare the region to where the face is) | Looking away, at notes or down at the phone, fidgeting, touching hair or face, reaching for the camera |
| Big motion covering most of the frame | Standing up, walking out of frame, picking up or moving the camera |
| Cut | A jump from an earlier rough cut, a flash, a frame drop |

## Confirm
- Reel-lane join sequences count as confirmation when clear; do not re-read them.
- For any other candidate, readFrames fps 10 from about 0.5 s before it to about 0.5 s after; split a longer window into several reads. Several candidates close together can share one read.
- Look at the grid and decide. Awkward:
  - eyes leave the lens for 0.5 s or more during silence and return
  - the face freezes or goes blank
  - a hand comes up to the camera or face
  - the head drops to read
  - the camera shakes or is being set up
  - a flash or a jump
- Keep blinks, nods, talking gestures and glances under 0.5 s unless the user targeted them.
- Bracket onset and recovery at 10 fps, then inspect the adjacent native-rate frames in each bracket for the final boundaries.
- Never cut on the map alone: it says where the picture moves, not why.

## Cut
- Each cut runs from the frame the awkward thing starts to the frame the speaker is back, widened to the nearest word boundaries (word timings from inspectAssetAnalysis with start/end).
- Never cut inside a word.
- If the awkward moment happens while the speaker is talking, cut the whole sentence or phrase, or leave it and say so. Do not cut words out of a sentence to hide a glance.

## Long clips
- Other workflows confirm only the momentsOnly candidates; never page the entire clip at 10 fps.
- Use inspectVideo only when the user asks about something that must be heard (laughing, a cough, a phone ringing) or for a search by meaning across a long clip.
- inspectFrames is not needed when readFrames can show the frames.

## Rules
- Only cut what the user asked about. "Clean it up" with no visual words is a speech cleanup (cleanSpeech), not this skill.
- An explicit transcript-only request skips visual inspection.
- Speech cleanup and placing b-roll, images or an opening clip are transcript work: cut first, layer at transcript times, and read frames only at a flagged edge or in a narrow window around a known transcript time.
- A quiet pause alone is not an awkward moment.
- If the frames leave it unclear, keep the footage and say what was uncertain. Never claim a moment was removed that was not seen.

## Example
"Cut where I look away" on a 2-minute vlog, outside the reel lane:
1. readFrames momentsOnly:true finds small motion in the face region at 0:12 and 0:31.
2. readFrames fps 10 from 0:11.5 to 0:13.5: the head drops to read notes from 0:12.2 to 0:13.1, during a pause. At 0:31 it is a nod.
3. The cut runs 0:12.2 to 0:13.1, widened to the word boundaries around the pause, applied with cleanSpeech keep.
4. Reply: "Removed 0:12, looked down at notes (0.9 s). Looked at 0:31, a nod, and kept it."
