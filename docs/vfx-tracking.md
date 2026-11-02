# Pixel tracking

`trackPoints` tracks visible source pixels in the media processor. It accepts a footage clip, a timeline seed time and a normalized source point/box. An `inspectFrames` target ID can supply a box within the same tool session. A short noun uses the existing Gemini `inspectFrames` job once to localize a box, then runs the same pixel tracker. There is no SAM dependency.

```json
{
  "footageClipId": "footage-id",
  "time": 2,
  "start": 0,
  "end": 6,
  "seed": { "kind": "point", "x": 0.313, "y": 0.652 }
}
```

Other seeds are `{ "kind": "box", "box": { "left": 0.3, "top": 0.6, "right": 0.35, "bottom": 0.7 } }`, `{ "kind": "target", "targetId": "..." }` and `{ "kind": "object", "noun": "white electrical outlet" }`. All tool times are timeline seconds. Returned sample and stop times are source seconds.

The result includes a reusable `trackId`, actual decoded frame ordinals/PTS, normalized x/y, confidence, and seed-relative scale/rotation for boxes. Box samples include their current axis-aligned bounds. Each direction reports a stop reason: boundary, cut, occluded, out-of-frame or unreliable. A shot is bounded to 30 source seconds and 3600 decoded frames per request. Results remain on the existing derivation row for reuse in later tool calls.

Use `attachToTrack` with `target:{trackId}` or give `target:{time,seed,start,end}` to measure and attach in one call. Text, graphics, images, solids and video use canonical motion keys. A glow can be an image or styled overlay. Offsets are canvas fractions. Smoothing is a symmetric three-tap filter (0 to 1, default .35); `followTransform:false` keeps overlay size/orientation fixed. Pixel paths stay dense instead of being thinned to the ordinary 120-key tool budget. The overlay hides outside the measured path. Attachment returns the measured range, minimum confidence and stop reasons. Mask mode maps into a synchronized source copy and hides that layer outside its measured range, including inverted masks. Existing subject and manual-point targets remain supported.

## Processor choice and limits

OpenCV pyramidal KLT fits the existing CPU processor and already installed shot-detection environment. It needs no GPU, model weights or new dependency download. Local features use forward/backward flow consistency, RANSAC similarity fitting and an original appearance template to reject drift. Same-frame template re-acquisition handles large jumps only when the match is distinctive and consistent. No missing frames are bridged. Global scene correspondence distinguishes camera pans from cuts, excluding gameplay HUD regions.

Pixels are decoded at full source resolution. Feature detection and optical flow use local source-resolution regions; reverse decoding retains at most twelve grayscale frames. PTS checks prevent average-FPS seeking from silently labeling the wrong decoded image. The Python job is bounded to four minutes; FFprobe has its own one-minute bound. Low texture, repeated appearances, motion blur, perspective changes and non-rigid deformation can stop a track early. Confidence measures tracking evidence, not semantic identity or a calibrated probability.

## Deployment

Nothing was deployed from this branch. Deploy the matching components together, with development and production credentials kept separate:

1. Rebuild the media processor image, including `scripts/track-pixels.py`, and restart the local development worker from the merged checkout. Pixel jobs require processor contract 25 or newer; an older worker leaves them queued.
2. Deploy Convex schema/functions for tracking derivations, task payloads/results and tools.
3. Deploy the agent runner, which bundles the editor toolkit and skills.
4. Deploy the frontend and the export image so dense key validation and tracked-mask visibility agree in preview and export. Export machines need the render changes, not Python/OpenCV tracking dependencies.

No required environment variables or model files are added. Optional `PIXEL_TRACK_PYTHON` selects a Python executable; otherwise the tracker uses `SCENE_DETECT_PYTHON`, then `.data/scene-detection/bin/python`. The shipped processor already installs the pinned OpenCV/NumPy environment. Noun localization uses the existing Gemini key/model configuration and needs working provider billing.

## Verification recorded 2026-11-01

- `npm run typecheck`, `npm run build` and the agent-runner typecheck passed.
- Used real 1920x1080 Valorant gameplay from `mrjmac/valorant-auto-editor`'s public `output.mp4`, also importing a four-second range into a new throwaway project on development deployment `majestic-alpaca-541`. No existing project was edited and no video was exported.
- Point and box seeds held a wall outlet through 136 and 137 consecutive frames respectively during aim movement. The local point run on the imported source completed in approximately 3.7 seconds. The box run reported changing scale/rotation, used measured global camera motion to verify large aim jumps, and stopped as the support region left the frame.
- A separate real-shot run stopped at source 5.337979 seconds with reason `cut`, matching the independently measured cut.
- Saved a bounded measured path through the existing `animateClip` tool and rendered it with `getFrames`. Captured the new dense overlay/mask composition at full 1920x1080 with the shared renderer. All four sampled preview/export images were pixel-identical; samples outside the tracked interval contained no visible overlay or masked layer.
- The new Convex queue round trip awaits deployment. Noun localization reached the existing provider but HTTP 402 blocked live localization verification. Explicit pixel tracking does not need that provider.
- A Linux container build was not attempted on the disk-constrained laptop. The allow-list build context includes the tracker, and the image runtime check verifies its entry point and OpenCV APIs.
