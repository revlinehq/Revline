---
name: "edit-lanes"
description: "Start here for existing footage, caption, scene or film edits: choose quick or full verification before reading transcript or code."
---
# Editing existing footage, captions, scenes or films

- New scene/film or recreation: Precise full checks, even if Fast was selected; keep mode metadata in tool results. MCP defaults to Precise unless editMode is passed.
- Plain talking-head speech cleanup in Fast reel: saved-data checks; sample new/changed caption styling or framing once. No frames at every speech cut or compulsory listening. Explicit visual requests and uncertain joins still get targeted checks.
- Other existing static/text/asset change or named speech cut: local checks in either mode.
- Existing motion/timing/camera/transition edit: local checks in Fast; full changed-range checks in Precise. Story restructuring and whole-video review also use full checks.

Local checks use getFrames at each changed moment and ±1/fps; no full sweeps, reference compares or repeated finishing passes. Reuse loaded skills and project context. Full checks use checklist and, for copies, reference-footage/recreation. Rendered checks are required for visual changes in both modes; plain Fast reel speech cleanup uses the data checks above.

**Footage and captions:** read only the transcript around the affected SOURCE range with inspectAssetAnalysis start/end or batched windows. Use the fewest calls: batch retained ranges per affected clip with retainSourceRanges, isolating local speech before cleanup. Ripple the actual removed timeline intervals across affected tracks so captions, b-roll and linked audio stay in sync: trim or delete intersecting material and batch moveClips by shared time delta. retainSourceRanges compacts only the linked pair; closeGaps works per layer, so neither alone synchronizes overlays. Preserve unrelated speech and styling. Verify with inspectTimeline: new duration meets the target, no gaps or orphaned captions. Except for the plain Fast reel path above, use getFrames at each changed cut point or caption moment and one frame either side (`t - 1/fps`, `t`, `t + 1/fps`, within the timeline).

**Scenes:** find code with inspectClip search, then read only the affected `section` (or `lines` without section markers). Make one patchScene call where possible, with the same section and expectedRevision. Check getFrames at the changed moment and one frame either side. Review diffScene for edits outside scope and shared-component consumers; inspect adjacent boundaries. Report sampled scope, not whole-film visual equivalence. In Fast, skip compareReference, motionMap and checkPacing; in Precise, follow the full lane when scene motion changed. Review saved changes with diffScene using revisions from listRevisions, then attach the actual verification evidence with recordFix.