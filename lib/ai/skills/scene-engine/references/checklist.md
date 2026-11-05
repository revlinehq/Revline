---
name: "checklist"
description: "Full checks for builds and full-lane edits. Existing edits start with edit-lanes. First frames, cuts, beats, pacing, details, measurements, scope, limits and preview speed."
---
# Checklist: before you hand it back

For an existing scene or film edit, follow page `edit-lanes` first. Run every item below for a new build or full-lane edit: the motion and recreate lanes, and final checks in any lane. Local checks in other lanes follow edit-lanes instead. Render frames with getFrames (up to six per call) and look at them. Timing is set while writing: original films follow motion-design "Timing and easing" and are not re-paced afterwards. Never report a film as done from the code alone.

1. **First frames.** The clip's first frame and the next one (start and start + 1/fps). Nothing shows that should still be hidden. A part hidden at its first frame starts hidden where it is built (page `react-scenes`, Motion; for GSAP specifics, the gsap skill).
2. **Every cut.** Each cut minus one frame, on the cut, and plus one frame. No flash, no jump; where the beats are meant to connect, the two sides match.
3. **Every beat.** One frame at each beat's key moment. Inspect vertical output at 360×640: essential text ≥16 displayed px, settled hold ≥max(1 s, words/3), excluding entrance/exit. Increase size/hold if inspection fails. Keep text inside frame without unintended overlaps; one claim per shot.
4. **Timing.** Original films: scan the code once against motion-design "Timing and easing" (no non-camera tween over 0.6 s without a reason, exits shorter than entrances, beats 1.75–3.5 s). Recreations: preserve the measured reference pacing and use compareMotion where it differs.
5. **Details, edge by edge.** For every window, card, button and frame you built or changed, look at a frame mid-move (opening, closing, transition) and one after it settles, and go over its edges: exactly one border (no outer stroke, glow or leftover outline an effect leaves behind, no double border), the same corner radius on every corner, no missing or extra lines (frame corners, dividers), nothing clipped or spilling out of its container, text/background contrast ≥4.5:1 using measureFrame samples and relative luminance at settled and lowest-contrast frames, and no element still on screen after the thing that owns it has closed. Name each one you checked; a frame that only looks fine at a glance is not checked.
6. **Measurements.** Product UI compared with its screenshot at full size (compareScreen), and every reference measured on full-resolution frames, never a downscaled contact sheet (it makes everything look about half its size).
7. **Only what was asked.** On feedback, diffScene shows no change outside the named part (motion-design "Direction and feedback").
8. **Limits.** Each scene under 120,000 characters and the timeline under 400,000 (shared code counts once), clips up to 120 s.
9. **Preview speed.** Parts that are done or hidden render nothing or `display: none`, not only opacity 0; no heavy UI mounted where it cannot be seen.
10. **Recreations match.** Follow reference-footage page `recreation`: verify every inventory item in rendered pixels, compare every transition at 15 fps, run compareMotion per section and fix its residuals. Close out each item as matched or explicitly off. Scores and pass counts never establish completion.