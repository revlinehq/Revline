# Editing workflows and supporting capabilities

`edit` is the compatibility value for shared editing without a selected style. The picker offers Auto and optional primary workflows; stored `edit` and MCP `setLane` remain valid. Shared trims, captions, audio and timeline operations work immediately after task creation. Timeline writes still promote finish enforcement, including requests initially marked as questions.

The primary workflow owns the deliverable and completion checks. `/clip` and an explicit style pin it for the request. `discoverCapabilities(query)` returns at most five matching workflow/skill descriptions. `loadCapability(name)` adds supporting tools and a small skill index; `readSkill(name, page?)` loads one body/page and its tools. Neither changes the primary workflow, task ID, failure budget, clipping ledger or user decisions. Capabilities persist on the owner-checked task across continuations and MCP calls.

The app exposes shared tools plus primary and loaded supporting tools on each step. MCP tools/list uses the current authenticated connection's task; refresh after startTask, setLane or loading support. Loading responses also return relevant tool schemas for clients with cached catalogs. Execution still checks the exact task and target. Tool schemas, specialized catalogs and full skill text are not all injected eagerly.

## Check levels

Each lane's `definition.ts` owns its check recipe. The lane is the only thing that changes which checks or tools run; model and reasoning effort stay user choices and never change them. The app and MCP read the same recipe from the task row.

- `edit`: getFrames at each change ±1 frame; no whole-video sweeps or reference/motion tools.
- `reel`: saved-data checks (retained ranges, linked audio, caption timing) plus one getFrames sample of new styling or framing; no per-cut frames.
- `clip`: finishClipping data checks; visual confirmation only for action moments.
- `motion`: always full checks.
- `recreate`: always full checks plus reference comparison.

One automatic step-up, the `final` level, runs the lane's full checks (clip: checkClip framing and decode-health on every accepted tab). The server sets it in `lanes.begin` from the request: a final export or publish request, or an explicit request to double-check everything. The agent never chooses it. Stored `editMode` values on older queue rows, turns, runner checkpoints and browser storage still validate and are ignored.

History keeps source evidence and edit receipts across workflow changes. Only obsolete instruction results are retired; tool pairs remain valid. Older bulky results retain bounded structured IDs, findings and receipts, and omitted turns carry forward bounded user decisions and evidence. Current user instructions always take precedence.

Reel means one coherent short-form rough cut: transcript/audio first, false starts and accidental repeats removed while preserving full meaning and natural delivery, with targeted visual inspection as needed. Duration follows the message unless specified. New captions share minimal static, transparent-background creation defaults. Existing captions retain their styling. No automatic normalization or decoded-opening/full-film QA is required; structural, changed-range and applicable transcript-sync checks remain real.

## Branch integrations

- `find-highlights` (draft PR #58, commit `c7c8f53`, processor contract 38; not merged or deployed): reserve `findHighlights`, `planClips`, `checkClip`, `finishClipping`. Pass server-owned `EditorToolkitOptions.taskId`. Query `clipping:completionState` with `runId:taskId` and explicit `timelineId` when supplying a draft. Both `required:true` and `passed:true` are necessary; missing or candidates-only manifests fail. Discovery uses PR #58’s required Gemini judgment, with no silent signal-only substitute. The upstream persisted candidate ledger and worker receipts supply found/accepted/tab counts. `mcp-task:<uuid>` is used verbatim as the ledger `runId`, independently of each MCP execution run. Only snapshot worker completion writes check receipts; completion rechecks the current tab fingerprint and rejects an untrusted or stale supplied draft. Preserve PR #58’s deterministic `finalMessage` close-out when resolving the shared `editorTurn` integration. Deploy the merged Convex functions and matching Cloudflare runner together, with a contract-38-capable processor. Live ledger/UI verification remains pending.
- Reference motion (#51): recreate owns motion coverage and completion; motion applies these checks only to a film already bound to a reference. Finish reads `referenceMotion.state` using the film's reference/range, current revision, `motionTimelineKey`, full-frame scope and aligned offset. Whole-film pixel review uses real paired samples at 10 fps, with no pixel-score pass threshold. Timed OFF exceptions clear their windows and persist in the finish result and final close-out, always marked not matched. Publishing a draft requires motion checks at its new revision. Other lanes do not run these gates or reports; never parse display-only `motionStatus()` as evidence.
- Main includes link imports (#53), R2 frame caching (#54) and Inspo Motion retirement (#56). Frame reads use the shared cached paths; only `/clip` is a slash command. No pending registration hooks remain for these integrations.
- Main also includes clipping failure fixes (#55), worker capability admission and optional-provider failure persistence. The isolated lane dev worker starts paused and claims no shared tasks.
