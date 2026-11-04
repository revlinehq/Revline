# Stream clipping tools

The clipping skill uses the following tools by default when producing clips. Moment discovery alone remains read-only.

## Whole-source highlight discovery

`findHighlights({assetId,delivery:"clips"|"candidates",sourceType?,count?})` asks Gemini to watch/listen and judge the source through the existing `lib/media-analysis/gemini.ts` upload/interaction path used by `inspectVideo`. Funny, hype, quotable, strong-opinion and complete story/question-answer moments are ranked using the clipping rubric: hook 25, payoff 25, clarity 20, surprise 20, quotability 10. A Gemini score of 65 qualifies for editorial review; a loud moment alone never qualifies.

Sources up to 30 minutes use one video judgment. Longer sources use 30-minute windows, with 60 seconds of forward context overlap, at concurrency two. An 8:16 source needs one window; a 56:27 podcast needs two; a three-hour source needs six. All windows must succeed for a Gemini ranking. When Gemini is unavailable, the worker returns transcript/RMS/cut helpers and the reason, and persists #55's same-run provider latch. The agent stops further Gemini calls, reviews the timed transcript and targeted source frames, then registers its found moments with planClips before accepting and delivering them. This adds no provider Gateway fallback.

The diarized transcript and a single FFmpeg audio decode provide cheap helpers: timed words and half-second RMS peaks/silences relative to a rolling 60-second baseline. They help Gemini orient and snap clean thought starts, sentence endings and pauses after the observed payoff/reaction. They do not independently score candidates. On fallback, the editing agent applies the same rubric to the transcript/context and checked source frames. Discovery adds no Python packages, classifier, model file, chat replay or face-reaction scoring.

Successful judgments are saved in versioned `analysis.highlights` on the shared owner/source record. Version 3 distinguishes `judge:"gemini"` from `judge:"fallback"`. A fallback cache is reused within the latched run; a new run tries Gemini again. Individual successful windows reuse main's private R2 artifact cache, scoped to source, window, model, helper inputs and requested source type. A count change reuses the same judgments. A source-type change rejudges with that context. Existing playback proxies and local source/proxy cache avoid repeated full-resolution transfer/encoding.

## Clip delivery and checkClip

`planClips` registers agent-found fallback moments only when the ledger records Gemini unavailability, grounds spoken hook/payoff quotes against saved word timings, then persists accepted candidate IDs/titles/source ranges and dropped reasons in `clippingRuns`. Its original tab fingerprints are retained across continuations. Default count is `min(10, qualifying, max(3, round(seconds/150)))`, further bounded by available tab slots. A quality shortfall is reported, never padded. Dropping a built candidate removes only its new, unapproved abandoned tab after the agent opens another retained/original tab.

`checkClip({timelineIds?})` checks the actual tab snapshot: source coverage, populated video, 9:16, 15–60 seconds, word/thought starts, payoff/reaction tails and pauses, current verified normalization measurements, and conservative caption/face/HUD geometry. FFmpeg blackdetect/freezedetect plus decode diagnostics inspect each distinct source range in one pass. Intentional black/static scenes need a recorded review reason; corruption cannot be waived. Source-range health does not certify compositing artifacts in every rendered frame.

One contact sheet shows shot starts/middles/ends and layout/speaker switches (usually 6–12 samples; cut-heavy clips get more). Sparse extraction shares one renderer session and does not render the intervening frames. Finished clips are never checked with 10 fps agent sweeps. The agent glances at this sheet once and fixes framing if needed.

Only worker completion issues a check receipt. `clipping:completionState({ownerId,projectId,runId,timeline?,timelineId?})` recomputes data checks and compares accepted choices to actual created/changed tabs and fresh passing receipts. Missing, extra, empty, wrongly named/ranged/formatted or stale tabs block completion. Stable MCP lane tasks use `EditorToolkitOptions.taskId` (`mcp-task:<uuid>`) as the exact ledger runId; legacy MCP calls use one project-scoped `mcp-clipping` ledger. The in-app final message is generated from the validated delivered tab list, including dropped reasons and the brief fallback disclosure. Independent checkClip jobs are queued at concurrency two; source frame pixels reuse the revision-scoped R2 cache.

Discovery uses the existing FFmpeg/Gemini runtime. The one framing sheet reuses main's revision-scoped R2 timeline frame cache; its worker receipt still checks the current source/timeline data.

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

Highlight discovery adds no Python packages or models. Existing framing reuses Chromium and MediaPipe. The pinned `public/vendor/face-landmarker.task` model bundle is new and must be included in the processor image. Speaker diarization uses the existing `DEEPGRAM_API_KEY`; noun grounding uses the existing `FAL_KEY`. Local facecam/speaker vision and explicit pixel seeds require no Gemini key.

`MEDIA_VISION_GEMINI_FALLBACK=true` explicitly enables an optional paid fallback when a working Gemini key is available. It defaults off. Provider failures leave local results usable; rejected billing/authentication keys are not repeatedly retried in the same process. The Cloudflare controller now starts without a Gemini key.

Deploy the Convex schema and functions, the statically bundled agent runner containing the toolkit and skill text, the frontend, and the Cloudflare media processor image plus edge controller at contract 38. This adds Gemini highlight discovery and clip checks on top of the merged frame-cache (36) and resilient-worker (37) changes. Fly export workers and render chunks must also run the rebuilt `exports` image before consuming these exports; update `FLY_RENDER_IMAGE` on the matching Convex deployment. The processor, edge controller, export consumer and Convex use the shared version in `lib/media-analysis/processor-version.ts`. Version gating keeps older processors from claiming these jobs. Development and production deployments retain their separate backend credentials. Local verification keeps the worker paused while the shared backend is running a different release.

Production release remains pending. The November 3 verification below uses a private development backend and private Workers; shared development (`majestic-alpaca-541`) and production (`different-gnu-398`) remain separate and were not deployment targets.

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

Current local production-function checks used the complete 8:16 gaming source and 56:27 Syntax podcast. The direct Google upload returned HTTP 402 on both. Both calls now returned `judge:"fallback"` with saved word timings and RMS helpers (396 gaming words, 10,201 podcast words). The gaming helper/discovery path took 1.42 s with its complete cached preview, the podcast 9.45 s including full audio decode and cached long-window preparation. A second gaming call with the same-run unavailable reason skipped Gemini. These are local discovery checks, not end-to-end `/clip` app times or delivered-tab counts.

The previous hard-error behavior was superseded: HTTP 402 no longer blocks clipping. Worker completion and tools share #55's persisted provider latch; later Gemini calls are suppressed for that run. The agent must review source text/frames, register grounded fallback moments with planClips, then build and check every accepted tab. The final message includes the exact delivered list and "Gemini was unavailable; picks used transcript and audio."

The user subsequently authorized isolated verification deployments. Browser access now works. The first actual app run failed the delivery gate; the evidence and correction are recorded below. No merge is justified yet.

| App source | Before: chat send to last delivered tab | After: chat send to last delivered tab | Found / accepted / tabs / final message |
| --- | --- | --- | --- |
| 8:16 Florescent gaming | About 18 min (user report; saved old run: 70 tool calls, 38 model calls, one 15.10 s tab) | Post-fix run: 19m25s; two checked tabs (concurrent full podcast conversion) | Found 2 / accepted 2 / delivered 2; exact final list and fallback disclosure |
| 56:27 Syntax podcast | No comparable old app run measured | First import failed on disk exhaustion; recovered full-source conversion is running | Not verified |

## Isolated app verification, November 3, 2026

Provisioned `resolute-magpie-736` with reference `dev/sol/t3-b3c0c273-27f371c36fdc`, private media Worker `revline-sol-media-27f371c36fdc`, and private runner `revline-sol-runner-27f371c36fdc`. The app and local worker both reported ready on port 3327. Isolation support initially came from PR63 locally; after PR63 merged, main commit `1b45d70db565b9dfa3bf8311e4f4de0cb806952e` was merged into this branch, preserving both changelog entries. Shared dev was read only; production was not accessed. No export was requested or produced.

Gaming project `th725yjevp145b1jfnedjmgxn98hjg0a` borrows the real 495.821-second Florescent R2 source. Actual `assistant:send` used `/clip`, Terra low (confirmed in cost records), and the normal app lane. Initial cold setup required runtime links and scoped Deepgram/fal credentials, so its elapsed time is not a clean speed benchmark. Transcription's successful attempt took 27.8 seconds (Deepgram 2.6 seconds); playback preparation after restart took 63.1 seconds. Highlight discovery took 485.0 seconds including source transfer and overview encoding, then returned fallback evidence after Gemini HTTP 402.

Run `1793758260552-0.49097985496655905` exposed a missing capability: the skill required source `readFrames`, but the Clip lane excluded it. The agent reported that defect, then exhausted three finish checks without calling planClips. The ledger remained unreviewed with no found/accepted candidates or receipts and no delivered tabs. Final chat: `No timeline changes were saved. The clip task stopped after three failed finish checks: ["Review candidates and call planClips."]`. The lane now exposes `readFrames`; the post-fix app turn completed real source-frame reads through that lane. For that run only the isolated backend's unavailable Gemini key was disabled; fallback discovery took 46.1 seconds including source transfer. Local facecam analysis and source review proceeded. Full post-fix app delivery is still required.

Podcast project `th7cjvgxjenvrgazar44qh7fzh8hkmg7` imported the documented Syntax URL without altering an original project. Video/audio downloads completed, but remux failed and retries reported insufficient disk space. Disk availability reached roughly 113 MB, and diagnostic writes also failed with ENOSPC. Failed import retries were stopped; original downloads were retained. Only this checkout's regenerable build cache and incomplete remux were removed. When free space recovered to 4.7 GB, import task `s579csvrg7gfgembsmjk93z1s98hjx1g` was started with hard links to the same real downloads, avoiding redundant copies. Post-fix local typecheck passed. A second production build compiled successfully in 83 seconds, then was stopped during its TypeScript phase to avoid concurrent heavyweight builds; a full local build pass is not claimed. At that checkpoint neither full app gate was certified; the subsequent gaming completion is recorded below.

The requested app breakdown must record import, transcription, discovery, per-tab framing/normalization/checks and model turns from the same chat run. Cached stages must be labeled, not compared as cold work. Current optimizations: successful source judgments/helpers and source frames are reused, no whole-source frame sweep is prescribed, fixed single-speaker crops avoid unnecessary mouth matching, and checkClip queues independent tabs at concurrency two subject to worker fairness. Unchanged passing receipts are reused; explicit timelineIds can request rechecks. Source-wide facecam/shot work is never repeated per tab. Default optional embellishments remain off.

Main's lane registry exposes findHighlights/planClips/checkClip/finishClipping only in clip and its finish calls the persisted server ledger with the stable taskId. Finished clips use data checks and one contact sheet; no generic frame sweeps are added by lane completion.

PR64 main commit `ba12ec22984ec23f7c342f353a07a7336cbd4764` was subsequently merged, preserving full-resolution reference tracking, frame/background timing, highlight fallback task fields and clip snapshots. Combined contract 40 prevents older processors from claiming the newly gated tasks. Post-merge `npm run typecheck` passed; CI on the preceding `0aa425c7` revision passed. The running private worker has not yet been restarted for contract 40 while the recovered full-source import is active.

Gaming run `1793759605203-0.33701435696671356` completed in 1165.187 seconds (19m25s): **2 found / 2 accepted / 2 populated checked tabs**, no completion errors. The saved final message listed The Ace on Match Point (source 213.10–230.08s, 16.98s) and Knives Out Ace (104.84–120.38s, 15.54s), followed by “Gemini was unavailable; picks used transcript and audio.” Both duration/aspect/coverage/range/boundary/loudness/caption/decode checks passed. This is not a demonstrated speed improvement over the reported 18-minute, one-tab run: it ran alongside the full podcast conversion and included a boundary repair.

Measured gaming phases: fallback discovery 46.1s; facecam queue-to-completion about 93.7s; first normalization 6.2s and 4.9s; first checks 94.6s and 102.2s; boundary-repair normalization 13.5s; repeated checks 183.9s and 195.8s. Remaining elapsed time includes source-frame review, queueing, model turns and editing. The trace exposed redundant explicit checking of an unchanged passing tab. checkClip now filters explicit IDs against current fingerprint-validated receipts and returns reusedTimelineIds; changed/failed tabs still run worker checks. Runtime verification of that optimization and contract-40 deployment remain pending while the full podcast import converts.

Latest main `cb7ba3ca1590cca56d7a5f488d2bb50c09576f7b` was incorporated with both changelog entries preserved. The approved prototype remains separate from these real app runs. Post-contract-40 local typecheck passed before that merge; a later overlapping typecheck was stopped when the merge changed its source files. Exact-head CI is the remaining build/typecheck authority for the final integrated revision.
