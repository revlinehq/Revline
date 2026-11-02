# Tool save receipts

## Development audit, 2026-11-02

Read-only inspection of `majestic-alpaca-541`, covering 2026-11-01 17:20 UTC
through 2026-11-02 17:20 UTC, before the throwaway verification runs. The
persisted `assistantMessageViews` contained 57 message rows in that window;
4,447 rows were inspected to reach the beginning of the window. Image/content
outputs were unpacked before counting their save fields. No original prompts,
scene code, media or credentials are included here.

The false-warning tools in the two recent editor turns were **`readBrief`**
(at 17:13:43 and 17:18:38 UTC), returning `{ rules: [] }`. The first turn saved
one graphic. The second saved its volume change and published its staged trim:
publication receipt `1793639910457-0.38790478179865795`, staged revision 3,
saved revision 4. Reading the brief did not attempt a timeline write.

Every observed editor tool without either `saved` or `unchanged` in at least
one real result is listed below. These are mostly legitimate reads, not failed
saves. `previewRender` returned an explicit analysis error. `trim` and
`planEffects` had `saved: false` and a revision; a staged trim is confirmed by
its publication, and an effect plan is analysis. `patchScene` retained its
save evidence inside an image-content text part.

| Tool | Results lacking both fields | Result |
| --- | ---: | --- |
| getFrames | 12 | Rendered frames/content |
| readSkill | 10 | Editing instructions |
| inspectTimeline | 7 | Timeline and source metadata |
| readBrief | 3 | Brief rules |
| inspectClip | 3 | Clip/code inspection |
| getSound | 2 | Audio measurements |
| previewRender | 1 | Explicit analysis error |
| recordFix | 1 | Saved diagnostic record |
| motionMap | 1 | Motion measurements |
| checkPacing | 1 | Pacing measurements |
| diffScene | 1 | Scene difference |
| getBlueprint | 1 | Blueprint/content |
| readFrames | 1 | Source frames/content |
| listRevisions | 1 | Revision history |
| getBrandKit | 1 | Brand data |
| listBlueprints | 1 | Blueprint list |
| inspectAssetAnalysis | 1 | Source analysis |
| listBrandKits | 1 | Brand list |

The server incident groups additionally captured these MCP results in the same
day. Counts below exclude this branch's later verification calls.

| Tool | Incidents | Missing-evidence result |
| --- | ---: | --- |
| updateBrief | 16 | Persisted rules and updatedAt |
| followSubject | 5 | applied:false with insufficient framing evidence |
| trackPoints | 4 | Tracking-job acknowledgement |
| smoothSlowMotion | 2 | Background interpolation acknowledgement |
| getTrack | 2 | Saved tracking samples |
| detectFacecam | 1 | Facecam analysis |
| removeBackground | 1 | Background-removal acknowledgement |
| normalizeAudio | 1 | alreadyNormalized:true, applied:false |

## Contract

`lib/ai/tool-definitions.ts` defines each registered tool's effect and MCP
access. The registration attaches that exact definition as metadata. Toolkit
startup checks both directions: every registration must carry its definition,
and every definition must have a registration. Resource and job definitions
must name their acknowledgement mutations. Read classification, result
presentation and MCP lock handling derive from this source.

`ToolSaveReceipts` runs each invocation in its own async scope. Every mutation
from an editing tool passes through `toolWrites.run`. Convex runs the original
mutation as a sub-transaction, compares the project revision before and after,
and inserts a small receipt in the same transaction as a successful write.
Direct timeline writers therefore need no tool-specific save envelope.
Resource writes and accepted jobs use the tool definition's acknowledgement
mutation. A returned error envelope rolls back the sub-transaction.

The tool layer overwrites hand-written save flags with its receipt: `saved`,
`unchanged`, `staged`, `revision` and `saveReceipt`. Successful no-ops get
`unchanged: true`; accepted background work gets a queued receipt and does not
claim a timeline edit. Private checkpoints remain staged until their matching
publication receipt. Image-output conversion preserves the receipt, and the
chat unpacks structured text parts when reading it. A saved publication remains
final when the SDK combines message parts or a later cleanup appends a failure;
obsolete failure prose is removed from both text and rendered blocks.

A lost mutation response triggers a receipt query without replaying the write.
A recovered write remains saved, and the session reloads its committed state.
A later error cannot erase a committed write. Only a known rolled-back mutation
or a failed/aborted publication can produce a save-failure card, with the tool
name. An unknown transport outcome is an interrupted step, not proof of a
failed save. Legacy results without receipts stay in the tool history rather
than becoming invented failures. A read, render or cleanup error can report an
unfinished step, but only an explicit failed write/publication gets a failed-save
heading.

The web agent inside Convex, Cloudflare runner and MCP all construct the same
toolkit. The runner bridge exposes the scoped receipt functions; the nested
mutation dispatcher has a bounded allowlist and rejects mismatched owners,
projects or runs. Receipt rows use an exact write-id index and expire after a day through bounded
cleanup. They also cache mutation return values so an interrupted response can
be replayed without repeating the mutation; large values use bounded result
parts. Mutation inputs are not retained. Editor queries do not subscribe to the
receipt tables.

## Live verification

The throwaway development project is `j974jyf6affmrr40hxb7he72a58hf5ja`.
The baseline browser run reproduced the false warning after `readBrief` and a
saved title. Desktop (1440 px) and phone (390 px) screenshots were captured
from the running app.

MCP confirmed a brief save as a resource receipt at revision 1, a marker save
at revision 2, an unchanged repeated marker at revision 2, and a staged title
delete published at revision 3. Its outer result and nested receipt both named
saved revision 3. A real stale-revision mutation was refused; revision 2 and
the persisted timeline remained unchanged during that check.

A fresh native Convex `assistantActions.respond` turn ran `readBrief`,
`inspectTimeline`, `editText` and `getFrames`, saved revision 5, and completed
normally. This check exposed an existing use of the Node-only global `Buffer`
in frame serialization; portable byte conversion now works in Convex and the
Cloudflare runner.

PR #23 merged during this work. Development deployment used a temporary
checkout combining current main, this branch, and the already deployed
storage/account/incident changes from concurrent sessions. Those concurrent
changes are not part of this PR. Only `majestic-alpaca-541` and
`revline-agent-runner-dev` were deployed; production was not deployed.

The headless browser on port 3012 then ran `readBrief`, `inspectTimeline`,
`readSkill`, `delete`, `addGraphic` and `getFrames` through the Cloudflare runner.
Both edits stayed staged at revision 5 until publication saved revision 6;
the completed turn showed no failure card. A late failed cleanup added no
failure receipt under the matching deployment and left the error clear. The
chat also keeps the saved receipt authoritative if an older deployment has
already appended a contradictory failure for that same run/base revision.
A final marker edit saved revision 7, and its repeat confirmed unchanged
revision 7 using only the mutation's receipt.


## Continuing a turn without another user bubble

The original Retry path called `onSend` with a new continuation instruction.
Both the optimistic chat and `assistant.send` therefore created a new user
bubble. Retry now sends only the original prompt ID to `assistant.retry`.
The server validates its project/thread/owner, keeps that prompt and its saved
context, and starts an assistant continuation. Double clicks during an active
continuation are a no-op. Completed turns are not rerun.

`assistantTurns` checkpoints the original arguments, pass, generation, saved
edit count and outstanding frame checks. Stream errors and publication errors
now stay inside `editorTurn`'s existing two repair passes. A lost runner,
watchdog timeout or native Convex workflow failure schedules the next pass of
that same loop. The budget survives process restarts; it is not a new retry
loop. Explicit Stop marks the turn stopped and invalidates its lock. A new
generation fences older tool mutations and finalization, aborts stale streams,
and restores only a private draft matching this run's current base revision.
Configuration, billing and token-budget failures still stop with a specific
message rather than spending repair passes on an unavailable capability.

Each tool call uses a stable identity and per-function mutation ordinal.
Repeated calls in one toolkit share their result. Across restarts, a repeated
write returns its cached transaction result; a saved timeline is reloaded
before continuing. A late publication uses its base revision in the stable
publication identity. An interrupted HTTP response is retried with that same
identity, including no-op and job acknowledgements. No possibly committed
mutation is blindly repeated. The chat suppresses historical failure rows
while a turn is recovering and retires them only after durable completion.
A verification error cannot poison an already corrected private checkpoint.

### Follow-up runtime evidence, 2026-11-02

Only the newly created throwaway project
`j9789a02r81atrsk8dqyzg2yb98hf5ka` was edited or interrupted for these checks.
Its owner and title were verified before mutation. The visible user bubbles
in the screenshots are deliberate verification prompts, not messages inserted
by recovery.

- A real HTTP proxy dropped the first response **after** `assistant.apply`
  committed. The tool sent two requests with one write identity, returned saved
  revision 3, and left exactly one `Transport recovered` marker. Revision moved
  from 2 to 3 once.
- With the browser closed, the runner for original prompt
  `kx7cpv7jaht63jz2pgt9e05d7s8hffgr` was interrupted after its title saved.
  Convex scheduled pass 1, generation 1 under the same run and prompt. It
  completed with the original single title, revision 2 and one saved edit.
- Three forced runner interruptions exhausted passes 0, 1 and 2 for prompt
  `kx763ntvtc2gvpy3c6022dvzr18hfrt0`. The app showed one failure card. The
  browser's Retry check kept all three user-message IDs unchanged. The same
  original prompt completed under run `638130c7-35d1-47f8-8d03-521a2f2c96ce`
  at revision 5 with no error, after the browser was closed again.
- Repeating one `addGraphic` tool-call ID in the same toolkit and a fresh
  toolkit saved only revision 6 and one new clip. The restarted session
  reloaded the saved timeline exactly.
- A deletion was interrupted with a validated private draft still based on
  revision 6. The next pass restored that draft and published revision 7,
  leaving the main title and marker intact, with no error. This was one fourth
  deliberate verification prompt; recovery added no prompt of its own.

Development uses this branch merged with current main. A temporary integration
also preserves the already deployed account-consent/deletion and incident
functions; those unrelated changes are not included in this PR. The target is
only `majestic-alpaca-541` and `revline-agent-runner-dev`.
