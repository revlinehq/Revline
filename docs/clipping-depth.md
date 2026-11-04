# Stream clipping tools

The clipping skill uses the following tools by default when producing clips. Moment discovery alone remains read-only.

## Whole-source highlight discovery

`findHighlights({assetId,delivery:"clips"|"candidates",sourceType?,count?})` asks Gemini to watch/listen and judge the source through the existing `lib/media-analysis/gemini.ts` upload/interaction path used by `inspectVideo`. Funny, hype, quotable, strong-opinion and complete story/question-answer moments are ranked using the clipping rubric: hook 25, payoff 25, clarity 20, surprise 20, quotability 10. A Gemini score of 65 qualifies for editorial review; a loud moment alone never qualifies.

Sources up to 30 minutes use one video judgment. Longer sources use 30-minute windows, with 60 seconds of forward context overlap, at concurrency two. An 8:16 source needs one window; a 56:27 podcast needs two; a three-hour source needs six. All windows must succeed for a Gemini ranking. When Gemini is unavailable, the worker returns transcript/RMS/cut helpers and the reason, and persists #55's same-run provider latch. The agent stops further Gemini calls, reviews the timed transcript and targeted source frames, then registers its found moments with planClips before accepting and delivering them. This adds no provider Gateway fallback.

The diarized transcript and a single FFmpeg audio decode provide cheap helpers: timed words and half-second RMS peaks/silences relative to a rolling 60-second baseline. They help Gemini orient and snap clean thought starts, sentence endings and pauses after the observed payoff/reaction. They do not independently score candidates. On fallback, the editing agent applies the same rubric to the transcript/context and checked source frames. Discovery adds no Python packages, classifier, model file, chat replay or face-reaction scoring.

Successful judgments are saved in versioned `analysis.highlights` on the shared owner/source record. Version 3 distinguishes `judge:"gemini"` from `judge:"fallback"`. A fallback cache is reused within the latched run; a new run tries Gemini again. Individual successful windows reuse main's private R2 artifact cache, scoped to source, window, model, helper inputs and requested source type. A count change reuses the same judgments. A source-type change rejudges with that context. Existing playback proxies and local source/proxy cache avoid repeated full-resolution transfer/encoding. The immutable source-byte cache is scoped to backend, owner and blob metadata, so authorized project copies reuse bytes; legacy project-scoped entries migrate without another physical copy. Every read still requires the current project/owner lease.

Sparse source context uses `readFrames({times:[...],stillsOnly:true})`: up to 12 explicit SOURCE times per clip-lane call, without the default 10 fps motion analysis. Review the transcript shortlist in batched grids and reuse those stills for framing.

## Clip delivery and checkClip

`planClips` registers agent-found fallback moments only when the ledger records Gemini unavailability, grounds spoken hook/payoff quotes against saved word timings, then persists accepted candidate IDs/titles/source ranges and dropped reasons in `clippingRuns`. Its original tab fingerprints are retained across continuations. Default count is `min(10, qualifying, max(3, round(seconds/150)))`, further bounded by available tab slots. A quality shortfall is persisted as `shortfallReason` (20–500 characters) or concrete dropped-candidate reasons, independently checked at completion and included in the final reply; it is never padded. Dropping a built candidate removes only its new, unapproved abandoned tab after the agent opens another retained/original tab.

`checkClip({timelineIds?})` checks the actual tab snapshot: source coverage, populated video, 9:16, 15–60 seconds, word/thought starts, payoff/reaction tails and pauses, current verified normalization measurements, and conservative caption/face/HUD geometry. FFmpeg blackdetect/freezedetect plus decode diagnostics inspect each distinct source range in one pass. Intentional black/static scenes need a recorded review reason; corruption cannot be waived. Source-range health does not certify compositing artifacts in every rendered frame.

One contact sheet shows shot starts/middles/ends and layout/speaker switches (usually 6–12 samples; cut-heavy clips get more). Sparse extraction shares one renderer session and does not render the intervening frames. Finished clips are never checked with 10 fps agent sweeps. The agent glances at this sheet once and fixes framing if needed.

Only worker completion issues a check receipt. `clipping:completionState({ownerId,projectId,runId,timeline?,timelineId?})` recomputes data checks and compares accepted choices to actual created/changed tabs and fresh passing receipts. Missing, extra, empty, wrongly named/ranged/formatted or stale tabs block completion. Stable MCP lane tasks use `EditorToolkitOptions.taskId` (`mcp-task:<uuid>`) as the exact ledger runId; legacy MCP calls use one project-scoped `mcp-clipping` ledger. The in-app final message is generated from the validated delivered tab list, including dropped reasons and the brief fallback disclosure. Independent checkClip jobs are queued at concurrency two; source frame pixels reuse the revision-scoped R2 cache.

Co-visible speaker windows can be analyzed two at a time before tab creation; followSubject reuses each exact window in the same toolkit and retains shot/speaker cuts on the applied clip. Independent checkClip jobs run at concurrency two. Pending imports wait inside getMediaTask for up to 30 seconds rather than spending model turns on immediate polling. The app withholds finish until unresolved edit failures are repaired, before closing the lane's tools.

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

Deploy the Convex schema and functions, the statically bundled agent runner containing the toolkit and skill text, the frontend, and the Cloudflare media processor image plus edge controller at contract 41. This combines highlight/clip contract 38 with main's reference-motion runtime 39; version 41 also transports long transcripts in 2,000-word batches, keeping old images from claiming jobs they cannot hydrate. Fly export workers and render chunks must also run the rebuilt `exports` image before consuming these exports; update `FLY_RENDER_IMAGE` on the matching Convex deployment. The processor, edge controller, export consumer and Convex use the shared version in `lib/media-analysis/processor-version.ts`. Version gating keeps older processors from claiming these jobs. Development and production deployments retain their separate backend credentials. Local verification keeps the worker paused while the shared backend is running a different release.

For the user-authorized shared-DEV rehearsal, matching Convex functions and the DEV agent runner were deployed; production and port 3001 were untouched. Restart the media worker from this checkout after installing its schema/functions. Main's automatic release deploys the integrated image before Convex on merge. Keep development (`majestic-alpaca-541`) and production (`different-gnu-398`) credentials separate.

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

Earlier local production-function checks used the complete 8:16 gaming source and 56:27 Syntax podcast. The direct Google upload returned HTTP 402 on both. Both calls now returned `judge:"fallback"` with saved word timings and RMS helpers (396 gaming words, 10,201 podcast words). The gaming helper/discovery path took 1.42 s with its complete cached preview, the podcast 9.45 s including full audio decode and cached long-window preparation. A second gaming call with the same-run unavailable reason skipped Gemini. These are local discovery checks, not end-to-end `/clip` app times or delivered-tab counts.

The previous hard-error behavior was superseded: HTTP 402 no longer blocks clipping. Worker completion and tools share #55's persisted provider latch; later Gemini calls are suppressed for that run. The agent must review source text/frames, register grounded fallback moments with planClips, then build and check every accepted tab. The final message includes the exact delivered list and "Gemini was unavailable; picks used transcript and audio."

The user authorized real DEV editor turns through `assistant:send`, the same entry point used by app chat, with the normal Terra medium configuration. Browser automation is blocked by AppArmor; the user explicitly replaced browser verification with real editor turns plus saved timeline/frame inspection. No export was requested or produced. All edits are in new throwaway projects; the original gaming project is unchanged.

| Source | Before: send to final delivered list | After | Found / accepted / new passing tabs |
| --- | --- | --- | --- |
| 8:16 gaming | 17m54.853s; 38 model calls, 70 tool calls, 4 inspectVideo calls; one 15.10s tab | 7m34.316s; 24 model calls, 31 tool calls, one Gemini attempt returning 402 | 5 / 2 / 2; three explicit review rejections |
| 56:27 Syntax podcast | No comparable old full run measured | Contract-41 delivery verification in progress | Pending |

The gaming comparison uses the existing imported source and saved transcript (396 words). The new source/analysis proxy cache was warm; new per-project frame artifacts were cold. The old source-cache state is unknown, so this is an observed real-run comparison, not a controlled cold-cache benchmark. The new Ace Talk keeps the spoken setup at 206.8s that the old 213.3–228.4s clip omitted, and adds a second standalone moment. Neither run has captions or optional embellishments.

| Gaming stage | Wall time | Evidence |
| --- | --- | --- |
| Import / transcription | 0 / 0 | Existing source and saved timed words |
| Discovery | 2.9s | Warm source/proxy, RMS and one native Gemini 402 |
| Source context / framing review | 112.5s | Two concurrent sparse source grids; no 10fps motion map or new facecam scan |
| Normalize two tabs | 89.6s | Sequential tab edits; 16.4s measuring/processing, remaining time includes publication/upload |
| checkClip for two tabs | 76.1s | Concurrent source-health/data checks and one shot/switch sheet per tab |
| Model/tool orchestration, queue and final publication | 173.2s residual | 24 model calls; this residual is not a measured provider-only latency |

Gaming final message, generated from the backend-validated ledger:

> Delivered 2 clips:
> - Ace Talk: source 206.80-230.40s, 23.60s.
> - I'm Feeling It: source 136.68-152.18s, 15.50s.
> Dropped after review: Evenly Matched: Malformed word timing after the exchange prevents a clean, complete 15-second boundary without adding an unrelated sequence.; Please Save Me: The plea and reaction span multiple gameplay shots, making the outcome unclear.; Where Am I: The milk remark lacks clear context and its visual payoff is uncertain.
> Gemini was unavailable; picks used transcript and audio.

Earlier diagnostics are not passing final benchmarks: a cold gaming transfer/encode took most of a 15m52s trial; a later 14m20s integrated run passed two tabs but exposed hidden source motion scans and slow remote health reads. Those were corrected by forwarding stillsOnly into the worker and reusing authorized local source bytes for health scans. A separate podcast YouTube import spent about 21 minutes downloading and then failed the host disk-size budget; it is excluded from the successful uploaded-source benchmark and must not be described as a delivered run. The first uploaded podcast trial exposed Convex's 8,192-entry RPC array limit at 10,195 words. Contract 41 preserves all timed words across completion/query transport as well as storage chunks; the real podcast turn must prove this before merge.

Current checks: web typecheck, agent-runner typecheck and production build pass. DEV uses matching Convex functions and the statically bundled agent runner. Google native video still returns 402: the funded Gemini judgment path remains unverified. A successful fallback delivery does not certify funded Gemini behavior. Main's lane finish uses the stable taskId and requires both required:true and passed:true from the persisted ledger. Generic failed edits must be repaired before finish closes the tools. Final clip verification uses data checks and one contact sheet, with no dense finished-clip sweeps.

## Earlier isolated rehearsal preserved from 59d4aad4

This is the earlier isolated revision's historical record, retained with its screenshots and MCP evidence. The shared-DEV timings and current release requirements above supersede its speed and approval limits. These projects and processes belong to that earlier rehearsal.

### Isolated app verification, November 3, 2026

Both real `/clip` app runs completed on private development resources, using GPT-6.1 Terra with low reasoning. No export was requested or produced, and no original user project was edited. Gemini HTTP 402 was observed in actual discovery. The unavailable key was subsequently disabled only on the private backend, so the final runs exercise the explicitly disclosed transcript/audio/source-frame fallback. A successful Gemini judgment remains unverified.

### Resources and integrated contract

- Convex `resolute-magpie-736`, reference `dev/sol/t3-b3c0c273-27f371c36fdc`.
- Media Worker `revline-sol-media-27f371c36fdc`, URL `https://revline-sol-media-27f371c36fdc.makaradze98-s.workers.dev`.
- Agent runner `revline-sol-runner-27f371c36fdc`, URL `https://revline-sol-runner-27f371c36fdc.makaradze98-s.workers.dev`; deployed version `4ee06723-4482-41e3-9b1f-0b59bf58161d`.
- Local frontend `http://localhost:3327` and matching local media worker. Both reported ready after restart at 03:29:16/03:29:20 UTC November 4 (November 3 locally).

Main through `f76eba12ffd83b860a9fc71a444d0dab889165f0` is incorporated, including isolation, full-resolution reference tracking, the separate prototype, and MCP identity/presence/task scope. All changelog entries were retained. Combined contract 41 preserves tracker/worker fields and gates transcript, highlights, source reads, speaker and clip snapshot jobs. The live processor-contract query returned 41 and subsequent jobs completed on 41. The private backend/runner were deployed from `fa3cba84ea423d2c684e3b98669728dcf80b6fe8`; the subsequent bridge fix runs locally. Shared dev `majestic-alpaca-541` was read only; production `different-gnu-398` was not accessed.

### Gaming: 495.821 seconds

Project `th725yjevp145b1jfnedjmgxn98hjg0a` borrows real Florescent R2 source metadata. Initial run `1793758260552-0.49097985496655905` exposed a real missing capability: the clipping skill required source `readFrames`, but the Clip lane excluded it. The agent reported the issue, exhausted three finish checks, and saved no delivered tabs. Its final message honestly reported no timeline changes. The lane now exposes `readFrames`; real source-frame calls succeeded both in the app and through the scoped MCP bridge.

Post-fix run `1793759605203-0.33701435696671356` completed with **2 found / 2 accepted / 2 populated checked tabs**, no completion errors:

| Delivered tab | Source range | Duration |
| --- | --- | --- |
| The Ace on Match Point | 213.10–230.083333s | 16.983333s |
| Knives Out Ace | 104.845–120.38s | 15.535s |

The authoritative final message lists exactly those two tabs and says “Gemini was unavailable; picks used transcript and audio.” Both duration/aspect/coverage/range/boundary/loudness/caption/decode checks passed. Chat displays both model and authoritative completion text; both describe the saved result honestly.

Elapsed chat-send to completion: **1165.187s (19m25s)**, with 28 recorded model calls and 54 tool calls. This does not establish a speed improvement over the user's approximately 18-minute, one-tab run: full podcast conversion ran concurrently, and this run included recovery and a boundary repair. Its transcript was already saved. Initial cold preparation separately took 27.8s for transcription (2.6s Deepgram), 63.1s for playback preparation after restart, and 485.0s for discovery including transfer/overview encoding and Gemini rejection.

| Phase in the completed gaming run | Measured time |
| --- | --- |
| Fallback discovery, including transfer | 46.1s |
| Source-wide facecam, queued to completed | about 93.7s |
| First normalization, worker processing | 6.2s / 4.9s |
| First clip checks, queued to completed | 94.6s / 102.2s |
| Boundary repair normalization | 13.5s |
| Repeated checks before receipt reuse fix | 183.9s / 195.8s |

Remaining elapsed time includes frame review, queues, model turns and editing. The trace exposed redundant checking of an unchanged valid tab. `checkClip` now filters explicit IDs against fingerprint-validated current receipts and returns `reusedTimelineIds`; changed or failed tabs still queue checks. The podcast probe below verified this optimization in the app.

### Full Syntax podcast: 3386.894 seconds

Project `th7cjvgxjenvrgazar44qh7fzh8hkmg7` imported the full documented [Syntax video](https://www.youtube.com/watch?v=-f2ql_aGIbs): 1920×1080, 30fps, 3386.894s. The initial import exhausted disk space (roughly 113 MB free). Original downloads were preserved. Only this checkout's regenerable build cache and incomplete remux were removed; root separately reclaimed inactive generated build artifacts. Retry `s579csvrg7gfgembsmjk93z1s98hjx1g` reused the real downloads via hard links and completed at 03:02:06 UTC November 4. Recovered conversion took 23m14s queued-to-complete; full audio extraction took about 46s. These import stages precede the final chat run and are excluded from its time.

The first complete-source transcription returned 10,206 words but failed worker completion at Convex's 8,192-item argument-array limit. Storage chunking did not protect RPC transport. Contract 41 now sends words in bounded chunks across completion, asset queries and snapshots, reconstructing before analysis. The live retry stored **10,207 words** (provider rerun differed by one), six storage/transport chunks of at most 2,000 words, 474 overview segments and final word end 3374.77s. Transcription, subsequent highlight discovery, speaker analysis and clip checks all completed.

Run `1793762003156-0.1506588149170094` explicitly requested three clips and completed with **8 found / 3 accepted / 3 populated checked tabs**, five dropped reasons and no completion errors:

| Delivered tab | Source range | Duration |
| --- | --- | --- |
| AI booked the wrong flight | 1478.19–1512.38s | 34.19s |
| Would you go back before AI coding? | 912.635–944.68s | 32.045s |
| The circuit breaker promise | 1631.685–1670.39s | 38.705s |

Dropped moments at approximately 605s, 664s, 1800s, 2289s and 3272s each have an explicit editorial reason. The final authoritative message lists the three actual tabs, ranges/durations, all five dropped reasons and the fallback disclosure. The model final also discloses wider letterboxed framing to keep speakers visible and that nothing was exported.

Elapsed chat-send to completion: **1231.058s (20m31s)**, with 55 recorded model calls and 73 tool calls. This includes a deliberate interruption and roughly two-minute worker restart, plus normalization repairs. No comparable old full-podcast app run was measured.

| Phase | Measured time |
| --- | --- |
| Full-source transcription, worker processing | 44.5s: audio 20.8s, Deepgram 11.4s, quiet detection 11.6s |
| Whole-source fallback discovery, worker processing | 13.3s |
| Speaker windows, worker processing | about 55s / 50s / 61s |
| First normalization, worker processing | about 9s / 13s / 11s |
| First checks, queued to completed | 92.6s / 93.5s / 70.5s |
| Last complete-mix normalization, queued to completed | 14.1s / 11.5s / 12.9s |
| Last passing checks, queued to completed | 27.9s / 30.0s / 47.7s |

The agent initially normalized individual clips; the complete-mix gate correctly rejected that evidence. It repaired all tabs with timeline-mix normalization and passed subsequent checks. Earlier repair/check batches and model editing account for additional elapsed time. The final explicit repeat of all three timeline IDs returned **zero new results**, `alreadyChecked:true`, and all three IDs in `reusedTimelineIds`, with no new check jobs.

### Screenshots, MCP integration and limits

Desktop (1280×800) and phone (390×844) screenshots come from the authenticated running app. Gaming before images show the earlier live run; after images show completed delivery. No historical pre-run podcast screenshot survived the browser interruption. Its before images therefore show an explicitly labeled **unclipped baseline in a separate copied verification project** (`th753t1qme0nvc961r3bdbb2qs8hktre`), with output tabs removed and real source media retained. They are not presented as screenshots of old code. After images show the actual completed podcast project. Assets live on `pr-assets` under `find-highlights/before/` and `find-highlights/after/`.

A real scoped MCP SDK client listed 169 tools and read a source frame through Clip without exporting or editing. Integration inspection found the stdio bridge hid initialized identity as `revline-local` and did not terminate its HTTP session. The bridge now forwards client identity, explicitly terminates upstream sessions on stdin end/disconnect/signals, and closes transports. A live `Codex PR58 cleanup verification` connection was recorded with that identity and `closedAt`; its task lease was inactive after client close. In-app and MCP task IDs remain separate. Clerk development ticket sign-in restored the incognito preview; no production auth or default browser profile was changed.

Local `npm run typecheck` passed after the final integration. The last local production build compiled successfully in 83s, then was stopped during TypeScript to avoid concurrent heavyweight builds/disk pressure; a completed local build is not claimed. Both GitHub checks passed exact integrated head `fa3cba84`; the final bridge/docs commit requires its own CI result. No tests, mocks, fixtures or test-only scripts were added.

Remaining limits: successful Gemini judging and Linux container/export execution are unverified; wider letterboxed framing remains a visual quality concern in both sources; delivery correctness is demonstrated, speed improvement is not. Production release and PR merge require the user's approval. The private app and local worker remain running for review.

## Context projection audit — November 3, 2026

The actual Terra thread's saved successful messages contain two `inspectAssetAnalysis` responses of about 143 KB and 141 KB (JSON output), including the complete numeric highlight helper payload in each. The provider middleware also froze every exposed result for every provider, preventing later supersession/deduplication from reaching OpenAI. The fix scopes numeric helpers to requested source windows, preserves all editorial moments and transcript words, and retains the append-only result policy for Claude only.

Replayed 44 real tool-result prefixes through the production `AssistantTokenBudget.middleware`, before and after, using the exact same saved thread messages. Serialized final history fell from 549,946 to 401,197 bytes. Using `o200k_base` on serialized history, the final payload was 192,472 versus 138,647 tokens; cumulative prefixes were 6,823,300 versus 4,724,268 tokens. These are local payload estimates, not provider-billed tokens: system/tool-schema overhead, multimodal accounting and cache charges are excluded. The original observed 319,925 billed input count is not interchangeable with this estimate. User messages, every tool-call/result ID pairing, complete boundary word windows and multimodal outputs had identical SHA-256 hashes; no transcript evidence was summarized away. Original full source evidence remains stored and ranged reads return the original numeric helpers.
