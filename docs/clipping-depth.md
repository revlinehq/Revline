# Stream clipping tools

The clipping skill uses the following tools by default when producing clips. Moment discovery alone remains read-only.

## Facecam regions

`detectFacecam({ assetId })` queues the `facecam` media-analysis mode. The processor samples original-resolution frames across the source, up to 80 frames, and asks Gemini for the webcam panel and useful gameplay rectangle. Results are saved with source analysis and exposed by `inspectAssetAnalysis`.

Each sample has a source time, normalized `x/y/w/h` rectangles, confidence, and one of `overlay`, `creator-only`, `gameplay-only`, or `uncertain`. A missing facecam is explicit. Sampling does not establish the exact time of a layout change between observations.

`applyLayout({ layout: "two-rows", detectedRegions: true, topClipIds, bottomClipIds })` crops and places the creator above gameplay using those regions. It preserves source timing and sound. It refuses low-confidence, missing, or changing overlay layouts. Single-view sources use one video instance. Static transform limits now accommodate enlarging corner webcam panels; the existing minimum visible source area still applies.

## Active speakers

`followSubject({ clipId, mode: "active-speaker" })` requests analysis of the clip's retained source window, up to 120 source seconds. `analyzeMedia` also accepts mode `speakers` with source `start/end`. Use cover fit on full-frame speaker footage.

The processor reuses diarized transcript words when available. Otherwise it transcribes only the requested window with Deepgram diarization. Gemini associates audible turns with visible face locations; null locations represent offscreen or uncertain matches. The existing MediaPipe tracker follows those seeded faces. Reframes use a 600 ms ease, a movement deadband, and minimum speaker dwell, rather than switching on every interjection.

Saved speaker evidence includes analyzed source `start/end`, turns, confidence, and focus samples. `identityScope: "source"` means IDs came from the source transcript; `"window"` means IDs are local to that window. Do not equate window-local IDs across separate analyses. The most recent analyzed window is cached on the asset. Each analysis request also receives its own result, so concurrent requests for different windows cannot consume each other's evidence. Applied crop paths remain on their clips.

The existing 5,000-word transcript limit remains in place. Speaker analysis does not replace a full source transcript with a partial transcript. Silence, offscreen speech, and uncertain identity do not fabricate visible speakers.

## Social loudness

`normalizeAudio({ clipId? })` defaults to -14 LUFS integrated and a true-peak ceiling of -1 dBTP. Omit `clipId` for the complete timeline mix, or select an audio clip or a video with linked sound. `enabled: false` removes normalization without processing. Targets can be customized within the tool's bounds.

The processor decodes retained timing, constant playback speed, volume, fades, and voice-driven music ducking through the shared audio-analysis path. Float PCM preserves overloaded mixes until processing. FFmpeg runs measured loudness normalization, with corrective passes when short, peaky speech misses the initial offset. The actual stored 48 kHz PCM WAV is measured before acceptance. Half a decibel of codec headroom is retained below the requested ceiling.

Preview, live preview updates, sound inspection, browser export, and FFmpeg export use the same normalized audio projection. Source clips, reciprocal links, transcript evidence, and authored sound controls remain editable. Timing or mix changes invalidate the old projection and restore playback of the authored mix. `inspectTimeline` reports whether normalization is active. Finishing the clip runs normalization again. Identical requests reuse valid normalization.

Timeline normalization supports up to ten minutes. Speed-ramped audio and scene-embedded media sound are rejected rather than silently normalized incorrectly. Put scene sound on audio tracks first. Silent or unmeasurable ranges fail without editing. Encoded exports additionally measure true peak and correct AAC overshoot when necessary.

Alternate audio is included in ownership validation, undo/revisions, shared media, project copies, export snapshots, and deletion guards. Approved sound remains protected by the normal approved-work checks.

## Release requirements

No new dependencies or environment variables are introduced. The processor needs the existing `GOOGLE_GENERATIVE_AI_API_KEY` and `DEEPGRAM_API_KEY`, alongside its existing media-storage credentials, FFmpeg, Chromium, and vendored MediaPipe assets.

Deploy the Convex schema and functions, the agent runner containing the toolkit and skill text, the frontend containing the live playback projection, and media processor image contract 26. Contract 26 combines clipping, montage VFX/parallax and uncapped streamed pixel tracking. Export workers must also run the updated image before consuming these exports. The processor, edge controller, export consumer and Convex use the shared version in `lib/media-analysis/processor-version.ts`. Version gating keeps older processors from claiming these jobs. Development and production deployments retain their separate backend credentials.

This branch does not deploy any service.

## Runtime inspection

Real development stream assets were read without modifying their projects. The processor's audio path measured:

| Source | Input LUFS | Output LUFS | True peak |
| --- | ---: | ---: | ---: |
| Original gaming stream excerpt | -33.09 | -14.10 | -1.50 dBTP |
| Retained eight-second section at 1.25x speed | -32.60 | -14.22 | -1.50 dBTP |

Deepgram returned measured diarization and MediaPipe tracked a visible person across 24 samples of the real duo stream. A full-resolution 1080 by 1920 preview inspection confirmed two 1080 by 960 row apertures and playback from one normalized WAV with both duplicate video audio streams muted. That geometry inspection used panel edges observed in the original frame; it does not establish automatic facecam detection accuracy.

The configured Gemini service returned HTTP 402, preventing completion of real facecam localization and audiovisual speaker matching. Those provider-dependent paths and the newly queued tools still need an end-to-end check after deployment and provider availability. No video was exported, no service was deployed, and no new tool was run against an existing user project.
