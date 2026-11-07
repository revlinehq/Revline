---
name: "replace"
description: "replaceSurface: put an image or video on a flat surface (phone screen, sign, car door) and keep it there as the camera moves; occluders such as a hand stay in front. Our own compositor, no generative model. Read before replaceSurface."
---
# Replace a surface

`replaceSurface {clipId, assetId, at, corners | surfaceLayerId, occluderLayerIds?, lightMatch?, fit?}` puts an image or video asset on a flat surface and tracks it through the clip. It stacks:

| Row | Clip |
|---|---|
| top | occluder cut-outs (SAM layers of whatever passes in front: a hand) |
| middle | the surface insert, a transparent video on the source clock |
| bottom | the footage (unchanged) |

## How it tracks
- The four corners on frame `at` seed the track. The media worker uses the pixel tracker's internals (KLT settings and cut detection, as `trackPoints`), fitted to a **homography anchored to frame `at`** every frame, so it does not drift. Features come from the surface and the area around it (1.6× the quad); occluder masks are left out.
- When features bunch on one side (a hand covers the rest), the homography is replaced by the similarity of the same matches for that frame.
- Corners are lightly smoothed over neighbouring frames. A shot cut stops the track; frames that cannot be tracked stay uncovered, and the report lists where it stopped.
- `lightMatch` (default on) carries the surface's brightness change relative to frame `at` onto the insert (the occluders are left out of the measurement; the gain is clamped to 0.5–1.5×).
- `fit:"cover"` (default) crops the insert to the surface's aspect; `stretch` fills it exactly.

## Corners
- `corners` are normalized SOURCE `[x, y]`, in the **insert's** order: top-left, top-right, bottom-right, bottom-left of the image as it should appear. For a phone lying diagonally, top-left is the end of the screen's top edge on the left of someone looking at the screen upright.
- Put the corners on the **outer edge** of the surface; 2–3% beyond a green screen's keyed edge hides the key colour on rounded corners.
- Or `surfaceLayerId`: a SAM layer of the surface; its mask on frame `at` gives four corners (`rotate` 90/180/270 when the insert comes out turned).

## Workflow
1. `readFrames` → a frame where the surface is whole and unblocked → its corners.
2. `segment` each occluder with a box on a frame where it is clearly in front.
3. `replaceSurface {...}` → `processing`; call again with the same input every 15–20 s until it applies.
4. `getFrames` at 1080 at the start, the end, and while the occluder crosses the surface: the corners hug the surface, the occluder stays in front.
5. `finish`.

## Example
```json
{"tool": "replaceSurface", "clipId": "d5866591-…", "assetId": "m978zyp0…", "at": 0,
 "corners": [[0.426,0.399],[0.5156,0.2652],[0.735,0.5798],[0.6413,0.7392]],
 "occluderLayerIds": ["r171brkk809qecnc4d649n49ah8hswcd"]}
```

## Measured (November 2026)
| Shot | Frames | Compositor | Cost |
|---|---|---|---|
| Mixkit green-screen phone (100070), 1080p24, 5.7 s, camera pans ~200 px, a hand taps the screen | 137, 136 tracked | 23–29 s | **$0** |
| Its hand layer (SAM 3.1) | 137 | 89 s | $0.03 |

## Limits
- Flat surfaces only. Curved or folding surfaces do not fit one homography.
- Chroma spill: on a green screen, the occluder cut-out keeps a thin green fringe where SAM's edge includes screen pixels, and holes in the occluder's mask show the insert through it.
- A surface that leaves the frame or is fully covered for long stops the track; frames after the stop stay uncovered.
- `cornerJitterPx` in the report is the largest frame-to-frame corner wobble. Above ~5 px, check those frames.
- Inserts are images or videos already in the project (`uploadMedia`, `copyMedia`). A video insert plays from its start and holds its last frame.
