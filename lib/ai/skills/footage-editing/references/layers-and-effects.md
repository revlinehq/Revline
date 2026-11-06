---
name: "layers-and-effects"
description: "Layer, b-roll, undo, transition, speed and effect judgment for footage edits, plus the effect planning rules. Read before arranging layers, adding b-roll or transitions, changing speed, or adding any effect."
---
# Layers and effects

A good result changes only the requested clips, keeps linked video and audio together, and uses each effect for a reason the viewer can see. Exact parameters live in each tool's description; this page covers when to use what.

## Rules
- Batch identical changes across clips with the tool's clipIds selector in one call; run independent calls with known inputs in the same step.
- Use moveClips and resizeClips for a selected group, reorderLayer for a whole layer, and move or trim for one clip.
- Never delete an occupied track's clips just to remove its row.
- To return to an earlier version, use listRevisions with restoreClip or restoreTimeline, not chains of undoLatestEdit.
- Unlink a video/audio pair only when the user wants to keep one side while editing the other.
- Footage and sound fades are clip settings (configureVisualFade, configureAudio), never separate FX clips.
- After setPlaybackRate or setSpeedRamp, read the new clip duration before any further timing edit.
- Add a transition only when the user asked for it or it is a deliberate creative choice for that cut.
- When a request needs an unsupported capability (animating an object inside a video, a global camera, automatic parenting between layers, or generated footage), say so instead of approximating it.

{{revline:0}}
