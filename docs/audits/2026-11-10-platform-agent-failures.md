# Why the in-app agent fails where MCP agents succeed, 2026-11-10

Scope: the in-app editor agent (`convex/lib/editorTurn.ts`, `editorToolkit.ts`, `editSession.ts`, lanes, runner) against the MCP path (`convex/mcpActions.ts`) for one request: "cut this talking-head clip to 40–50 s, add captions, finish". Read against `main` at `d9330669`; line numbers are for that commit. CONFIRMED means seen in production data, a dev incident, or a run of the real module. PLAUSIBLE means read in code only.

## Summary

MCP agents succeed because each call is independent: one tool, saved at once, an error is just text, and the agent decides what to do next with a frontier model and no step rules. The in-app turn wraps the same tools in a loop with seven extra rules (forced tool calls, three-strike stops, a three-pass retry budget, staged drafts, a recovery guard, per-message capability reset, a three-attempt finish). Each rule is reasonable alone; a small model at low effort trips them in combination. The founder's session (Haiku 5.5, low effort, 14 turns) hit five of them in 19 minutes.

Already fixed on main and not repeated here: #250, #251, #252, #255. Open elsewhere: #253 (draft wording), #254 (`askUser` length), `feat/reel-script-understanding`.

## (a) In-app-only failure causes, ranked by frequency × severity

| # | Cause | Where | Why MCP does not hit it | Status | Fix, effort |
|---|---|---|---|---|---|
| 1 | **Runaway read loop.** Once a timeline tool is intended, every step must call a tool (`toolChoice:'required'`), text is withheld, and nothing caps identical successful reads before step 50. Claude history is append-only, so each `inspectTimeline` payload stays in context. Prod: 38 calls in a row, 59 model calls, 24.7M input tokens (about 420k per call). | `editorTurn.ts:184`, `lib/ai/lanes/task.ts:97-126`, `lib/ai/edit-progress.ts:26-42`, `lib/ai/token-budget.ts:234-240` | No forced tool choice; the agent just answers. | CONFIRMED (prod) | #260, S. Remaining: let a step end in text when no edit is possible, M. |
| 2 | **Turn stays "running" with no output.** No timeout on a model call; the runner heartbeat (30 s) is a timer and outlives a dead stream; `watch` only fires on a stale heartbeat. In-app analysis waits are unbounded while a worker heartbeats. Only Stop unblocks, and Stop discards the staged draft. | `editorTurn.ts:167-194`, `convex/agentRunner.ts:12,119-131`, `editorToolkit.ts:501-516` | Each call has a 9 min limit and a scheduled lock release at 11 min. | CONFIRMED (prod) that it hangs; cause PLAUSIBLE | #261, S (silent model call). Tool wait ceilings, M. |
| 3 | **Three identical failing calls end the turn, not repairable.** Prod: `retainSourceRanges` failed 7 times because every retry reused clip id `4e459f7a` after the first cut had replaced it. The stop message names no tool and no reason. | `lib/ai/tool-failures.ts:209`, `editorTurn.ts:123,202,285` | No such rule; MCP retries freely. | CONFIRMED (prod) | #257 removes the false case (free `finish` refusals), S. Replace the hard stop with one targeted hint ("this clip id no longer exists, inspect first"), M. |
| 4 | **Recovery guard.** After any failed turn every edit is refused with "Inspect the current timeline before continuing the saved edit." until one `inspectTimeline` succeeds; edits sent in the same step all fail. Prod: 5 times. | `editorToolkit.ts:409,1182`, `editorTurn.ts:100` | MCP passes `recovering:false`. | CONFIRMED (prod) | #260 names the clearing call, S. Run the inspect automatically on the first edit, S, needs decision. |
| 5 | **Three failed `finish` checks close the task**, including failures the agent cannot repair (render timeout, busy worker, missing transcript). Prod: 6 failed checks (caption mismatch, fixed by #252). | `lib/ai/lanes/task.ts:6`, `convex/lanes.ts:384-394`, `convex/lib/laneFinish.ts:159-191` | Same limit, but a new `startTask` resets it and other project tools keep working. | CONFIRMED (prod, dev) | Do not count infrastructure failures as attempts, M, needs decision. |
| 6 | **Capabilities reset on every message; withheld tools return a raw SDK error.** A new message is a new task with no loaded capabilities, while history shows the tool being used; the call returns "Model tried to call unavailable tool" plus ~90 names. | `convex/lanes.ts:228-251`, `editorToolkit.ts:242`, `lib/ai/lanes/history.ts:27-36` | Capabilities persist for the task; a gated call returns the exact `loadCapability` step. | CONFIRMED (code; same family as prod #249) | #259, S. Carry capabilities across turns of a tab, M. |
| 7 | **Small model, low effort, large surface.** Haiku 5.5 at low effort, about 90 tools per step, a 1,900-word system prompt plus lane and check text every step, lane picked by the model. Prod: first cut 22.3 s for a 40–50 s request. | `lib/ai/claude-model.ts:98-102,149-158`, `editorTurn.ts:123-155` | Frontier model, long budget. | CONFIRMED (prod) | See (c). |
| 8 | **Staged drafts are lost without notice.** Stop deletes the draft; a runner or workflow interruption finishes without a publication receipt and clears the draft; `askUser` with a conflicting draft drops it silently. | `convex/assistant.ts:293-313`, `convex/agentRunner.ts:51,114,127`, `editorTurn.ts:201`, `editSession.ts:199-208` | Every call publishes its own edit. | Stop CONFIRMED (prod); others PLAUSIBLE | #253 covers wording. Write a receipt whenever a draft is dropped, M. Save each staged step, L, needs decision. |
| 9 | **One retry budget for everything.** `MAX_REPAIR_PASSES=2` is shared by model repairs, provider errors (429/529, retried at once, no delay) and runner restarts. | `convex/lib/assistant_run.ts:7`, `editorTurn.ts:225-229`, `convex/assistantTurnRecovery.ts:95,153` | Each call stands alone. | PLAUSIBLE | Back off before a provider retry; separate counters, S–M. |
| 10 | **Failure card shows the model's repair prompt or raw JSON.** | `editorTurn.ts:224`, `convex/lib/laneFinish.ts:24` | MCP returns the tool's own text. | CONFIRMED (dev incident) | #258, S. |
| 11 | **Token ceilings are all-or-nothing.** With `EDITOR_ENFORCE_TOKEN_BUDGET` off (production, proven by the 24.7M turn) there is no ceiling. With it on, each Claude call reserves 128k of a 150k output ceiling, so a turn dies after about 22k output tokens (12 calls of 2k in a module run). | `lib/ai/token-budget.ts:8,207-210`, `lib/ai/claude-model.ts:183` | No budget. | CONFIRMED (module run) | #260 adds a 20M backstop. Do not turn the flag on for Claude until the reservation is fixed, M. |
| 12 | **In-app tool failures are invisible.** Only MCP calls write `tool-failure` incidents; `reportIssue` uses one location for both paths. | `convex/mcpActions.ts:204,217`, `convex/incidents.ts:41` | n/a | CONFIRMED (300 dev rows: 120 tool failures, all MCP) | Record in-app failures with their source, S. Not done. |
| 13 | **One Gemini failure switches video off for the whole run**, including a plain timeout; `inspectVideo` has no worker lane. | `editorToolkit.ts:325-341`, audit B7 | Latch is per call. | PLAUSIBLE | See (e). |
| 14 | Sonnet and Opus 5.5 reject forced tool use; the SDK downgrades to `auto` but still raises `ToolChoiceViolationError` on a text-only step. | `ai` 7.0.137 `index.js:8380`, `@ai-sdk/anthropic` model table | No forced choice. | PLAUSIBLE | Use `auto` for those models, S. |
| 15 | A failed partial save replaces the real reason; "No timeline changes were saved" can sit beside "N changes were saved"; memory writes count as "changes saved". | `editorTurn.ts:246`, `editSession.ts:10`, `components/editor/assistant-turn-presentation.ts:41` | n/a | PLAUSIBLE (sweep, not re-read) | S each. |

## (b) Rules that withhold tools or drop a draft

**Tools withheld (in-app only unless noted)**

| Rule | Trigger | What the model is told |
|---|---|---|
| Lane and capability gate | tool not in the lane or a loaded capability | Before #259: SDK "unavailable tool". Over MCP: the `loadCapability` step. |
| Full-check tools | lane recipe without `fullTools` (`editorTurn.ts:181`) | Nothing in-app before #259. |
| `exportVideo` | no export confirmation in the request | Nothing in-app before #259. |
| All tools | `finish` passed (`activeTools=[]`) | Nothing; text is now allowed. |
| All tools | three failed `finish` checks | Turn throws; MCP: every call returns the exhausted error. |
| Forced tool call | finish required and not passed | Text withheld by `laneReplyGate`. |
| Edits | recovery guard until `inspectTimeline` | "Inspect the current timeline…" |
| Edits | draft conflict (`needsInspection`) | "The timeline changed elsewhere…"; a staged inspect does not clear it (`editSession.ts:151-153`), needs decision. |
| Analyses | 15 per run (`assistant.ts:677`) | "Too many analysis requests in one AI run". |

**Drafts dropped or left unsaved**

| Event | Result | User told the truth? |
|---|---|---|
| `finish` passes, or turn ends normally | published | Yes |
| Error, step limit, token limit, repeated failure | `savePartial` publishes the last valid draft | Yes after #253 |
| User Stop | draft deleted, queue paused | Card says "not saved", reads as a failure |
| New user message replaces the run | `aborted` receipt | Yes |
| Runner silent, evicted or workflow killed, passes used up | draft cleared, no receipt | No |
| `askUser` while the draft conflicts | dropped | No |
| A step failed and was never corrected | `complete` throws "pending replacement was not saved" | Yes |
| MCP tool returns `success:false` | that call's draft dropped | Error text only |

## (c) Recommended defaults

Today: Haiku 5.5 on production by `EDITOR_DEFAULT_MODEL`, effort `medium` unless `EDITOR_DEFAULT_EFFORT` or the user's pin says otherwise (the founder's session was pinned to low); free accounts GPT-6.1 Terra at low; 128k max output for Claude; adaptive thinking; 5-minute prompt cache; 50 soft and 100 hard steps, 8 per repair pass, 2 repair passes; no token ceiling in production.

- **Model:** Sonnet 5.5 as the paid default for editing lanes (reel, clip, motion, recreate); keep Haiku for questions and single-step edits. The session shows Haiku's failures were comprehension (22.3 s for 40–50 s, "you missed a lot of my pitch") and recovery (same clip id seven times), which rules do not fix.
- **Effort:** medium as the floor for any turn that edits; offer low only for questions.
- **Steps:** keep 100 hard; move the no-progress stop from step 50 to 15 steps without a saved or staged change; keep the new six-identical-reads stop.
- **Budget:** 20M input backstop (#260) now; then a real per-turn ceiling of about 3M weighted input, with the Claude output reservation fixed.
- **Cost:** Claude and Gemini prices are not in the repo (`lib/ai/cost-log.ts:21` logs them as unreviewed), so no dollar figure is given here. In tokens: the loop turn used 24.7M input; a normal reel turn of 15 to 25 steps at a 60–120k context is 1–3M, mostly cache reads. A model three times the price that finishes in one turn costs less than Haiku failing four turns.

## (d) The five changes that cut failures most

1. Stop loops and hangs: #260 and #261.
2. Replace the three-strike hard stop with one specific hint per failing call (stale clip id, overlap, missing transcript), then stop.
3. Raise the model and effort floor for editing turns (c).
4. Make state survive between messages: carry loaded capabilities, run the recovery inspect automatically.
5. Record in-app tool failures as incidents with their source, so the next audit reads counts instead of code.

## (e) How should the in-app agent see video?

Two paths exist. Token figures use the rule of thumb width × height / 750, capped near 1,600 per image; the repo holds no Claude or Gemini price.

| | Frames to the editing model | Gemini video inspection |
|---|---|---|
| Tools | `getFrames` (1–4 rendered frames, 768 px, about 440 tokens each), `readFrames` (up to 30 source frames tiled in one 1,600 px sheet, about 1,600 tokens) | `inspectVideo` (source window; clip lane ≤60 s, 12 windows / 600 s per batch), `inspectFrames` (≤3 s, ≤12 frames). The editor gets text only. |
| Sees | Exact pixels at chosen instants. No motion, no sound. A 30-frame portrait sheet shows tiles of about 162 × 289 px. | Motion and sound over time. Cannot be checked against pixels. |
| Cost | Cheap per call, but Claude history is append-only: 20 images are about 30k tokens re-read on every later step. The enforced budget reserves 8,192 per image, five times the real cost. | One provider call per window; no fps or resolution is set, so provider defaults apply. |
| Speed and limits | `getFrames` waits up to 280 s; `readFrames` returns a pending handle after 45 s. Quick worker lane. | 240 s request expiry; no worker lane, queued behind exports (audit B7); up to 3 worker retries. |
| Failure | Clear text, retryable. | A 402 pauses all Gemini work for the owner for 15 minutes; any failure, including a timeout, disables video for the rest of the run. No automatic fallback. |

Recommendation:

- **Reel:** transcript and audio first; frames for looks at cut edges (one `readFrames` sheet of the frames around each join). No Gemini.
- **Clip and gameplay:** Gemini for action moments, because the question is "what happens over these seconds". Keep the 12-window budget.
- **Motion and recreate:** frames and the measuring tools (`motionMap`, `trackReference`, `readFrames` at source fps). Gemini timings are not exact enough.
- **Edit:** `getFrames` at changed spots only.
- **Fallback:** when Gemini is unavailable, `inspectVideo` should itself return a `readFrames` sheet of the same window (say 12 frames) with the audio-activity summary, marked as a fallback, instead of `available:false`. Latch the run only for billing or configuration errors; a timeout or a validation miss gets one retry. Give `video` its own worker lane. Clip-lane checks should accept frame-sheet evidence for non-spoken moments while Gemini is paused (a dev report shows `planClips` refusing every non-spoken candidate).

No live measurement was possible here: Gemini returns 402 on the dev deployment.

## Evidence

- Production session `jh7ck…` (14 turns, Haiku 5.5, low effort, reel): `retainSourceRanges` ×7, failed `finish` ×6, recovery guard ×5, `AI_NoSuchToolError` ×4, caption overlap ×2, `askUser` length ×1, one abort; the 38-call loop; the hung restore turn.
- Dev incidents, latest 300 rows (2026-11-03 to 11-09): 120 `tool-failure` (all MCP by construction), 79 `agent-report`, 21 `turn-failure`. In-app turn failures: "Could not finish: finish" ×9, three failed finish checks in every lane, the leaked repair prompt, "The operation was aborted", runner 403.
- Prod issues: #247, #248 (fixed by #250), #249 (fixed by #251).
- Module runs: free refusals no longer strike (#257); Claude budget dies at 12 calls of 2k output; six identical reads stop; a stalled mock stream raises "Chunk timeout".

## Not verified

- No fix was run in a live in-app turn. The isolated backend was not started: the first dependency install filled the disk, and the editor's MCP server needs sign-in in this session. Every fix has typecheck, build and a run of the real module where one applies.
- The cause of the hung turn (#261 covers a silent model call; an unbounded tool wait is the other candidate).
- The cached share of the 24.7M tokens, and why the model chose `inspectTimeline` 38 times; the forced tool call is the structural reason, not a proven one.
- Production values of `EDITOR_DEFAULT_EFFORT` and the SDK's retry count.
- Row 15 and the interruption rows in (b) come from a read-only sweep and were not re-read line by line.
