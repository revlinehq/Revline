---
name: "edit-lanes"
description: "Sets which checks each lane runs for edits to existing footage, captions, scenes or films, and the smallest read-edit-verify path for each. Read first for any such edit, before reading a transcript or code."
---
# Editing existing footage, captions, scenes or films

A good edit changes only the requested range, keeps everything around it in sync, and is verified at exactly the moments it touched. The lane sets the checks.

## Workflow
1. Pick the checks for this edit from Rules, Which checks.
2. Read only the affected range: the transcript window for footage and captions, the affected section for a film.
3. Make the edit in as few calls as possible (Rules, Footage and captions or Scenes and films).
4. Verify at each changed moment, then report what was sampled.

## Rules

### Which checks
- A final export or publish request, or an explicit request to double-check everything, runs the lane's full checks. The server decides that from the request.
- **New scene, film or recreation:** the motion or recreate lane, which always runs full checks. Keep check metadata in tool results.
- **Plain talking-head speech cleanup in the reel lane:** saved-data checks; sample new or changed caption styling or framing once.
- That reel path needs no frames at every speech cut and no compulsory listening. Explicit visual requests and uncertain joins still get targeted checks.
- **Other existing static, text or asset change, or a named speech cut:** local checks in every lane.
- **Existing motion, timing, camera or transition edit:** local checks in the edit lane; full changed-range checks in the motion and recreate lanes and for final checks.
- Story restructuring checks every changed spot. An explicit whole-film review is a full double-check.

### Local and full checks
- **Local checks:** getFrames at each changed moment and one frame either side (`t - 1/fps`, `t`, `t + 1/fps`, within the timeline).
- Local checks skip full sweeps, reference compares, repeated finishing passes, compareReference, motionMap and checkPacing.
- **Full checks:** launch-films-motions "Before handing back" for films and scenes and, for copies, the close-out in remaking-videos page `recreation`; finish adds the automatic timing and limit checks. When scene motion changed, follow the full lane.
- Rendered checks are required for visual changes in every lane, except the plain reel cleanup above.
- Reuse loaded skills and project context.

### Footage and captions
- Read only the transcript around the affected source range, with inspectAssetAnalysis start/end or batched windows.
- Batch retained ranges per affected clip with retainSourceRanges, isolating local speech before cleanup.
- Ripple the actually removed timeline intervals across affected tracks so captions, b-roll and linked audio stay in sync: trim or delete intersecting material, then batch moveClips by the shared time delta.
- Preserve unrelated speech and styling.
- Verify with inspectTimeline: the new duration meets the target, with no gaps or orphaned captions.

### Scenes and films
- Find code with inspectClip search, then read only the affected `section` (or `lines` when there are no sections).
- Make one patchScene call where possible, with that section and expectedRevision.
- Never rebuild a film section as a separate scene clip.
- Review diffScene for edits outside the requested scope. After a shared-code edit, check the other sections it touches and the adjacent boundaries.
- Report the sampled scope, never whole-film visual equivalence.
- Attach the actual verification evidence with recordFix.
