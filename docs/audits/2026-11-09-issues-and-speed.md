# Audit: issues and speed, 2026-11-09

Scope: editor state and timeline math, media worker and task queue, AI editor agent and MCP tools, editor speed, reliability and security. Read against `main` at `bdb1b8dd`. File and line references are for that commit.

- **CONFIRMED** means reproduced by running the real modules, or provably wrong from the code path read end to end. "Reproduced" is stated where it applies.
- **PLAUSIBLE** means the code path exists but one named step was not verified.
- Effort: S (under about 30 lines, clearly safe), M, L.
- Seven draft PRs cover the small, safe, confirmed fixes. Everything else is marked "needs decision".

Not covered here because other branches own them: `planClips`/`finishClipping`/clip-check (`fix/clipping-planclips-candidates`), fast-export coverage and threads (`perf/fast-export-coverage`), dashboard list queries and `timeline-viewport.ts` (`perf/dashboard-queries`), and #229, #230, #231.

## Draft PRs opened

| PR | Branch | Findings |
|---|---|---|
| [#233](https://github.com/revlinehq/Revline/pull/233) | `fix/mirror-blur-transition-render` | B1 |
| [#234](https://github.com/revlinehq/Revline/pull/234) | `fix/speed-ramp-split-trim` | B2 |
| [#237](https://github.com/revlinehq/Revline/pull/237) | `fix/frame-check-queue-stalls` | B3, B4 (expiry part) |
| [#236](https://github.com/revlinehq/Revline/pull/236) | `fix/agent-false-failures` | B6, B8, B12 |
| [#239](https://github.com/revlinehq/Revline/pull/239) | `perf/agent-tool-call-reads` | S3, S9 |
| [#240](https://github.com/revlinehq/Revline/pull/240) | `perf/asset-list-preview-lookups` | S4 |
| [#241](https://github.com/revlinehq/Revline/pull/241) | `fix/worker-secret-compare-nonce-prune` | R2, R3 |

Each passed `npm run typecheck` and `npm run build`. None was exercised on a running backend (see "Not verified").

## The symptoms named in the brief

| Symptom | Result |
|---|---|
| "The transition range overlaps another clip on its V track", project stuck on "footage could not load" | Root-caused and reproduced: B1. Fixed in #233. |
| getFrames pending for many polls, exports starved | Three causes found: B3, B4, B5. #237 fixes the unbounded waits; B5 and the ordering half of B3/B4 need a decision. |
| inspectVideo timing out | B7 (no lane for `video` tasks). Separately, shared DEV's Gemini key returns 402, which also fails it there. |
| Reused export returning a stale video | No hole found in `exportVisualKey`: every non-audio clip field except eight sound-only ones is in the key, scene code is restored before hashing, and a candidate must match resolution, fps, quality and renderer. Not proven: that an asset's file is never rewritten in place under the same id. |
| Mirror blur at 40 measuring no blur on the fast path | Not investigated: the fast path is owned by `perf/fast-export-coverage`, and #231 changed this area today. |
| Sound jumping between clips | One cause reproduced: B2 (fixed in #234). Normalized-audio bakes are keyed on full clip timing and fall back to source audio after any trim, so they are not a cause. |
| Clerk infinite redirect loop from a stale localhost cookie | Loop path exists in code (B15), not reproduced. |

## Bugs

### B1. Mirror blur on either side of a transition makes the project unrenderable
- **Severity:** high. **CONFIRMED, reproduced.** **PR #233.**
- **Where:** `lib/editor/clip-transitions.ts:127`; `lib/editor/composition.ts:104,117`; `lib/editor/live-preview.ts:32-33`; `lib/editor/mirror-blur-layout.ts:196`.
- **What happens:** `expandBackgroundFills` appends render-only bands (`<clip>~mirror-1a` …) on the owner's track and time range. `transitionSources` then counts them as a third clip under the transition and throws. Saving validates the unexpanded timeline, so the save succeeds.
- **Impact:** Preview and export throw on every load; the project stays on "The footage could not load." until the user deletes the transition or the fill by hand.
- **Fix:** ignore the bands of the two joined clips in the third-clip check. **Effort:** S.

### B2. Split or left trim of a speed-ramped clip plays the wrong footage
- **Severity:** high. **CONFIRMED, reproduced.** **PR #234.**
- **Where:** `lib/editor/operations.ts:102`; `lib/editor/timeline-controls.ts:333,337,357`.
- **What happens:** the new `sourceStart` is `offset * playbackRateOf(clip)`, and a ramped clip reports rate 1. A 2x ramp split at 2 s gives the tail source 2 s instead of 4 s.
- **Impact:** picture and linked sound repeat or jump at the cut. The server only checks the source end, so it saves.
- **Fix:** use the ramp-aware source span for the split, the trim and the trim limits. **Effort:** S.

### B3. A frame check or export waits forever on a motion track that is not running
- **Severity:** high. **CONFIRMED mechanism**; how often the track is still unclaimed when the render starts was not measured. **PR #237** (bounded wait).
- **Where:** `lib/server/pixel-track-files.ts:17`; `convex/pixelTracks.ts:47`; `convex/lib/editorToolkit.ts:568`; claim order `convex/mediaTasks.ts:303-312`.
- **What happens:** `attachToTrack` saves the binding at once and queues a `derive` task. A snapshot outranks `derive`, is claimed first and polls the track every 2 s with no limit. With one slot the track can never be claimed; with two, a second snapshot of the same timeline wedges both.
- **Impact:** getFrames stays pending; the worker needs a restart. An export of that timeline fails at its 15-minute limit.
- **Fix:** bounded wait (in #237). Still open: order a track ahead of renders that depend on it, or refuse the render while its track is queued. **Effort:** S done, M for ordering.

### B4. Abandoned frame checks are never cancelled and outrank every export
- **Severity:** high. **CONFIRMED.** **PR #237** (expiry part).
- **Where:** `convex/mcp.ts:352-358`, `:282` (only comparisons set `cancelTaskId`); `convex/mcpActions.ts:263` (tells the agent the request expires in ten minutes).
- **What happens:** `expireFrames` re-arms every 15 minutes while the render task is queued or running. A `getFrames` retried without `checkId` leaves a queued render each time; snapshots are claimed before renders with no aging.
- **Impact:** exports wait behind frames nobody reads; with the worker offline the tasks hold the owner's 24 task slots.
- **Fix:** cancel the queued render at expiry (in #237). Still open: let an export that has waited N seconds outrank frame checks. **Effort:** S done, S–M for aging.

### B5. Full-video proxy transcodes take the slot reserved for quick checks
- **Severity:** high. **CONFIRMED.** Needs decision.
- **Where:** `lib/server/media-worker-loop.ts:32` (`preview: true` in `QUICK_KINDS`); `convex/mediaTasks.ts:303` (`preview` first in claim order).
- **What happens:** a `preview` task downloads and transcodes the whole source. After an import or a two-file upload, both slots run transcodes and every frame check waits minutes.
- **Impact:** matches "getFrames pending for many polls" right after footage is added.
- **Fix:** take `preview` out of the quick slot and order it after `read`/`snapshot`/`blueprint`, or treat only short assets as quick. The comment says playback is meant to unlock the editor first, so this is a product call. **Effort:** S.

### B6. One failed status poll ends an MCP edit as "Stopped in the editor"
- **Severity:** medium. **CONFIRMED.** **PR #236.**
- **Where:** `convex/mcpActions.ts:372`.
- **What happens:** the 2-second `isRunActive` poll aborts the edit on any rejection; the catch block reports a Stop and ends the task session. The in-app turn ignores a failed poll (`convex/lib/editorTurn.ts:75`).
- **Fix:** ignore a failed poll. **Effort:** S.

### B7. `inspectVideo` has no lane and times out behind any long task
- **Severity:** medium. **CONFIRMED.** Needs decision.
- **Where:** `lib/server/media-worker-loop.ts:33` (`video: false`); `convex/mediaTasks.ts:310-312`; wait limit 170 s, request expiry 240 s (`convex/assistant.ts:672`).
- **What happens:** the quick slot refuses `video` tasks and the server orders them after every export and all older analysis. One running export or import on the general slot is enough to time the call out.
- **Fix:** let the quick slot take `video` for short windows, or order tasks that carry an `analysisRequestId` ahead of exports and background analysis. **Effort:** S–M.

### B8. A rejected model request keeps its token reservation
- **Severity:** medium, only with `EDITOR_ENFORCE_TOKEN_BUDGET=true` (production value not checked). **CONFIRMED.** **PR #236.**
- **Where:** `lib/ai/token-budget.ts:258-264`.
- **What happens:** `reserve` holds up to 128k output tokens; if `doStream()` rejects (429/529) nothing settles it. The retry reserves again, passes the 150k limit and throws "token budget reached", which is not repairable.
- **Fix:** return the reservation when the call rejects. **Effort:** S.

### B9. `restoreClip` cannot restore a linked video or audio clip
- **Severity:** medium. **CONFIRMED by trace.** Needs decision.
- **Where:** `convex/lib/editorToolkit.ts:1201-1203`; validation `convex/lib/timeline.ts:73,76`.
- **What happens:** it restores one clip. After a linked pair was trimmed or deleted, restoring either member alone fails "Linked video and audio must stay synchronized" or "links must reference each other", in any order.
- **Impact:** only `restoreTimeline` (whole tab) recovers imported footage.
- **Fix:** restore the partner from the same revision in the same checkpoint. **Effort:** M.

### B10. Ripple trim of a multi-selection desyncs linked audio
- **Severity:** medium. **CONFIRMED, reproduced.** Needs decision.
- **Where:** `lib/editor/timeline-controls.ts:288-296`.
- **What happens:** ripple offsets are per lane. With V0 on V1 and V1 on V2 sharing audio layer A1, trimming both by 1 s leaves V1 at 5 s and its audio at 4 s.
- **Impact:** the server rejects the save and the user sees "This edit couldn't be saved and was undone". Reachable from the drag trim, keyboard trim and `resizeClips`.
- **Fix:** give each linked audio clip its video's offset, then re-run the overlap check. **Effort:** S.

### B11. Ripple delete is refused when two video layers share an audio layer
- **Severity:** low to medium. **CONFIRMED, reproduced by the sweep.** Needs decision.
- **Where:** `lib/editor/shot-edits.ts:72-82`; guard `convex/lib/editorToolkit.ts:409-411`.
- **What happens:** the shifted clip's audio lands on a neighbour's audio that did not shift; the overlap guard refuses the whole delete. Agent path only.
- **Fix:** move the colliding audio to a free layer, as `closeFootageGaps` does. **Effort:** S–M.

### B12. Brand kit reads take the project's edit lock over MCP
- **Severity:** low to medium. **CONFIRMED.** **PR #236.**
- **Where:** `lib/ai/tool-definitions.ts:128-129`.
- **What happens:** `listBrandKits` and `getBrandKit` are classed `exclusive`, so each runs `beginRun`/`finish` and is refused with "Another MCP edit is still running" during any other call.
- **Fix:** class them `read`. `recallMemory` (`:95`) has the same class but its mutation requires a run, so it was left. **Effort:** S.

### B13. An idle quick slot is not woken for `frames` and `review` tasks
- **Severity:** medium. **PLAUSIBLE**: not verified that Convex skips `onUpdate` when a re-run returns the same value (the code's own comment at `convex/mediaTasks.ts:121-123` assumes it does). Needs decision.
- **Where:** `lib/server/media-worker-loop.ts:65` subscribes with the full claim args; slot 0 claims with `quickArgs`.
- **What happens:** with an export queued as the head task, a new `inspectFrames` task does not change `ready`, so slot 0 sleeps although it could claim it.
- **Fix:** a second `ready` subscription with `quickArgs`; add `frames` and `review` to the server's quick order. **Effort:** S.

### B14. Deterministic failures are retried three times
- **Severity:** low. **CONFIRMED.** Needs decision.
- **Where:** `lib/media-analysis/errors.ts:41`, used at `lib/server/media-worker-loop.ts:163`.
- **What happens:** anything that is not an `AnalysisError` is retryable, including a `ConvexError` and a renderer crash on bad scene code. An export that cannot render runs three times.
- **Fix:** retry only transport and lease errors. **Effort:** S.

### B15. Sign-in can loop when browser and server disagree about the session
- **Severity:** low. **PLAUSIBLE**: not reproduced. Needs decision.
- **Where:** `components/auth/auth-form.tsx:57`; `app/(dashboard)/layout.tsx:5`.
- **What happens:** the client sees a signed-in Clerk session and replaces to the dashboard; `auth.protect()` rejects the cookie and redirects back to sign-in.
- **Fix:** count bounces in `sessionStorage`; after two, sign out and show the form. **Effort:** S.

## Speed

No bundle sizes were measured: `next build` (Turbopack, 16.4.3) prints routes but no sizes. Baseline build: compile 6.2 s, type check 27.9 s. Costs below are read counts and round trips from the code unless stated.

### S1. Every media-task progress tick re-renders the editor and re-reconciles the preview
- **Severity:** high. **CONFIRMED chain**; milliseconds per tick not profiled. Needs decision.
- **Where:** `components/editor/connected-editor.tsx:105-106,164-176`; `components/editor/preview.tsx:198`; `components/editor/timeline.tsx:222`.
- **What happens:** `assets` depends on `mediaTasks`, so each progress write (export every 2 s, proxy every 1 s) gives every asset a new object. That re-renders every timeline clip (undoing #229 for the length of an export) and re-runs the preview layout effect.
- **Fix:** keep asset identity when `footageProgress` and `preparation` are unchanged, or keep progress in its own map. **Effort:** M.

### S2. First load is a serial chain before the media query starts
- **Severity:** high. **CONFIRMED structure**; wall-clock not traced. Needs decision.
- **Where:** `components/editor/connected-editor.tsx:52,60-61,65,72,83,360`.
- **What happens:** auth, `projects.get`, `historyIndex`, up to 10 `historySnapshot`, scene code per hash, access gate, and only then `assets.list` and seven other queries that need nothing but the project id from the URL. Undo history blocks first paint.
- **Fix:** subscribe to `historyIndex` and `assets.list` beside `projects.get` (Convex dedupes them); optionally render before history arrives. Not done here because `perf/dashboard-queries` is changing the editor subscription in the same file. **Effort:** S for the prewarm, M to un-gate history.

### S3. Each agent tool call re-reads the whole project 2 to 6 times
- **Severity:** medium. **CONFIRMED.** **PR #239.**
- **Where:** `convex/lanes.ts:164-168` and nine more lane functions; callers `convex/lib/editorToolkit.ts:2571,262`, `convex/mcpActions.ts:147,180,334`.
- **What happens:** they call `requireProject`, which loads the project, its run rows and one `sceneCode` row per scene, only to check the owner. 2 per in-app call, 4 per MCP edit, up to 6 per `finish`.
- **Fix:** check ownership from the one-row access record (in #239). Still open: pass the already-fetched task through instead of querying again. **Effort:** S done, M for threading.

### S4. `assets.list` runs a proxy lookup for every audio and image asset
- **Severity:** medium. **CONFIRMED.** **PR #240.**
- **Where:** `convex/lib/media_storage.ts:69-74`, called from `convex/assets.ts:109`.
- **What happens:** one `previewSegments` query per asset without a finished proxy, on every re-run, including kinds that never get one (up to 200 per run).
- **Fix:** skip unless the asset is a video. **Effort:** S.

### S5. A batch of files uploads one at a time
- **Severity:** medium. **CONFIRMED.** Needs decision.
- **Where:** `components/editor/connected-editor.tsx:288-294`; `lib/editor/media.ts:85`.
- **What happens:** the three-connection pool is per file, and a file up to 32 MB is one part. Twenty short clips are 60 serial action round trips and 20 single-connection uploads; server preparation for file N starts after files 1 to N-1.
- **Fix:** upload 2–3 files at once, keeping the ordered timeline writes. **Effort:** M.

### S6. Footage preparation polls every second with one-shot queries
- **Severity:** medium. **CONFIRMED.** Needs decision.
- **Where:** `lib/editor/prepare-media-for-editing.ts:62-63,71,89`; `lib/editor/prepare-video-audio.ts:12`.
- **What happens:** each second runs `assets.get`, `mediaTasks.list` and a `mediaTasks.get` per task in series; each stage change is seen up to a second and three round trips late. The editor already subscribes to the same data.
- **Fix:** wait on the subscriptions instead of sleeping. **Effort:** M.

### S7. The tool list changes mid-turn, which should invalidate the prompt cache
- **Severity:** medium (cost). **PLAUSIBLE**: code confirmed, cache effect not measured. Needs decision.
- **Where:** `convex/lib/editorTurn.ts:176,179`.
- **What happens:** `finish` leaves the tool list after each failed tool call and returns after the repair; the closing step sends no tools and flips `toolChoice`. Tools sit ahead of the cached prefix.
- **Fix:** keep the list constant and let `finish` refuse while failures are open. **Effort:** M.

### S8. The editor's project subscription also depends on AI-run rows
- **Severity:** medium. **PLAUSIBLE**: needs a count of `projects.get` re-runs during one agent turn. Needs decision.
- **Where:** `convex/lib/project_data.ts:68-76`, from `convex/projects.ts:175-180`.
- **What happens:** any patch to `aiRuns` re-runs `projects.get` and may re-send the whole timeline.
- **Fix:** serve the AI fields from `assistant.status`, already subscribed. **Effort:** M.

### S9. A chat turn starts with five serial reads
- **Severity:** low to medium. **CONFIRMED.** **PR #239.**
- **Where:** `convex/lib/editorTurn.ts:82-86`.
- **What happens:** project, memories, brief, prompt and lane are read one after another; on the Cloudflare runner each is an HTTP hop plus a nonce write.
- **Fix:** `Promise.all`. **Effort:** S.

### S10. Interaction-only dialogs and zod load with the editor
- **Severity:** low. **PLAUSIBLE**: bundle not measured. Needs decision.
- **Where:** `lib/editor/opening-request.ts:1` (zod for one object); `components/editor/editor-shell.tsx:31,43`; `components/editor/connected-editor.tsx:26`; `components/editor/assistant-results.ts:4,8`.
- **Fix:** `next/dynamic` for the export, import, share and scene-code dialogs; hand-validate the two enum fields. **Effort:** S each.

## Reliability and security

### R1. Only exports have a time limit
- **Severity:** medium. **CONFIRMED.** Needs decision.
- **Where:** `lib/server/media-worker-loop.ts:102,135`; `convex/renders.ts:83-115`.
- **What happens:** a non-render task has no worker deadline, its heartbeat is a bare timer, and the stall sweeper reads only export jobs. Any hang holds a slot forever with no incident (B3 was one instance).
- **Fix:** a deadline per kind (about 3 minutes for quick kinds, 30–60 for import and analysis) and a sweeper over `mediaTasks`. **Effort:** S for deadlines, M for the sweeper.

### R2. The media worker secret is compared with `===` on public functions
- **Severity:** low. **CONFIRMED** not constant-time; exploitability over the network not tested. **PR #241.**
- **Where:** `convex/lib/media_task_auth.ts:12-15`, reached from public `mediaTasks.processorContract`, `ready`, `claim`.
- **Fix:** full-length comparison. **Effort:** S.

### R3. `agentRunnerNonces` is pruned only during an in-app turn
- **Severity:** low. **CONFIRMED.** **PR #241.**
- **Where:** `convex/agentRunner.ts:93-94`; inserts also at `convex/mcpAuth.ts:160`.
- **What happens:** MCP-only traffic adds rows and never deletes them; parallel turns delete the same 500 rows and conflict.
- **Fix:** a cron. **Effort:** S.

### R4. Several server-to-server fetches have no timeout
- **Severity:** low. **CONFIRMED.** Needs decision.
- **Where:** `convex/lib/media_storage.ts:43,55`; `convex/agentRunner.ts:20`; `cf-workers/agent-runner/convex-bridge.ts:21`; `cf-workers/mcp/bridge.ts:17`; `convex/lib/editorToolkit.ts:2014`.
- **What happens:** a stalled media Worker or bridge holds the caller up to the 10-minute action limit; the runner's heartbeat keeps the watchdog quiet.
- **Fix:** `AbortSignal.timeout`, combined with the run's signal. **Effort:** S.

### R5. Cancelled or exhausted imports leave their download on disk
- **Severity:** low. **CONFIRMED.** Needs decision.
- **Where:** `lib/server/media-task-runner.ts:444-446`; sweep `lib/server/import-checkpoint.ts:15-21`.
- **What happens:** the checkpoint directory stays at least 24 hours and until another import runs; a few multi-GB ones make new imports fail on disk space.
- **Fix:** remove it on cancel or on the last attempt; sweep stale `revline-task-*` directories at worker start. **Effort:** S.

## Checked and found correct

- **Timeline:** split rejects sub-frame pieces and re-homes transitions; move, snap and layer bumping hold; `closeFootageGaps` moves linked audio; `swapShots` refuses ramped shots; undo/redo history, revision log, tab switching and background-tab MCP edits; aspect-ratio change needs no rescale (values are stored as fractions). A 4,000-sequence random fuzz of move, trim, split, delete, close-gaps and speed changes found only B10 and B11.
- **Queue:** no double claim; dead workers are reclaimed by lease expiry; retries capped at 3 with backoff; child processes get the task signal; cancelling an export stops the worker in about 3 s; task temp directories are removed in `finally`; the loop survives thrown errors.
- **Security:** every public Convex function taking a project, asset, job or upload id checks ownership; runner and MCP bridge routes use HMAC, nonce, time window and an allowlist and fail closed; webhooks verify signatures; MCP OAuth uses PKCE, hashed tokens and refresh rotation; link import checks HTTPS, DNS against private ranges and redirects; `app/api/dev/openai-costs` returns 404 outside local development; no secrets under `NEXT_PUBLIC_`; every `.collect()` is on a narrow index range.
- **Agent:** volatile context is split from the cached prefix; stuck turns recover on all three paths; Gemini, Deepgram and OpenAI token-count calls carry abort signals and retry 429/5xx.
- **Preview timers:** three timers run every 100-500 ms while paused or hidden (`lib/editor/preview-media-session.ts:74`, `preview-media-warmup.ts:106`, `media-source-recovery.ts:31`), and `selectSources` rewrites `data-media-start` each tick, which the warmup's MutationObserver answers with a refresh. Per tick this touches a few elements, so it is not listed as a finding; trace a 100+ cut timeline before spending time on it.
- **Editor speed:** the playhead is in a store read through selectors, not context; the preview patches in place on ordinary edits; signed URLs are stable for a day; Sentry and PostHog load lazily; every editor query uses an index.

## Not verified

- No fix was run against a live backend or in the browser: `revline-local` MCP needs authorization in this session, so the isolated backend's tools were unavailable. Verification was inline runs of the real modules (B1, B2, B10), `npm run typecheck` and `npm run build`.
- B3: how often a track is still unclaimed when its render starts. B13: Convex `onUpdate` behaviour on an unchanged result. B15: the stale-cookie state.
- S1, S2, S7, S8, S10: no profile, network trace, cache metric or bundle size was taken.
- `convex/lib/editorToolkit.ts` (444 kB) was read at the lane tools, `finish`, the tool wrapper and the timeline tools, not handler by handler for schema mismatches. `convex/mcpConnections.ts`, `lib/editor/transitions-runtime.ts`, `lib/editor/transition-presentation.ts`, `lib/editor/visual-effects-runtime.ts` and `lib/editor/scene-runtime.ts` were not read.
- Whether production sets `EDITOR_ENFORCE_TOKEN_BUDGET` (B8).
