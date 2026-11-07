---
name: "speed"
description: "retimeLayer: selective speed. Only the segmented subject slows down, speeds up or ramps; the background keeps real time over a clean plate, so the original subject leaves no ghost. Read before retimeLayer."
---
# Selective speed

`retimeLayer {layerId, speed | preset | anchors, alignAt}` changes the speed of the subject only. It stacks:

| Row | Clip |
|---|---|
| top | the subject cut-out at its own speed (plus `alsoLayerIds`, same speed) |
| middle | the clean plate of those layers, synced to the footage (real time) |
| bottom | the footage (unchanged) |

The clean plate is the same render `removeObject` makes for those layers, with the same order: free when the camera is static and the subject uncovers everything, otherwise Bria Video Eraser at $0.14/s within the monthly allowance (see page `remove`). A plate made by either tool is reused free by the other.

## Timing
- `speed` 0.25–4, or a `setSpeedRamp` `preset` (`slowmo-middle`, `hero`, `bullet`, `ramp-in`, …), or `anchors` `{x: 0..1 of the clip, rate: 0.1..10, easing?}`, exactly as `setSpeedRamp`.
- The subject clip keeps the footage's start and length; its source range follows from the speed.
- `alignAt` (TIMELINE second, default the clip start) is where subject and background are in step. Slow motion around a moment: put `alignAt` on it.
- The retimed source range must stay inside the layer's mask (the clip plus 0.25 s). A speed-up that runs past it is refused with the largest average speed that fits. Slowing down always fits when `alignAt` is inside the clip.

## Workflow
1. `segment` the subject (and anything it carries, as more layers for `alsoLayerIds`).
2. `retimeLayer {layerId, speed:.5, alignAt:4}` → `processing` until the clean plate is ready; call again with the same input every 15–20 s.
3. `getFrames` at 1080 at the clip start, at `alignAt` and at the end: the subject appears once (no real-time ghost), edges clean.
4. `finish`. It fails if a real-time copy of the same subject sits over the retimed one, or if the clean plate was removed.

## Example
```json
{"tool": "retimeLayer", "layerId": "r17dvy4jjqcybap5bf6nr9jf3x8hsf6q", "speed": 0.5, "alignAt": 4}
```
Estate clip, 8 s: the gardener plays source 2–6 s at half speed, in step at 4 s, over the Bria clean plate that removeObject had already made (reused: no new cost).

## Measured (November 2026)
- Estate clip, 1080p24, 8 s, gardener at 0.5×: clean plate reused from removeObject, applied in one call; plate cost **$1.13** once (Bria, 8.04 s). A fresh plate takes what removeObject takes.

## Limits
- In v1 retimeLayer stands alone on its footage clip: it refuses when other Genesis clips are stacked there, and other functions refuse on a retimed clip. Effects copy the original footage, so the subject would show twice.
- It needs the original footage, not a clip already switched to a clean plate by removeObject.
- What the mask leaves out stays in real time or is erased: the gardener's raised shears were outside SAM's mask, so pieces of them show apart from his hands in the retimed clip. Segment held objects as their own layer and pass them in `alsoLayerIds`.
- Slow motion repeats frames (no interpolation). For smooth slow motion of the whole shot use `smoothSlowMotion` instead.
