---
name: "edit-lanes"
description: "Sets which checks each lane runs for edits to existing footage and captions, and the smallest read-edit-verify path for each. Read first for any such edit, before reading a transcript."
---
# Editing existing footage and captions

A good edit changes only the requested range, keeps everything around it in sync, and is verified at exactly the moments it touched. The lane sets the checks.

## Workflow
1. Pick the checks for this edit from Rules, Which checks.
2. Read only the affected range: the transcript window for footage and captions.
3. Make the edit in as few calls as possible (Rules, Footage and captions).
4. Verify at each changed moment, then report what was sampled and anything that had to move.

## Rules

### Direction and feedback
- **Exact direction from the user:** do exactly that. Never override the user.
- **Approved work is off-limits:** change it only when the user names it. When the user approves a clip, mark it with approveClip.
- **Feedback on one part:** change only that part. Every other clip, title, timing, move, color and sound stays exactly as it was.
- Never "improve" what was not asked about. If a change forces something else to shift (later timings, an audio cue), keep it otherwise identical and say what moved.
- **Back to what we had** ("go back to what we had", "it was better before"): listRevisions, look with getFrames revision, then restoreClip for one clip (restoreTimeline for the whole tab). Never re-patch by hand to recreate it, and never chain undoLatestEdit.

### Which checks
- A final export or publish request, or an explicit request to double-check everything, runs the lane's full checks. The server decides that from the request.
- Keep check metadata in tool results.
- **Plain talking-head speech cleanup in the reel lane:** saved-data checks; sample new or changed caption styling or framing once.
- That reel path needs no frames at every speech cut and no compulsory listening. Explicit visual requests and uncertain joins still get targeted checks.
- **Other existing static, text or asset change, or a named speech cut:** local checks in every lane.
- **Existing motion, timing, camera or transition edit:** local checks; full changed-range checks for final checks.
- Story restructuring checks every changed spot. An explicit whole-video review is a full double-check.

### Local and full checks
- **Local checks:** getFrames at each changed moment and one frame either side (`t - 1/fps`, `t`, `t + 1/fps`, within the timeline).
- Local checks skip full sweeps, repeated finishing passes and checkPacing.
- **Full checks:** getFrames across every changed range, plus checkPacing or checkSound where motion, timing or sound changed.
- Rendered checks are required for visual changes in every lane, except the plain reel cleanup above.
- Reuse loaded skills and project context.

### Footage and captions
- Transcript reads and speech cuts follow footage-editing page `speech`.
- Montage shot notes are one call each, by time, with no ID lookups or per-clip moves: remove a shot with delete {at, ripple:true}, swap two with swapClips {a, b}, lengthen with resizeClips {at, side:'right', delta, ripple:true}, mute with setVolume {at, volume:0}. Music and other layers keep their times; check once with inspectTimeline afterwards.
- For other cuts, ripple the actually removed timeline intervals across affected tracks so captions, b-roll and linked audio stay in sync: trim or delete intersecting material, then batch moveClips by the shared time delta.
- Verify with inspectTimeline: the new duration meets the target, with no gaps or orphaned captions. Gaps, overlaps and stray clips are timeline data: read them there and from finish, never by rendering frames. Frames are for what only pixels show: an awkward face at a cut, a gesture, framing.

### Reporting
- Report the sampled scope, never whole-video visual equivalence.
- Attach the actual verification evidence with recordFix.
