# Untangle decision log

The working record of the codebase untangle on the `untangle-codebase` branch. Each fix sits above the problems it solves. Status: **done**, **done**, or **deferred** (with the reason). Every fix below marked *done* in the first pass is now **done** unless a note says otherwise; see "Outcome" at the end. Line numbers refer to `20b300ae`, the starting commit.

Scope: untangling only. No comment pruning and no test changes (the repo has no test suite by design).

## Evidence

- Import graph: 818 source files. The biggest import cycles are:
  - 22 files in `lib/ai/skills` ↔ `editor-capabilities`
  - 19 files around `lib/editor/types.ts`
  - 4 files in `convex/derivations` ↔ `cutouts` ↔ `assets` ↔ `mediaTasks`
  - 4 files in `lib/server` (fal helpers)
  - 3 files in `convex/lib` (`editorToolkit` ↔ `laneFinish` ↔ `toolSaveReceipts`)
  - six 2-file cycles
- Imports that point the wrong way:
  - `lib/server` → `convex/mediaTasks.ts` (9 files)
  - `lib/media-analysis` → `lib/server` (6)
  - `lib/editor` → `components/workspace`
  - `lib/editor` → `lib/ai`
  - `lib/server` → `scripts/`
  - `convex/lib/editorToolkit.ts` → `convex/referenceReads.ts`
- Files that change together, from git co-change (last 700 commits):
  - `convex/schema.ts` with `editorToolkit.ts` (26 times) and with `mediaTasks.ts` (20)
  - `lib/editor/types.ts` with `schema.ts` (50 of its 64 commits)
  - `editor-shell.tsx` with `connected-editor.tsx` (55)

## Fixes

### Worker ↔ backend contract

- **Move the media-task wire contract (`workItem`/`taskResult` validators and their types) out of the `convex/mediaTasks.ts` function file into a leaf module, `convex/lib/media_task_contract.ts`, that both the worker and Convex import.** *done*
  - `lib/server/{media-task-runner,blueprint-check,read-reference,read-compare,review-composition,frame-cache,prepare-playback,local-worker-capabilities,media-worker-loop,normalize-audio,check-clip,sound-check}.ts` import types from an 860-line mutation file.
  - `convex/mediaTasks.ts:60-72` defines the contract inline among the handlers.
- **Move worker-only analysis code from `lib/media-analysis` into `lib/server`, so `lib/media-analysis` stays pure and importable by Convex and the browser.** *done*
  - `lib/media-analysis/io.ts:1-3`, `detect-shots.ts:1` and `music-beats.ts:1-2` spawn ffmpeg or Python through `lib/server` helpers, and only `lib/server` calls them.
  - `io.ts:3` only re-exports `lib/server/owned-media`.
  - `lib/media-analysis/gemini.ts:265` `inspectCompositionFrames` dynamically imports `lib/ai/composition-review`, and its only caller is `lib/server/review-composition.ts`.
- **Give fal.ai one client module (`lib/server/fal.ts`).** *done*
  - `derive-media.ts:102,114` exports `subscribe`/`download`, which `freeze-parallax`, `subject-segmentation`, `localize-tracking-object` and `remove-background` import back. This forms a 4-file cycle.
  - The `FAL_KEY` check and client setup are copied 4 times.
- **Let library code own the render resource table instead of importing it from `scripts/`.** *done*
  - `lib/server/plain-export-render.ts:5` imports `scripts/render-resources.mjs`.
- **Keep one list of the files that make up the processor runtime.** *done*
  - `scripts/processor-changes.mjs:14-21` is missing `track-reference.py` and `source_frames.py`, so changing only those files does not trigger a processor release.
  - The same list is also kept in `infra/media-worker/prepare-context.mjs:18`, `scripts/release-plan.mjs:45` and `infra/media-worker/runtime-check.mjs:9`.
- **Name each worker tool path once.** *done*
  - `workerToolPath(SCENE_DETECT_PYTHON, …)` appears in `clipping-analysis.ts:24`, `track-reference.ts:14`, `detect-shots.ts:10` and `local-worker-capabilities.ts:26`.
  - The pixel-tracker path appears in `track-source-pixels.ts:20` and `local-worker-capabilities.ts:30`.
- **Delete the Next API routes nothing calls.** *done*
  - `app/api/{analyze,beats,extract-audio,waveform,render}/route.ts` and `lib/server/queue-media-request.ts`. Their last callers were removed with the test suite in `6caea204`.
- **Share the media Worker's upload part limit with the client.** *done*
  - `cloudflare/media/worker.ts:42` rejects parts over 64 MiB, while `lib/editor/limits.ts:8` lets the client send up to 95 MiB.
- **Use one Sentry server/edge config.** *done*
  - `sentry.server.config.ts` and `sentry.edge.config.ts` are identical.

### AI layer: models, skills, lanes, tools

- **Break the skills cycle by moving the `EditorSkill` types into a leaf module, and drop the skill index that both consumers discard.** *done*
  - Every `lib/ai/skills/*.ts:2` imports its types from `./index`, which imports every skill.
  - `lib/ai/editor-capabilities.ts:12,18` builds `skills: editorSkillIndex()`, and both consumers throw it away (`skills/effects.ts:10`, `skills/text-styling.ts:10`).
  - The "Built on read" getters work around that cycle.
- **Make `claude-model.ts` the one model catalog: ids, labels and the free model, with the policy reading from it.** *done*
  - `claude-model-policy.ts:5,8,10` re-lists the model ids, which creates a 2-file cycle.
  - The free model literal `'gpt-6.1-terra'` is repeated in 7 places across `lib/ai`, `convex/assistant.ts` and `components/editor`.
  - `convex/assistant.ts:59` keeps its own model labels, which have drifted.
  - `CLAUDE_GATEWAY_MODEL` and `gatewayModelId` are dead.
- **Name the Gemini video model default once.** *done*
  - `'gemini-3.7-flash'` appears 9 times in `lib/media-analysis/gemini.ts`, and once in the `lib/server/find-highlights.ts:228` cache key, which drifts if the default changes.
- **Write analysis versions from the same constants readers compare against.** *done*
  - `match-speaking-faces.ts:409` writes `version: 2`, while readers compare against `SPEAKER_ANALYSIS_VERSION`.
  - `find-highlights.ts:101,224,252` write `version: 3` instead of using `HIGHLIGHT_VERSION`.
  - `lib/media-analysis/clipping.ts:79,92,178` repeat the literal.
- **Keep the lane registry the only source of lane ids, and delete lane leftovers.** *done*
  - `convex/lib/lane_validators.ts:2-8` re-lists `LANE_IDS`.
  - `lib/ai/lanes/options.ts` is unused.
  - `LaneDefinition.label` is never read, and `laneSkill`'s first parameter is unused.
- **Move the tracking and zoom target helpers from `lib/ai` into `lib/editor`, since they depend only on the timeline model.** *done*
  - `lib/editor/tracking-attach.ts:4` imports `lib/ai/object-motion` back.
- **Move `WordEdge` into `lib/speech-cleanup/types.ts`.** *done*
  - It is the cause of the `acoustic.ts` ↔ `edges.ts` cycle.

### Editor model (`lib/editor`)

- **Break the `types.ts` cycle.** *done* Make `types.ts` a leaf of plain data types:
  - Settings modules import only the types they need from it.
  - The pixel-track binding types move into `lib/editor`.
  - The UI helpers move out of `types.ts`.

  Problems:
  - A 19-file cycle: `types.ts` imports settings modules and `lib/media-analysis/pixel-track.ts`, which import `types.ts` back.
  - `types.ts:150` re-types `Transcript` instead of importing it.
- **Use one list of clip settings that keep their own `{duration, offset}` clock, read by shift, resize and split.** *done*
  - `operations.ts:64,94`, `clip-effects.ts:208` and `timeline-controls.ts:353` are four hand-kept lists that already disagree.
  - Split and patch skip `textGradient`.
- **Remap every timeline asset reference through one helper.** *done*
  - `convex/timelineShares.ts:144-147` copies `remapTimelineAssets` but drops `scene.film.referenceAssetId`.
- **Build the live-preview update in one function with one ordered list of updaters.** *done*
  - `components/editor/preview.tsx:170` and `:279` call the six live updaters in two lists, in different orders.
  - `composition.ts:284` and `live-visual-effects.ts:10` build each clip's effect data with identical code.
- **Type the composition iframe's window globals in one module.** *done*
  - `composition.ts:283` sets `window.__timelines`.
  - Readers in `preview.tsx`, `adjustment-layers.ts`, `audio-reactive.ts` and `live-media-content.ts` each cast their own shape.
- **One `waitForMediaTask`, one focus interpolation and one SHA-256 hex helper.** *done*
  - The media-task poll is written twice: `prepare-video-audio.ts:6-14` and `prepare-media-for-editing.ts:27-89`.
  - Focus interpolation is written three times: `composition.ts:93-99`, `tracking-attach.ts:24-29` and `lib/dev/subject-tools.ts:4-12`.
  - SHA-256-to-hex is written about 14 times across the repo.
- **Delete dead runtime bundles and pass-through re-exports.** *done*
  - The split `remotion-text.js` and `remotion-transitions.js` bundles are never loaded: every caller uses the shared runtime.
  - Re-exports at `clip-effects.ts:21`, `composition.ts:78`, `smooth-zoom.ts:7` and `tracking-attach.ts:115`.

### Web app (`components`, `app`)

- **Break the `assistant-results` ↔ `assistant-turn-presentation` cycle with a leaf chat-types module.** *done*
- **Let `ComposerAttachment` live in `lib/editor`, so the model no longer imports a component.** *done*
  - `lib/editor/composer-media.ts:2` imports it from `components/workspace/edit-composer.tsx`.
- **Give the new-project → editor handoff one module that owns its storage keys.** *done*
  - The keys are spelled in `lib/editor/opening-request.ts`, `connected-editor.tsx:352-372`, `new-conversation.tsx:41-43,246,277,304`, `start-new-workspace.ts:11-12` and `assistant-composer-controls.tsx:27-39`.
  - The lists have drifted: `start-new-workspace` doesn't clear `revline:next-aspect-ratio`.
  - `opening-request.ts` imports `lib/ai` from `lib/editor`.
- **Delete the editor flags and variants that no caller uses.** *done*
  - `embedded` and `workspaceOnly` (`editor-shell.tsx:80,82`) and their branches.
  - `use-editor-mode-preference.ts`.
  - `SegmentedTabs` `appearance:'navigation'`.
  - `FootagePanel`'s `'sheet'` variant.
  - `inspector-select.tsx` (its CSS stays, because the model picker uses it).
- **Use one guarded stored-preference hook.** *done*
  - `use-editor-mode-preference.ts` and `use-inspector-preference.ts` are copies.
  - `editor-shell.tsx:137,247` reads `localStorage` unguarded.
- **Decide dark routes with one predicate.** *done*
  - The pre-paint list in `app/layout.tsx:33` and `theme-provider.tsx:10` disagree on `/pricing`, `/blog`, `/brand-kits`, `/connect` and `/mobile`.
- **Use one m:ss formatter.** *done*
  - `timeline-tabs.tsx:23` and `assistant-activity.tsx:21` are identical.
- **Derive tool labels from the tool definitions.** *done*
  - `components/editor/assistant-results.ts:141-164` labels 102 of 162 tools.
  - 3 of its labels name tools that don't exist.

### Convex functions

- **Move the media queue core (`enqueueMediaTask`, `cancelMediaTask`, `failMediaTask`) out of `convex/mediaTasks.ts` into `convex/lib`, so feature files stop importing the result handlers and the cycles break.** *done*
  - `mediaTasks.ts:35-48` imports `./assets`, `./cutouts`, `./derivations` and `./brandKits`.
  - `assets.ts:25`, `cutouts.ts:14` and `derivations.ts:14` import `enqueueMediaTask` back.
  - 18 function files import the whole mediaTasks module for those three helpers.
- **Use one active-run check and one `runArgs` validator.** *done*
  - `assistant.ts:328` `requireRunState` and `:334` `requireActiveRun` are near-copies.
  - `assistant.ts:406` `isRunActive` and `agentRunner.ts:61` `isActive` do the same check.
  - `runArgs` is redeclared in 8 files.
- **Let `convex/lib/run_ids.ts` own the run-id format, with `isMcpRun` and the run-author label.** *done*
  - `startsWith('mcp-')` is tested in 7 files.
  - The author label is computed in `assistant.ts:461` and `lib/revision_log.ts:67`.
  - `CALL_LIMIT_MS` (`mcpActions.ts:28`) must stay below `MCP_RUN_LIMIT` (`mcp.ts:73`), but nothing links the two.
- **Put turn dispatch in one module, so `agentRunner` ↔ `assistantTurnRecovery` stops being a cycle.** *done*
  - `assistantTurnRecovery.ts:16` imports `startRunnerTurn`, and `agentRunner.ts:6` imports recovery back.
- **Move the reference-read runners from the `convex/referenceReads.ts` function file into `convex/lib`.** *done*
  - `convex/lib/editorToolkit.ts:62,114` imports the top-level function file, and through it `mediaTasks` and `schema`.
- **Give the run types shared by the toolkit, finish and receipts their own leaf modules.** *done*
  - `EditorRun` is imported from `editorToolkit` by `toolSaveReceipts.ts:9` and `laneFinish.ts:16`, which `editorToolkit` imports back.
  - `LaneTask` lives in `laneFinish.ts:20`.
  - History helpers make `convex/lib/timeline.ts:3` ↔ `project_data.ts:7` a cycle.
- **Drop processor-version constants that never decide anything.** *done*
  - `mediaTasks.ts:78,80,88,96` (`TRACE_`, `FONT_`, `REFERENCE_SOUND_`, `REFERENCE_CROP_PROCESSOR_VERSION`) are unused.
  - The `Math.max(...)` at `mcp.ts:273` always equals `MEDIA_PROCESSOR_VERSION`.
- **Route lane-task evidence written by tool writes through `lanes.saveEvidence`, the one bounded writer.** *done*
  - `toolWrites.ts:79-90` writes `editingLaneTasks.evidence` with its own `.slice(-120)`, skipping the 650 KB limit and the same-input replacement.
- **One upload-limits module.** *done*
  - The 200-media limit appears in 8 places.
  - `cloudMedia.ts:73-97` copies `signPartUrl` and the parts check from `r2.ts`.
- **Delete dead functions, parameters and finished migrations.** *done*
  - `assets.ts:147-202` is a legacy worker API. It is internal but calls `requireOwner`, so it can never succeed.
  - `uploads.ts` `jobId` is never passed.
  - The `r2.ts:76` `workerSecret` path is unused.
  - `mcp.ts:78` `tabTimeline`, the `mcp.ts:93` alias, and the `mcpActions.ts:355` `switchLane` branch (filtered out at `:73`) are dead.
  - `brandKits.ts:128,144` are migrations the strict schema already guarantees ran.
  - `fpsMigration.ts` is referenced nowhere.

## Deferred, or needs the user's call

- **Voice tools (`listVoices`, `generateVoice`).** They are registered, but no lane has allowed them since the explainer lane was folded (`e53dfe62`). Re-enabling them or deleting them both change behaviour.
- **Effect and stock-audio drag-and-drop.** `effect-drag.ts`, `stock-audio-drag.ts` and their drop handlers have no drag source. Kept, because they may be planned work.
- **Runner allowlist.** In-app turns run through the Cloudflare runner, which allows only the functions in `convex/agentRunnerHttp.ts:12`. That list lacks `comparisonContinuations:*` and `lanes:clipQa`, which the toolkit calls. Adding id-only functions to a signed-bridge allowlist is a security decision.
- **Larger rewrites.** These are left out because of their behaviour risk in one pass:
  - a declared table per media task kind (`media-task-runner.ts:54-437`)
  - splitting tool definitions from the run-bound toolkit
  - an edit lock and selection in the editor store

## Outcome

Verified on the isolated backend `amiable-ocelot-695` with `npm run typecheck`, `npm run typecheck:agent-runner`, `npm run typecheck:processor-edge`, `node scripts/copy-vendor.mjs`, `npm run build`, a deploy of the branch functions, the signed-in editor and workspace pages (no console errors), MCP edits with revisions and undo, a worker-rendered `getFrames`, and worker preview/extract tasks.

- **Import cycles:** 10 before, 0 after.
- **Wrong-direction imports:** none are left among those listed under Evidence.
- **Partly done or changed during the work:**
  - **`zoom-targets` and `camera-targets`:** stay in `lib/ai`, because they also read `lib/media-analysis`. Only `object-motion` moved.
  - **Secret-redaction regexes:** stay separate, because they differ.
  - **The two media-task polls:** both stay, because one races several tasks with progress.
  - **`textGradient`:** stays out of split and patch on purpose. It loops on an offset only, so it isn't an own-clock setting.
  - **Shared timeline copies:** they keep the original rule (unpinned clip and audio references are dropped). `scene.film.referenceAssetId` is now remapped too, and dropped when unpinned. Before, it kept the sharer's asset id.
  - **Starting a new workspace:** it keeps the chosen format again, as the opening-request module documents.
  - **`requireRunState` and `requireActiveRun`:** they share `holdsRun` but stay separate, because they return different things.
  - **Pre-paint dark routes:** they now follow the theme provider's rule, so `/pricing`, `/blog`, `/brand-kits`, `/connect` and `/mobile` are dark from first paint instead of flipping after hydration.
- **Second pass (checking subagents and code review):**
  - forwarding re-exports removed
  - run-id prefixes, media keys, upload limits and validator unions given one owner each
  - per-call processor versions that the queue floor already enforced removed
  - skill bodies made lazy again
  - `GEMINI_FRAME_MODEL` forwarded to Railway workers
  - dead footage-panel and composer branches removed
  - browser-storage helpers moved into `lib`

## Left for later (worth fixing; each needs a decision or a larger change)

- **Run lock check:** about 30 inline copies of `!aiRunning || aiRunId !== runId` across the Convex function files should become one `requireRun` in `convex/lib/active_run.ts`. Their error texts differ slightly.
- **Runner allowlist:** `convex/agentRunnerHttp.ts:12` lacks `comparisonContinuations:*`, `lanes:clipQa` and `referenceReads:resumeFrames`. All three are called from in-app turns.
- **Media task kinds:** one declared table per kind (`lib/server/media-task-runner.ts`, `convex/mediaTasks.ts`, `local-worker-capabilities.ts`).
- **`MIN_PROCESSOR_VERSION`:** most entries equal the current version.
- **Tool registry:** per-tool facts such as approval-free, read-only and lane lists should live on `EDITOR_TOOL_DEFINITIONS`. Deriving `APPROVAL_FREE_TOOLS` exactly would change 7 read tools' schemas.
- **Recreation-only positional parameters** on `enqueueMediaTask` and the reference-read runners.
- **Editor and workspace components:** they still import each other in both directions, with no file-level cycle.
- **Editor store:** the edit lock and the selection should live in the editor store.
- **Voice tools:** decide whether to re-enable or delete them.
- **Drag-and-drop:** the effect and stock-audio drop handlers have no drag source.
- **Skill text:** it still names `addClipTransition` and `configureClipTransition`, which don't exist; the tool is `addTransition`.
