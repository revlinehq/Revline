---
name: "checklist"
description: "Lists the full checks for a new build or full-lane edit of a scene or film: first frames, cuts, beats, timing, edges, measurements, scope, limits and preview speed. Read before handing one back; edits to existing work start with edit-lanes instead."
---
# Checklist: before handing it back

A film is done when every item below was checked on rendered frames, never from the code alone. Run all of them for a new build, a motion or recreate lane edit, and final checks in any lane.

## Workflow
1. Render frames with getFrames and look at them.
2. Go through the items under Rules in order; fix each failure and re-render that moment.
3. Name what you checked when reporting.

## Rules
1. **First frames.** The clip's first frame and the next one (start and start + 1/fps). Nothing shows that should still be hidden.
2. **Every cut and section boundary.** Each one minus one frame, on the cut, and plus one frame. No flash, no jump; where beats are meant to connect, the two sides match.
3. **Every beat.** One frame at each beat's key moment, inspected for vertical output at 360×640.
   - Essential text is ≥16 displayed px, and its settled hold (excluding entrance and exit) is ≥ max(1 s, words / 3). If not, increase the size or hold.
   - Text stays inside the frame without unintended overlaps; one claim per beat.
4. **Timing.** Original films: scan the code once against launch-films-motions "Timing and easing" (no non-camera move over 0.6 s without a reason, exits shorter than entrances, beats 1.75–3.5 s); they are not re-paced afterwards. Recreations keep the measured reference pacing; use compareMotion where it differs.
5. **Details, edge by edge.** For every window, card, button and frame built or changed, look at one frame mid-move (opening, closing, transition) and one after it settles. Check:
   - exactly one border: no outer stroke, glow or leftover outline an effect leaves behind;
   - the same corner radius on every corner, and no missing or extra lines (frame corners, dividers);
   - nothing clipped or spilling out of its container;
   - text/background contrast ≥4.5:1, from measureFrame samples and relative luminance, at settled and lowest-contrast frames;
   - no element still on screen after the thing that owns it has closed.
   Name each one checked; a frame that only looks fine at a glance is not checked.
6. **Measurements.** Product UI compared with its screenshot at full size (compareScreen). Every reference measured on full-resolution frames, never a downscaled contact sheet (it makes everything look about half its size).
7. **Only what was asked.** On feedback, diffScene shows no change outside the named part.
8. **Limits.** Within the writing-scenes Contract limits.
9. **Preview speed.** Parts that are done or hidden are `display: none` (or `autoAlpha: 0`), not only opacity 0. No heavy UI left visible where it cannot be seen.
10. **Recreations match.** Close out remaking-videos page `recreation`: every inventory item matched or explicitly marked off.
