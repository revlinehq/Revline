---
name: "layers-and-effects"
description: "Layer, b-roll, undo, speed and effect judgment for footage edits, plus the effect planning rules. Read before arranging layers, adding b-roll, changing speed, or adding any effect; transitions live in the transitions skill."
---
# Layers and effects

A good result changes only the requested clips, keeps linked video and audio together, and uses each effect for a reason the viewer can see. Exact parameters live in each tool's description; this page covers when to use what.

## Rules
- Batch identical changes across clips with the tool's clipIds selector in one call; run independent calls with known inputs in the same step.
- Use moveClips and resizeClips for a selected group, reorderLayer for a whole layer, and move or trim for one clip.
- Montage shot notes take one call each and name the shot by its time: delete {at, ripple:true} removes a shot and closes the gap, swapClips {a, b} trades two slots, resizeClips {at, side, delta, ripple:true} lengthens a shot and pushes later clips, setVolume {at, volume:0} mutes it. Linked audio and mirror-blur backgrounds follow.
- Never delete an occupied track's clips just to remove its row.
- To return to an earlier version: footage-editing page `edit-lanes` (Direction and feedback).
- Unlink a video/audio pair only when the user wants to keep one side while editing the other.
- When a video and its sound sit as separate clips that should move, trim and delete together (same start, length and source range), link them again with link, all pairs in one call.
- Footage and sound fades are clip settings (configureVisualFade, configureAudio), never separate FX clips.
- After setPlaybackRate or setSpeedRamp, read the new clip duration before any further timing edit.
- Transitions (hard cut, whips, fades, addTransition settings): read the `transitions` skill.
- When a request needs an unsupported capability (animating an object inside a video, a global camera, automatic parenting between layers, or generated footage), say so instead of approximating it.

{{revline:0}}
