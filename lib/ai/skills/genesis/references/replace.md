---
name: "replace"
description: "replaceSurface: put an image or video on a flat surface (phone screen, sign, car door) and keep it there as the camera or the surface moves; occluders such as a hand stay in front. Our own compositor, no generative model. Read before replaceSurface."
---
# Replace a surface

`replaceSurface {clipId, assetId, at, corners | surfaceLayerId, occluderLayerIds?, lightMatch?, fit?}` puts an image or video asset on a flat surface and tracks it through the clip. It stacks one clip above the footage: the **surface insert**, a transparent video on the source clock. Occluders are cut out of the insert, so the footage's own pixels (the real hand) show in front. Nothing else is stacked.

## How it tracks
| Surface | Tracker |
|---|---|
| A uniform saturated colour (green or blue screen) | **Key shape.** The seed frame's key region is aligned to each frame's key mask with an ECC homography, starting from the previous frame shifted by the region's centroid. It follows the screen itself, even when a hand drags it. Frames without the key (the screen left the frame) stay uncovered. |
| Anything else (a sign, a door) | **Features.** The pixel tracker's internals (KLT settings and cut detection, as `trackPoints`) on the surface and the area around it (1.6× the quad), fitted to a homography anchored to frame `at`, so it does not drift. When features bunch on one side, the similarity of the same matches carries that frame. A shot cut stops the track. |

- Occluder masks are left out of tracking. On a chroma screen, key-coloured pixels inside an occluder mask (and a 3 px rim around them) still count as screen: SAM's hand mask can take in the phone it grips, bezel included.
- Corners are smoothed only against jitter (neighbours within 3 px); fast motion is not smoothed, so the insert does not lag.
- `lightMatch` (default on) carries the surface's brightness change relative to frame `at` onto the insert (occluders left out; gain clamped to 0.5–1.5×).
- `fit:"cover"` (default) crops the insert to the surface's aspect; `stretch` fills it exactly.
- The report has `tracker` (`chroma-key` or `features`), `trackedFrames`, `lostFrames` (source seconds, first 60), `stops.lostReasons` (`gone`, `covered`, `align`, `mismatch`), `cornerJitterPx` and `lightGain`.

## Corners
- `corners` are normalized SOURCE `[x, y]`, in the **insert's** order: top-left, top-right, bottom-right, bottom-left of the image as it should appear. For a phone lying diagonally, top-left is the end of the screen's top edge on the left of someone holding the phone upright.
- Put the corners on the **outer edge** of the surface; 2–3% beyond a green screen's keyed edge hides the key colour on rounded corners.
- Or `surfaceLayerId`: a SAM layer of the surface; its mask on frame `at` gives four corners (`rotate` 90/180/270 when the insert comes out turned).

## Workflow
1. `readFrames` → a frame where the surface is whole and unblocked → its corners.
2. `segment` each occluder with a box on a frame where it is clearly in front.
3. `replaceSurface {...}` → `processing`; call again with the same input every 15–20 s until it applies.
4. `getFrames` at the start, the end, and while the occluder crosses the surface: the corners hug the surface and the occluder stays in front. Batch the times in one call; a lone 1080 frame of a short alpha window can fail with `zero_output`.
5. `finish`.

## Example
```json
{"tool": "replaceSurface", "clipId": "d5866591-…", "assetId": "m978zyp0…", "at": 0,
 "corners": [[0.426,0.399],[0.5156,0.2652],[0.735,0.5798],[0.6413,0.7392]],
 "occluderLayerIds": ["r171brkk809qecnc4d649n49ah8hswcd"]}
```
A Revline screenshot on the Mixkit green-screen phone: it follows the phone through the camera pan, the hand's tap and grip, and the start of the drag; the hand stays in front.

## Measured (November 2026)
| Shot | Frames | Result | Compositor | Cost |
|---|---|---|---|---|
| Mixkit green-screen phone (100070), 1080p24, 5.7 s: camera pans ~200 px, a hand taps, grips and drags the phone out of frame | 137 | 92 tracked (`chroma-key`); 42 lost after the phone left, 3 during the fast drag | 20–32 s | **$0** |
| Its hand layer (SAM 3.1) | 137 | visible 1.3–3.8 s | 89 s | $0.03 |
| Same clip, no hand (local check) | 48 | jitter 1.3 px | 4 s | $0 |

## Limits
- Flat surfaces only. Curved or folding surfaces do not fit one homography.
- A fast, motion-blurred turn (the phone dragged and rotated within ~0.3 s) can sit a few pixels off, or drop a frame where the key colour then shows.
- Feature tracking (non-chroma surfaces) follows everything coplanar around the surface: a sign picked up off a wall is not followed. Chroma screens are tracked by their own shape.
- Holes in an occluder's SAM mask show the insert through it.
- Inserts are images or videos already in the project (`uploadMedia`, `copyMedia`). A video insert plays from its start and holds its last frame.
