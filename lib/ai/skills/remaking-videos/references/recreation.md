---
name: "recreation"
description: "The full recreation workflow: section inventories, exact content, layered camera behavior, rendered transition comparisons and close-out. Existing edits start with writing-scenes page edit-lanes."
---
# Recreating a motion film

## Contents
- Before starting
- 1. Map the film, then inventory one section
- 2. Read camera behavior per layer
- 3. Build and verify this section before the next
- 4. Close out against the inventory

## Before starting
- For edits to an existing recreation, start with writing-scenes page `edit-lanes`. The inventory, dense reads, comparisons and close-out below are the recreate lane's full checks, which that lane always runs. A small change made in the edit lane uses its local frame checks instead.
- The supplied video is the brief. Read launch-films-motions and writing-scenes for implementation. This page owns the recreation workflow.
- Take the words, UI, brand, timing and motion from the reference; ask only for something the video cannot answer, such as a different format or length.
- Rebuild graphics, UI and captions as editable layers; retain separately addressable footage where the requested workflow uses it. Do not flatten the remake into playback of the reference.
- For a new motion film, read launch-films-motions page `ideation`: agree the message, tension and an angle, then build when the user accepts it. During the build, read `image-plates` for real asset needs.
- For an actual remake, the measured recreation inventory governs the editable reconstruction; image generation is for assets, not replacement reference frames.

## 1. Map the film, then inventory one section

### Source format
- Record the source width and height exactly, its frame rate (retain fractional rates such as 30000/1001), and video frame count.
- Derive video duration from frame count divided by fps, not the audio tail.
- Use those dimensions and timing for the requested remake; disclose any renderer limitation or requested format conversion.
- Keep event times tied to source frame numbers to avoid rounding a switch onto the next frame.

### Map the whole film
- Read the whole reference with readFrames count 16 for its moments and holds.
- Then run motionMap with its assetId across the whole reference in adjoining windows of up to 12 s (0–12, 12–24, …), before writing the inventory.
- Every move motionMap returns is an inventory item; group these into named sections with their incoming and outgoing transitions.

### Dense reads of a section
- Before building a section, read every change from a little before its onset through its settle with readFrames at the reference's full source fps (from the readFrames result).
- Each sheet holds at most 30 frames: shorten windows and continue from the last returned time until the entire section is read.
- Inspect consecutive full-resolution frames on both sides of cuts, entrances, exits, flashes and caption switches; sparse sheets locate events but cannot establish their frame timing.
- Open full-size frames or crops for details.

### The effect inventory
Write a numbered effect inventory in your reply, with one item per visible change, including simultaneous changes on different layers:
- Time window and what it is, including its first visible frame, end and settle.
- Layer: background, foreground, cursor or UI; name the object within that layer.
- Type: cut, continuous zoom, spring, stagger, morph, mask, blur, dither, click, hover, scatter or the specific behavior seen.
- Count: every container, piece, click and staggered entry, including their order and spacing.
- Color and thickness: measured colors, strokes and pixel/block sizes.
- Exact content: every word, logo, icon, face and shape, plus its source crop.
- Text: compare source and rendered visible ink bounds in source pixels (width, height, baseline and spacing), then weight, outline and shadow. Measure the caption band’s actual pixel switches independently of transcript word times; preserve hard switches unless a fade is visible.
- Blur: record source frames proving smear direction, extent and duration. Rebuild directional motion blur on the moving layer only when observed; symmetric blur is not evidence of a directional match.

### Build only from the inventory
- A three-container menu needs three staggered containers.
- Record scattered cubes, clicks and text hovers during scrolling even when the moments detector does not name them.
- Crop and read every logo, icon, face and text before implementing it. Use findIcon for an identified icon, traceShape for its actual outline, matchFont for type and measureFrame for colors and edges.
- Never substitute a guessed logo or symbol for a face or unread detail. Re-read anything uncertain.

## 2. Read camera behavior per layer
- Use trackReference separately on background and foreground objects that move differently; record what stays fixed, onset, path, acceleration, overshoot and settle.
- Every tween uses the ease motionMap or trackReference measured, or a CustomEase built from it: for example, no default power2.out without a measurement behind it.
- Keep a continuous push continuous across section boundaries and a measured cut instantaneous.

## 3. Build and verify this section before the next

### Build with section markers
- Use addFilm for one continuous film with section markers. Build the first section as a `section(...)` call, leaving an insertion marker comment for later sections (writing-scenes page `films`).
- Set builtThrough to that section's film-second end so addFilm checks reads for the implemented part while keeping the full clip duration; extend builtThrough with patchScene for each later section.
- For corrections, inspectClip with section (marker label or id) or lines {start,end} returns short exact blocks with absolute line numbers.
- Use patchScene with that section and small find/replace edits, or edits [{lines:{start,end},replace}] without quoting old code; pass expectedRevision from the read.
- Line edits share one inspected snapshot, must not overlap, and need a new read after saving. A failed find returns nearby numbered lines to copy. Without markers, use whole-scene line ranges.
- A transition spanning sections belongs on the outer `tl` (shared code); heed shared-code warnings, include affected sections in scope, and verify both sides of the boundary.

### Big moves first
- Match the big moves first: every inventory transition, layer, count, order, onset, duration and camera behavior must match before polishing colors or offsets.
- Do not close a button on the scene-change frame unless the reference does.
- Keep connected motion continuous through boundaries.

### Verify rendered pixels
- Verify rendered pixels, never code, tween parameters or cue times. An effect scheduled at the right time may remain invisible behind a threshold or mask.
- Find its first visible rendered frame and compare it with the reference, then its pace, peak and disappearance.

### compareReference on every transition
- Run compareReference with start, end and fps 15 across every transition window, including padding before onset and after settle.
- Split long windows into adjoining calls and inspect every returned pair. Sparse times are only for steady stretches.
- Crop a small effect or detail and score that region on its own; a quiet background can hide a missing click or wrong pixel thickness in a whole-frame score.
- Scores rank differences, they do not certify a match, even at a low percentage.

### motionMap on the build
- Run motionMap with assetId plus timelineStart on every window of up to 12 s: done means zero motion differences on the current revision.
- Fix each listed difference with patchScene and recheck, or mark its window off with motionMap off:{time,reason} (for example, motion inside ThreeLayer that tracking cannot measure); off never means matched.
- Inspect uncertain layers with trackReference and cropped comparisons; still-frame scores alone never certify motion.

### Refused or failing checks
- If a render or compare is refused (job limit, timeout), wait about 30 s and retry its exact nextAction.
- A refused check is not a pass: never mark a section done or end the recreation because checks could not run.
- After 2 motionMap failures, or for an unmeasurable effect, use motionMap with the same assetId/start/end and off:{time,reason}; carry that timed reason into close-out.

### Code review and fix records
- Find code with inspectClip search: {query: "text"} (regex: true for a per-line pattern), then read its numbered lines before patching with expectedRevision.
- Use diffScene with fromRevision and toRevision from listRevisions to review saved code changes.
- After checking the rendered saved revision, attach what changed and the actual verification evidence with recordFix (clipId, revision, summary, verification); later turns read it in listRevisions.

## 4. Close out against the inventory

### Whole-film comparison
- Run compareReference with start/end/fps 10 in adjoining windows across the whole film (up to 60 samples per call, about 6 s at 10 fps); it renders the clone beside the reference frame for frame.
- Write down in plain words what still differs in rhythm, smoothness, entrances and exits, and fix it with patchScene.
- Mark every numbered inventory item matched by rendered evidence or off with its time and reason, including every off item in the motionMap reports; off never means matched.
- Compare the final rendered output on the saved revision against the source, including dimensions, duration, cut and caption timing, and changed motion windows.
- Report what remains approximate, substituted fonts/assets, unverified intervals and the actual comparison results; claim only the agreement the evidence supports.
- Recheck all section boundaries and motionMap windows after the final edits, then run the writing-scenes checklist; a still-frame score never certifies motion.

### Sound
- Match music with matchMusic using the reference's tempo and main inventory moments.
- Regenerate its effects with generateSound, place them at the matching visible hits and verify with checkSound.
- End music and effects with the film. Never copy the reference audio.
- Confirm any voiceover with a transcript; if it cannot be reproduced, finish the visuals and state the missing recording explicitly.
