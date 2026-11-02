# Stream clipping tools

The clipping skill uses the following tools by default when producing clips. Moment discovery alone remains read-only.

## Facecam regions

`detectFacecam({ assetId })` queues the `facecam` media-analysis mode. The processor samples original-resolution frames across the source, up to 80 frames, and detects faces with the existing local MediaPipe runtime. OpenCV combines persistent edges from nearby native frames to find a fixed webcam rectangle around a face, then chooses the largest unobscured gameplay rectangle. The detector never substitutes a face box for the panel. Results are saved with source analysis and exposed by `inspectAssetAnalysis`.

Each sample has a source time, normalized `x/y/w/h` rectangles, confidence, and one of `overlay`, `creator-only`, `gameplay-only`, or `uncertain`. A missing facecam is explicit. An uncertain panel falls back to `followSubject mode:"face"` or a wider view; creator-only sources retain one view. Sampling does not establish the exact time of a layout change between observations.

`applyLayout({ layout: "two-rows", detectedRegions: true, topClipIds, bottomClipIds })` crops and places the creator above gameplay using those regions. It preserves source timing and sound. It refuses low-confidence, missing, or changing overlay layouts. Single-view sources use one video instance. Static transform limits now accommodate enlarging corner webcam panels; the existing minimum visible source area still applies.

## Active speakers

`followSubject({ clipId, mode: "active-speaker" })` requests analysis of the clip's retained source window, up to 120 source seconds. `analyzeMedia` also accepts mode `speakers` with source `start/end`. Use cover fit on full-frame speaker footage.

The processor reuses diarized transcript words when available. Otherwise it transcribes only the requested window with Deepgram diarization. Local MediaPipe Face Landmarker measures mouth opening and articulation at 10 fps. Articulation is correlated with diarized word/turn timing and compared between co-visible faces. Short backchannels below 800 ms do not establish a match. Uncertain, competing or offscreen matches remain null. Single-face spans can fall back to following the sole visible face, without asserting its voice identity. Reframes use a 600 ms ease, a movement deadband, and minimum speaker dwell, rather than switching on every interjection.

Saved speaker evidence includes analyzed source `start/end`, turns, confidence, and focus samples. `identityScope: "source"` means IDs came from the source transcript; `"window"` means IDs are local to that window. Do not equate window-local IDs across separate analyses. The most recent analyzed window is cached on the asset. Each analysis request also receives its own result, so concurrent requests for different windows cannot consume each other's evidence. Applied crop paths remain on their clips.

The existing 5,000-word transcript limit remains in place. Speaker analysis does not replace a full source transcript with a partial transcript. Silence, offscreen speech, and uncertain identity do not fabricate visible speakers.

## Social loudness

`normalizeAudio({ clipId? })` defaults to -14 LUFS integrated and a true-peak ceiling of -1 dBTP. Omit `clipId` for the complete timeline mix, or select an audio clip or a video with linked sound. `enabled: false` removes normalization without processing. Targets can be customized within the tool's bounds.

The processor decodes retained timing, constant playback speed, volume, fades, and voice-driven music ducking through the shared audio-analysis path. Float PCM preserves overloaded mixes until processing. FFmpeg runs measured loudness normalization, with corrective passes when short, peaky speech misses the initial offset. The actual stored 48 kHz PCM WAV is measured before acceptance. Half a decibel of codec headroom is retained below the requested ceiling.

Preview, live preview updates, sound inspection, browser export, and FFmpeg export use the same normalized audio projection. Source clips, reciprocal links, transcript evidence, and authored sound controls remain editable. Timing or mix changes invalidate the old projection and restore playback of the authored mix. `inspectTimeline` reports whether normalization is active. Finishing the clip runs normalization again. Identical requests reuse valid normalization.

Timeline normalization supports up to ten minutes. Speed-ramped audio and scene-embedded media sound are rejected rather than silently normalized incorrectly. Put scene sound on audio tracks first. Silent or unmeasurable ranges fail without editing. Encoded exports additionally measure true peak and correct AAC overshoot when necessary.

Alternate audio is included in ownership validation, undo/revisions, shared media, project copies, export snapshots, and deletion guards. Approved sound remains protected by the normal approved-work checks.

## Release requirements

No new npm or Python packages are required. The existing OpenCV/NumPy environment, Chromium and MediaPipe SDK are reused. The pinned `public/vendor/face-landmarker.task` model bundle is new and must be included in the processor image. Speaker diarization uses the existing `DEEPGRAM_API_KEY`; noun grounding uses the existing `FAL_KEY`. Local facecam/speaker vision and explicit pixel seeds require no Gemini key.

`MEDIA_VISION_GEMINI_FALLBACK=true` explicitly enables an optional paid fallback when a working Gemini key is available. It defaults off. Provider failures leave local results usable; rejected billing/authentication keys are not repeatedly retried in the same process. The Cloudflare controller now starts without a Gemini key.

Deploy the Convex schema and functions, the agent runner containing the toolkit and skill text, the frontend containing the live playback projection, and the Cloudflare media processor image plus edge controller at contract 27. Contract 27 combines clipping, montage VFX/parallax and uncapped streamed pixel tracking. Fly export workers and render chunks must also run the rebuilt `exports` image before consuming these exports; update `FLY_RENDER_IMAGE` on the matching Convex deployment. The processor, edge controller, export consumer and Convex use the shared version in `lib/media-analysis/processor-version.ts`. Version gating keeps older processors from claiming these jobs. Development and production deployments retain their separate backend credentials.

This branch does not deploy any service. For local development, restart the media worker from this checkout after the development schema/functions are installed; the running server on port 3001 was not restarted. Keep development (`majestic-alpaca-541`) and production (`different-gnu-398`) credentials separate.

## Earlier branch inspection

Real development stream assets were read without modifying their projects. The processor's audio path measured:

| Source | Input LUFS | Output LUFS | True peak |
| --- | ---: | ---: | ---: |
| Original gaming stream excerpt | -33.09 | -14.10 | -1.50 dBTP |
| Retained eight-second section at 1.25x speed | -32.60 | -14.22 | -1.50 dBTP |

Deepgram returned measured diarization and MediaPipe tracked a visible person across 24 samples of the real duo stream. A full-resolution 1080 by 1920 preview inspection confirmed two 1080 by 960 row apertures and playback from one normalized WAV with both duplicate video audio streams muted. That geometry inspection used panel edges observed in the original frame; it does not establish automatic facecam detection accuracy.

The earlier branch was blocked by Gemini HTTP 402. The local vision implementation below replaces those required provider paths. New tool queue round trips still require deployment of the matching schema/functions. No video was exported, no service was deployed, and no new tool was run against an existing user project.

## Local vision verification, 2026-11-02

Created development project `j9756x5tv2qpg0jsy2p4vhm77x8hf275` solely for these checks and uploaded three real inputs. No existing project was edited, no video was exported and no service was deployed. The shared processor functions were run locally with the Gemini key removed from the process. New queue/tool round trips await deployment; uploading inputs used the already deployed upload API.

- Real Caseoh stream excerpt, native 1280x720: measured webcam panel `(x=0, y=91, width=258, height=195)` with confidence 0.762. The unobscured gameplay rectangle is `(258, 0, 1022, 720)`. Of three layout samples, one was a fixed overlay, one was uncertain near a change, and the final sample was creator-only. The uncertain sample requests face-follow/wider framing rather than inventing a panel.
- Real two-person [Syntax podcast](https://www.youtube.com/watch?v=-f2ql_aGIbs), source 45-105 seconds, native 1920x1080: Deepgram returned 198 words and two audio identities. MediaPipe sampled 600 frames at 10 fps; 343 contained two visible faces. Five of nine sustained turns were associated with the correct left/right face in inspected native frames; four remained unresolved. Match confidence ranged from 0.717 to 0.760. The final processor run took 129.1 seconds and produced 100 smooth focus samples, including sole-visible-face fallback without changing unresolved voice identities. Scores are heuristics, not calibrated probabilities.
- Real [Valorant gameplay](https://github.com/mrjmac/valorant-auto-editor/blob/master/output.mp4), native 1920x1080: one-frame Florence-2 grounding localized an electrical outlet at measured source 2.006969 seconds, followed by 136 dense samples over 1.895470-3.777003 seconds. Minimum tracking confidence was 0.592. The tracker stopped backward at occlusion and forward at frame exit. The final run took 40.7 seconds including the fal queue; no Gemini request was made. Grounding provenance/box is returned in `getTrack` summary.grounding.

Florence also produced a false positive for an absent noun. The skill and tool now explicitly require inspecting the proposed box; a detector response alone is not proof of object identity or absence. Explicit inspected point/box seeds remain the free path. The local facecam/speaker paths add no provider charge beyond any missing Deepgram diarization.

Verification passed: web typecheck, agent-runner typecheck, Next.js production build, Convex codegen and validation-enabled schema export (67 tables). The allow-list container context includes contract 27, both tracking/facecam Python entry points and the pinned 3,758,596-byte Face Landmarker bundle. Linux images were not built or deployed during this task.
