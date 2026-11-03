# Stream clipping tools

The clipping skill uses the following tools by default when producing clips. Moment discovery alone remains read-only.

## Whole-source highlight discovery

`findHighlights({assetId, delivery:"clips"|"candidates", sourceType?, count?})` runs one source pass, then reuses versioned `analysis.highlights` on the shared owner/source analysis record. Type/count changes rerank without another decode or LLM call. The worker also caches intermediate CPU/text JSON so a retry after another phase fails can reuse completed work. No Gemini calls are made.

- Audio: 16 kHz CPU YAMNet (Google's Apache-2.0 AudioSet model, checksum pinned by `install-highlight-model.mjs`), half-second RMS against a rolling 60-second median, spikes, sudden quiet and six-second builds. Laughter/shouting/cheering/applause and short music stings retain their real event tails; continuous background music is excluded.
- Words: the whole diarized transcript is read in five-minute text chunks with 45 seconds of context overlap, at concurrency six. The model selects word-index spans; the worker derives exact quotes and times. Topic boundaries, fast exchanges and overlapping speakers are retained. The source type selects podcast/gaming/IRL/sports/talk weights; the user can override it. Missing optional modalities are excluded at source level, never per candidate.
- Audience: imports attempt a bounded public replay fetch for YouTube/Twitch/Kick and save only ten-second message counts. Disabled, unsupported or partial replay is explicit. Chat bodies and identities are discarded.
- Picture: sparse CPU face boxes gate regional change measurements. Whole-frame gameplay motion never adds highlight strength. Two-second keyframe samples provide coarse scene structure and can miss brief changes; they are not framing geometry or emotion recognition. Native frames remain the framing tools' input.

Clean ranges start at thought boundaries and finish in measured word pauses after the payoff/reaction; candidates with no complete 15–60 second range are excluded. An incomplete audio decode is rejected; missing visual coverage is reported explicitly instead of being described as measured. Scores are evidence-weighted candidates, not promised views; the clipping agent applies the existing editorial rubric to the top 8–10.

## Clip delivery and checkClip

`planClips` persists accepted candidate IDs/titles/source ranges and dropped reasons in `clippingRuns`. Its original tab fingerprints are retained across continuations. Default count is `min(10, qualifying, max(3, round(seconds/150)))`, further bounded by available tab slots. A quality shortfall is reported, never padded. Dropping a built candidate removes only its new, unapproved abandoned tab after the agent opens another retained/original tab.

`checkClip({timelineIds?})` checks the actual tab snapshot: source coverage, populated video, 9:16, 15–60 seconds, word/thought starts, payoff/reaction tails and pauses, current verified normalization measurements, and conservative caption/face/HUD geometry. FFmpeg blackdetect/freezedetect plus decode diagnostics inspect each distinct source range in one pass. Intentional black/static scenes need a recorded review reason; corruption cannot be waived. Source-range health does not certify compositing artifacts in every rendered frame.

One contact sheet shows shot starts/middles/ends and layout/speaker switches (usually 6–12 samples; cut-heavy clips get more). Sparse extraction shares one renderer session and does not render the intervening frames. Finished clips are never checked with 10 fps agent sweeps. The agent glances at this sheet once and fixes framing if needed.

Only worker completion issues a check receipt. `clipping:completionState({ownerId,projectId,runId,timeline?,timelineId?})` recomputes data checks and compares accepted choices to actual created/changed tabs and fresh passing receipts. Missing, extra, empty, wrongly named/ranged/formatted or stale tabs block completion. Stable MCP lane tasks use `EditorToolkitOptions.taskId` (`mcp-task:<uuid>`) as the exact ledger runId; legacy MCP calls use one project-scoped `mcp-clipping` ledger. The in-app final message is generated from the validated delivered tab list, including dropped reasons.

Local CPU setup: `uv venv .data/highlights`, `uv pip install --python .data/highlights/bin/python -r scripts/highlight-requirements.txt`, `node scripts/install-highlight-model.mjs`. Container builds install this runtime and validate the model before claiming new-contract work. Development and production credentials stay separate.

## Facecam regions

`detectFacecam({ assetId })` queues the `facecam` media-analysis mode. The processor samples original-resolution frames across the source, up to 80 frames, and detects faces with the existing local MediaPipe runtime. OpenCV combines persistent edges from nearby native frames to find a fixed webcam rectangle around a face, then chooses the largest unobscured gameplay rectangle. The detector never substitutes a face box for the panel. Results are saved with source analysis and exposed by `inspectAssetAnalysis`.

Each sample has a source time, normalized `x/y/w/h` rectangles, confidence, and one of `overlay`, `creator-only`, `gameplay-only`, or `uncertain`. A missing facecam is explicit. An uncertain panel falls back to `followSubject mode:"face"` or a wider view; creator-only sources retain one view. Sampling does not establish the exact time of a layout change between observations.

`applyLayout({ layout: "two-rows", detectedRegions: true, topClipIds, bottomClipIds })` crops and places the creator above gameplay using those regions. It preserves source timing and sound. It refuses low-confidence, missing, or changing overlay layouts. Single-view sources use one video instance. Static transform limits now accommodate enlarging corner webcam panels; the existing minimum visible source area still applies.

## Active speakers

`followSubject({ clipId, mode: "active-speaker" })` requests analysis of the clip's retained source window, up to 120 source seconds. `analyzeMedia` also accepts mode `speakers` with source `start/end`. Use cover fit on full-frame speaker footage.

The processor reuses diarized transcript words when available. Otherwise it transcribes only the requested window with Deepgram diarization. Local MediaPipe Face Landmarker measures mouth opening and articulation at 10 fps. Articulation is correlated with diarized word/turn timing and compared between co-visible faces. Short backchannels below 800 ms do not establish a match. Uncertain, competing or offscreen matches remain null. Single-face spans can fall back to following the sole visible face, without asserting its voice identity. Reframes use a 600 ms ease, a movement deadband, and minimum speaker dwell, rather than switching on every interjection.

Saved speaker evidence includes analyzed source `start/end`, turns, confidence, and focus samples. `identityScope: "source"` means IDs came from the source transcript; `"window"` means IDs are local to that window. Do not equate window-local IDs across separate analyses. The most recent analyzed window is cached on the asset. Each analysis request also receives its own result, so concurrent requests for different windows cannot consume each other's evidence. Applied crop paths remain on their clips.

Long sources support up to 100,000 timed words; transcripts over 4,000 words use owner/source-scoped chunks of 2,000 words in Convex. Speaker analysis does not replace a full source transcript with a partial transcript. Silence, offscreen speech, and uncertain identity do not fabricate visible speakers.

## Social loudness

`normalizeAudio({ clipId? })` defaults to -14 LUFS integrated and a true-peak ceiling of -1 dBTP. Omit `clipId` for the complete timeline mix, or select an audio clip or a video with linked sound. `enabled: false` removes normalization without processing. Targets can be customized within the tool's bounds.

The processor decodes retained timing, constant playback speed, volume, fades, and voice-driven music ducking through the shared audio-analysis path. Float PCM preserves overloaded mixes until processing. FFmpeg runs measured loudness normalization, with corrective passes when short, peaky speech misses the initial offset. The actual stored 48 kHz PCM WAV is measured before acceptance. Half a decibel of codec headroom is retained below the requested ceiling.

Preview, live preview updates, sound inspection, browser export, and FFmpeg export use the same normalized audio projection. Source clips, reciprocal links, transcript evidence, and authored sound controls remain editable. Timing or mix changes invalidate the old projection and restore playback of the authored mix. `inspectTimeline` reports whether normalization is active. Finishing the clip runs normalization again. Identical requests reuse valid normalization.

Timeline normalization supports up to ten minutes. Speed-ramped audio and scene-embedded media sound are rejected rather than silently normalized incorrectly. Put scene sound on audio tracks first. Silent or unmeasurable ranges fail without editing. Encoded exports additionally measure true peak and correct AAC overshoot when necessary.

Alternate audio is included in ownership validation, undo/revisions, shared media, project copies, export snapshots, and deletion guards. Approved sound remains protected by the normal approved-work checks.

## Release requirements

Highlight discovery adds the pinned Python packages in `scripts/highlight-requirements.txt` and the checksum-pinned YAMNet TFLite model. Existing framing still reuses Chromium and MediaPipe. The pinned `public/vendor/face-landmarker.task` model bundle is new and must be included in the processor image. Speaker diarization uses the existing `DEEPGRAM_API_KEY`; noun grounding uses the existing `FAL_KEY`. Local facecam/speaker vision and explicit pixel seeds require no Gemini key.

`MEDIA_VISION_GEMINI_FALLBACK=true` explicitly enables an optional paid fallback when a working Gemini key is available. It defaults off. Provider failures leave local results usable; rejected billing/authentication keys are not repeatedly retried in the same process. The Cloudflare controller now starts without a Gemini key.

Deploy the Convex schema and functions, the statically bundled agent runner containing the toolkit and skill text, the frontend, and the Cloudflare media processor image plus edge controller at contract 38. This adds highlight discovery and clip checks; 36/37 are reserved for the frame-cache and worker-failure branches. Fly export workers and render chunks must also run the rebuilt `exports` image before consuming these exports; update `FLY_RENDER_IMAGE` on the matching Convex deployment. The processor, edge controller, export consumer and Convex use the shared version in `lib/media-analysis/processor-version.ts`. Version gating keeps older processors from claiming these jobs. Development and production deployments retain their separate backend credentials. PR55's local capability exclusions must include `highlights` when the Python/model runtime is missing before an unpaused local worker advertises contract 38. That upstream change is not duplicated here; local verification kept the worker paused.

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

## Highlight verification, 2026-11-03

These are direct local worker/function inspections on real media, **not completed `/clip` chat-UI runs**. T3 preview was blocked by the host's AppArmor browser sandbox; the CUA connector exposed no browser. The requested new-project UI runs, UI screenshots and end-to-end accepted/tab/final-message checks remain outstanding. Shared dev was reserved for the worker-fix/lane branches; this branch was not deployed over them. No existing project was edited and no video was exported.

| Source | Duration | Signal/text result | Timing / provider use | UI accepted / created / final message |
| --- | --- | --- | --- | --- |
| [Syntax: A Look Back at Web Dev in 2025](https://www.youtube.com/watch?v=-f2ql_aGIbs) | 56:27 | 10,201 words, 12 text chunks; 61 distinct candidates after clean-boundary filtering; top 10 passed boundary data checks | 34 s earlier whole-source CPU/text pass; 17 s with cached CPU tracks; 25 ms repeated pass; zero Gemini | Not run / not run / unavailable |
| User's Florescent gameplay source in project `j977g9qkv5hbfhz8a7wd60w1p58hhk00` | 8:16 | 396 saved words, 2 text chunks; 8 candidates above the signal filter; recommended 3; top ranges passed boundary checks | Final cold pass 6.25 s, repeated pass 1 ms; zero Gemini | Not run / not run / unavailable |
| [CJAYRIDE: Toy Show Test Run, Taipei](https://www.youtube.com/watch?v=dmQxME6GVHA) | 3:32:15 | 5,427 words, 43 source chunks; 80 ranked candidates retained; source inferred talk, reranked as IRL without reanalysis | Final CPU pass with cached text 176.6 s; repeated pass 22 ms; zero Gemini | Not run / not run / unavailable |

The IRL source's last keyframe sample was at 12,726 s; the remaining 8.8 s has full audio/text evidence and an explicit visual-coverage warning. Chat replay was unavailable for the podcast (`NoChatReplay`), and skipped. These counts are pre-editorial candidates, not accepted clips or promises of quality. The signal/summary payloads including compact transcript metadata were 312 KB (podcast), 68 KB (gaming) and 511 KB (IRL), below the 900 KB analysis-row limit; long word timing arrays use separate chunks.

The old gaming chat is a useful historical baseline, not a rerun: persisted costs report 70 tool calls and 38 model calls; visible chat contains 4 inspectVideo requests (2 returned Gemini 402) and 25 getFrames calls. Its last assistant message was created at least 17m55s after `/clip` began. It delivered one tab, **The Ace**, source 213.30–228.40 s, duration 15.10 s, and said: “Created one vertical short, **The Ace**. I couldn’t reliably identify additional highlights, and audio normalization could not be confirmed. The opening facecam is cropped.”

New discovery ranks distinct material around 267.32–292.55 s, 71.96–95.91 s and 206.97–222.01 s near the top. These still need editorial review with the few requested source frames. Comparing a full old app turn with new discovery alone is not an end-to-end speed claim.

A read-only local `checkClip` inspection of the saved old **The Ace** tab passed duration, 9:16, populated source coverage and FFmpeg health; it correctly failed the unpaused speech out point and the missing persisted normalization measurement. Its one contact sheet showed the cropped facecam. No existing clip was changed to make this check pass. Empty/title-only/mismatched timelines were also rejected by direct data inspection. Tab fingerprint comparison was checked across reordered stored object keys.

Verified locally: `npm run typecheck`, `npm run build`, `npm run typecheck:agent-runner`, Python/YAMNet execution and the missing-chat path. The frontend and paused media worker both reached readiness on port 3056; both were stopped afterward. Port 3001 was left running. Live Convex ledger/receipt round trips and the matching deployed CF agent-runner bundle remain part of the outstanding dev-app verification.
