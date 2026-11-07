---
name: "remove"
description: "removeObject: take segmented subjects out of footage. A free clean plate (our own compositor) when the camera is static and the subject uncovers everything; otherwise Bria Video Eraser at $0.14/s within a monthly allowance. Read before removeObject, or before retimeLayer (it uses the same clean plate)."
---
# Remove an object

`removeObject {layerIds}` takes one or more ready SAM 3.1 layers of the same footage and saves the footage without those subjects as a new asset on the source clock. The footage clip then points at it, the sound stays the same, and one `undoLatestEdit` restores the original.

## Methods, in order
| Method | When | Cost | How |
|---|---|---|---|
| **Clean plate** (free) | Static camera, and every masked pixel is uncovered in some frame | $0 | Our compositor (OpenCV on the media worker, no generative model). Each frame keeps its own pixels; the masked ones (dilated ~13 px at 1080p) come from the temporal median of the same pixels in the frames where they are uncovered, with a per-frame light match measured around the mask. |
| **Bria Video Eraser** (paid) | The camera moves (background shifts more than 0.4% of the frame diagonal), or some masked pixels are never uncovered | $0.14 per second of the range | `bria/bria_video_eraser/erase/mask` on fal. The SAM mask is dilated ~30 px (at 1080p) so thin held parts (tool handles) go too; white = erase. Bria takes at most 5 s per call, so the range runs in equal chunks of up to 5 s that are joined. Pixels outside the dilated mask stay the original's. |

- Never-uncovered specks under 0.02% of the frame (~400 px at 1080p) are filled from the matching texture beside them and never trigger the paid path.
- `fallback:"none"` refuses instead of paying. Small never-uncovered areas (up to 1% of the frame) are then filled from the matching texture beside them, with a warning; larger ones and a moving camera are refused with the coverage percentage.
- Only what the clip plays, plus 0.25 s on each side, is rendered and billed: trim or split the footage first to pay for less.
- Monthly Bria allowance per account (UTC calendar month): **60 s** on the MCP plan, **120 s** on Pro (`BRIA_MONTHLY_SECONDS` in `lib/ai/lanes/genesis/render-contract.ts`). Seconds count from the moment Bria is called, in a per-owner ledger that deleting a project does not reset. Past the allowance the call is refused with what is left; no money is spent.
- A render is paid once. The same request (or retimeLayer on the same layers and clip) reuses it free; the result's `costNote` says so.
- The expected Bria cost is logged on the worker before each call. The tool result reports `method` (`cleanPlate` or `bria`), `costUsd`, `report.coverage`, `report.reason` and `briaAllowance`.

## Workflow
1. `segment` the subject (and, as its own layer, anything it holds that should go too). The paid path's 30 px margin catches thin parts close to the body, not ones held far from it.
2. `removeObject {layerIds:[...]}` → `status: "processing"`. Call it again with the same input every 15–20 s until it applies. Polling never starts a second render: if a render failed, the next call reports the failure once, and the call after that starts a new one (paying again on the paid path).
3. `getFrames` at 1080 where the subject was most visible, at the start and end, and on both sides of every 5 s chunk boundary on the paid path. Look for leftovers (a held object, a shadow) and for a soft patch.
4. `finish`.

## Example
```json
{"tool": "removeObject", "layerIds": ["r17dvy4jjqcybap5bf6nr9jf3x8hsf6q"]}
```
Result (estate clip, gardener): `method:"bria"`, `costUsd:1.13`, `report.reason:"Only 75.4% of the removed area is ever uncovered; 0.70% of the frame is never seen."`, `report.calls:2`.

## Measured (November 2026)
| Shot | Method | Range | Time | Cost |
|---|---|---|---|---|
| Estate, 1080p24, gardener (`estate-seedance25.mp4`) | Bria, 2 calls | 8.04 s | 137 s end to end (116 s erasing) | **$1.13** |
| Same shot, earlier founder test | Bria, 1 call | 5 s | 53 s | $0.70 |
| Same shot, free compositor only (before the fallback) | Clean plate | 8.04 s, 193 frames | 44 s | $0, but 0.70% of the frame was never uncovered and its fill showed |

The SAM layer itself: 193 frames, $0.04, 89 s.

## Limits
- Static camera only for the free plate. A handheld drift above ~9 px at 1080p goes to Bria.
- A shadow is not part of the SAM mask. Raise `dilate` (free plate) or segment the shadow.
- Something the subject holds far from its body (shears raised overhead) stays unless it has its own layer. SAM 3.1 may not segment thin objects at all: two attempts on the gardener's shears found nothing (each still cost ~$0.04).
- Bria's fill can leave a faint, softer patch, and its tone can shift slightly at a 5 s chunk boundary.
- After removeObject, layerEffect and textBehind on the same clip use the clean plate as their footage. Apply removeObject first: it refuses while other Genesis clips are stacked on the footage, since they copy the original.
- Up to 60 s per render; up to 4 layers per call.
