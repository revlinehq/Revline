---
name: "genesis"
description: "Genesis masking with Meta SAM 3.1 (MCP only): segment a subject once into a tracked layer, then colour only it, grade, blur, glow or outline it, put a title behind it, remove it, change only its speed, or replace a tracked surface. Read before segment, layerEffect, textBehind, removeObject, retimeLayer or replaceSurface."
---
# Genesis

One `segment` call makes one **layer**: SAM 3.1 tracks the subject through the clip, and the worker saves a per-frame mask (a transparent cut-out on the source clock), the box of that mask's opaque pixels on every frame, `model: sam-3.1` and the cost. Every layer function reuses that layer. The masking is never run again.

## Workflow
1. `inspectTimeline` → the footage `clipId`. `readFrames` 1–3 stills → pick a frame where the subject is whole and unblocked.
2. `segment {clipId, prompt, at}` → `layerId`. Prompt, best first:
   - `{box:{left:.38,top:.12,right:.66,bottom:.98}}`: normalized SOURCE coordinates from the still. Most reliable.
   - `{point:{x:.52,y:.4}}`: on the subject's torso, not an edge.
   - `{noun:"skateboarder"}`: SAM 3.1 must find exactly **one** match on frame `at`. "person" in a crowd fails; use a box.
   - The mask is what SAM 3.1 calls the subject. It can leave out what the subject holds: "gardener in white" gave the man without his raised shears. A box around both kept only part of the shears. Check the cut-out with `getFrames` before relying on a held object.
3. `getLayer {layerId}` every 15 s until `status: "ready"`. Measured: 10 s of 720p at 24 fps = 237 frames, **$0.05**, 142 s. 5 s = 126 frames, **$0.03**, 133 s. `costUsd` is the real price of the frames SAM processed.
   - `coverage.visibleFrames / coverage.frames` below 0.8 means the subject was lost. Segment again with a box at a later `at`.
   - `boxes` lists every mask frame: `boxes.boxes[k]` is `[left, top, right, bottom]` (normalized, `null` while hidden) at SOURCE second `boxes.from + k / boxes.fps`. It always matches the cut-out's pixels. A call returns up to 720 frames; pass `from`/`to` (SOURCE seconds) for part of a layer, and continue from `boxes.next`.
   - To make an overlay follow the subject frame-exactly, map each box to the timeline: `clip.start + (sourceSecond - clip.sourceStart) / playbackRate` of the footage clip (without a speed ramp).
4. Apply functions (examples below) in any order. Each returns new clip IDs stacked directly above the footage, always in the order footage < colour/blur plates < titles < subject cut-outs. Example: `colorOnly` then `textBehind` gives V1 footage, V2 grey plate, V3 title, V4 subject (one subject copy, reused).
5. `getFrames` at the moment the subject moves fastest, plus one frame either side. Use `resolution:1080` for edges. Check that the edges hug the subject (≤ 3 px halo) and nothing pops. If a batch made only of the clip's last frames fails with `zero_output`, add an earlier time (e.g. `0`) to the same call.
6. `finish`. It checks every layer the timeline uses: through layer functions, as a clip, or as scene media. It fails until each one is ready, covers what plays, stays in sync with its footage and was checked with getFrames after your last edit.

## Functions
| Want | Call |
|---|---|
| Colour only the subject, rest black and white | `layerEffect {layerId, effect:"colorOnly"}` (`amount:.7` keeps 30% colour) |
| Warm up only the subject | `layerEffect {layerId, effect:"grade", exposure:.2, temperature:25}` |
| Darken the background | `layerEffect {layerId, effect:"grade", target:"background", exposure:-1.2}` |
| Portrait background blur | `layerEffect {layerId, effect:"blur"}` (`amount` 0–1, default .45) |
| Soften only the subject (dream look) | `layerEffect {layerId, effect:"blur", target:"subject", amount:.3}`. Not for hiding faces or plates: the sharp edge shows through. Use a tracked `setMask` blur for that. |
| Neon halo | `layerEffect {layerId, effect:"glow", color:"#36F9F2", glow:28}` |
| Gameplay player outline | `layerEffect {layerId, effect:"outline", color:"#FF3B30", width:4}` |
| Title behind the subject | `textBehind {layerId, text:"MONDAY", y:.3}` |
| Remove the subject from the shot | `removeObject {layerIds:[layerId]}`: free clean plate when the camera is static and the subject uncovers everything, otherwise Bria Video Eraser at $0.14/s. Page `remove`. |
| Slow down only the subject | `retimeLayer {layerId, speed:.5, alignAt:4}` (or a `preset`/`anchors` ramp). Page `speed`. |
| Put a screenshot on a phone screen or sign | `replaceSurface {clipId, assetId, at, corners:[[x,y]×4], occluderLayerIds:[handLayerId]}`; the hand stays in front. Page `replace`. |

## Rules
1. One subject per layer. Two players means two `segment` calls and two `layerEffect` calls.
2. Masks cover the source range of the clip they were segmented from, plus 0.25 s on each side. To apply to only part of a clip, `split` the footage at the range first, then pass the piece's `clipId`.
3. Do not trim, move or change the speed of the footage after applying. Copies are synced at apply time, and finish fails on a 1-frame drift. To retime, `undoLatestEdit` the Genesis edit, change the footage, then apply again (the layer is reused free).
4. textBehind needs the subject to overlap the letters. For a talking head, use `y:.25–.35` and ≤ 10 characters on one line (fontSize defaults to ~90% of the width).
5. Masks come from SAM 3.1 alone. If MODEL_API_KEY is missing on the worker, `segment` fails clearly. It never falls back to SAM2. Report it with `reportIssue`.
6. Fast motion blur and hair give soft edges. If `getFrames` shows a halo above 3 px, use `glow` or `outline` to hide the edge, or choose a different shot.
7. A cut-out used as scene media is checked from the scene's `<video>` timing. Write the same literal `data-start`, `data-offset` and `data-rate` on every `<video>` of that scene (e.g. `data-start="0" data-offset="0"`); computed or looped timing cannot be checked, and finish warns.
8. removeObject, retimeLayer and replaceSurface render on the media worker: the first call returns `processing`; call again with the same input every 15–20 s until it applies. Their results report `method` and the real `costUsd`. Only removeObject and retimeLayer can pay (Bria, within a monthly allowance); replaceSurface is always free.
9. Order on one footage clip: removeObject first, then other functions. retimeLayer stands alone on its clip in v1.

## Pages
- `remove`: removeObject methods (free clean plate, then Bria), allowance, measured costs and limits.
- `speed`: retimeLayer timing (speed, ramps, alignAt), the stack and its limits.
- `replace`: replaceSurface corners, tracking, occluders, light match and limits.
