# Assistant run path: design proposal

Date: 2026-11-12. Author: the run-path audit agent. Status: proposal, no code.

The audit's defects are fixed in #342 (merged), #350 and #353 (drafts). This document covers the larger design items that are not defects: each works, and each costs time, money or reliability on every edit. For each: the simplest design, the saving, the risk, and the order I would do them in.

## Where the numbers come from

All measurements are from real chat runs on an isolated backend on 2026-11-11 and 2026-11-12: one project, one 5-second clip, three small edits per request (caption colour, clip volume, one new caption), five requests in the same chat. Token counts are the providers' own, read from `aiCostRecords`.

| Request in the chat | Model | Model calls | Input tokens, first call | Input tokens, last call | Cache read on last call |
|---|---|---|---|---|---|
| 1st | GPT-6.1 Terra | 5 | 25,473 | 8,763 | 0 |
| 2nd | GPT-6.1 Terra | 7 | 28,242 | 15,570 | 2,103 |
| 3rd | GPT-6.1 Terra | 7 | 34,007 | 20,573 | 2,103 |
| 4th | Sonnet 5.5 | 6 | 67,534 | 35,092 | 3,402 |
| 5th | Haiku 5.5 | 6 | 75,474 | 43,002 | 0 |

Two things follow from the table and are used below:

- The last call of every request carries no tools (they close once `finish` passes), so it is the system prompt plus the chat history. First call minus last call is roughly the tool definitions: about 17,000 tokens by OpenAI's count and about 32,000 by Claude's.
- History grows by about 5,000 to 8,000 tokens per earlier request (the last-call column: 8.8K, 15.6K, 20.6K on the same model).

Counts from the code, not measured: 146 tool descriptions totalling 93,488 characters, 25 of them over 1,000 characters; a fixed system prompt of about 11,700 characters.

Nothing here uses the timed runs from `audit/assistant-edit-speed`; I have not read them.

## The items, in the order I would do them

### 1. A long chat carries every earlier request into every step (founder's item)

**What happens now.** Each model call loads the latest 100 saved messages. The two most recent earlier requests are kept exact, tool calls and tool results included (`FULL_TURNS = 2` in `lib/ai/history-compaction.ts`). Older ones keep every tool result up to 4,000 characters each. The whole history is cut only when it passes 120,000 characters. A failed or stopped request is kept the same way as a finished one: its tool results, including ones that say `staged: true`, stay in front of the model, and the system prompt spends a paragraph telling the model not to believe them. That is how a second run came to reuse an earlier run's result.

**Measured.** About 5,000 to 8,000 tokens per earlier request, on every step of every later request. By the fifth small request the history and system prompt were 43,000 tokens on Haiku.

**Simplest design.** An earlier request contributes three things and nothing else: what the user asked, what the assistant answered, and one line written by the server from the turn record (finished or not, saved revision, how many edits, the failure reason if any). No tool calls and no tool results from earlier requests. The current timeline and media are already in the prompt and are the truth; an old tool result can only be stale.

**Saving.** Each earlier request shrinks from 5,000 to 8,000 tokens to roughly 200 to 400. At the fifth request that is about 30,000 fewer tokens on every step. It also removes the stale-result failure and lets the "do not trust earlier staged results" paragraph go.

**Risk.** The model loses evidence it gathered earlier in the chat (a transcript window it read, a frame it looked at). The saved analysis is still one tool call away, and the carry-over note can name what was read. Low.

**Size.** Small: one function, `compactEditorHistory`.

### 2. The per-step note breaks the cache and drops the model's reasoning

**What happens now.** A lane and checks note is appended to every step and never stored, so each request's history differs from the last one's. On Claude, every replayed thinking block then fails the provider's unchanged-history check and is dropped (the request sets `drop_block`). Separately, once `finish` passes the tools are removed from the request; tools come first in the cached prefix, so the closing step pays for the whole prompt again.

**Measured.** The closing Haiku step read 0 tokens from cache and wrote 43,002. The closing Sonnet step read 3,402 and wrote 31,686. On Sonnet at $2 per million input tokens with cache writes at 1.25x, that one closing step is about 8 cents of a small edit; on Opus twice that.

**Simplest design.** Two changes. Keep the tool list on the closing step and tell the model in text that the request is checked and it should reply (the reply gate already refuses tool intent after `finish`). Send the per-step note as a turn-scoped reminder (the provider's `clear_at: next_user_message` system message) so earlier copies stay in the transcript and the history stays append-only.

**Saving.** The closing step reads from cache instead of rewriting it: on the measured runs about 31,000 to 43,000 tokens move from the write price to the read price (a tenth of input). Claude keeps its reasoning between steps, which should reduce re-planning; I have no measurement for that part.

**Risk.** A model may still try a tool on the closing step; the existing withheld-tool reply handles it. The reminder message needs a beta header on Claude. Low to medium.

**Size.** Small to medium.

### 3. Polling with writes

**What happens now.** Frame, sound and loudness jobs are polled every 1 to 1.5 seconds with a mutation (`mcp:takeFrames`, `referenceReads:take`). Inside an editing tool each poll goes through the save-receipt path and stores a row for 24 hours.

**Counted.** Up to 540 stored rows for one loudness normalization (a 540-second wait at one poll a second); up to 280 for a face-measurement read.

**Simplest design.** Poll with a query and take the result with one mutation when it reports completed. The query already exists (`mcp:frames`); `checkPacing` and `getSound` use it.

**Saving.** The receipt rows drop from hundreds to one per job, and the poll stops being a write transaction.

**Risk.** None I can see.

**Size.** Small.

### 4. Twelve to sixteen Convex runs around every tool call, and a 2-second poll

**What happens now.** Around each tool call the toolkit re-reads the whole task row (up to 650 KB of stored check evidence), checks the baseline, hashes the timeline twice and writes evidence; an editing tool also writes a receipt and a save observation. On the runner each of those is a signed HTTP request plus a nonce write, so two Convex transactions each. The run also asks "am I still active" every 2 seconds, and re-checks the owner's subscription before every model step.

**Counted.** Six to eight bridge calls per tool call, so about 12 to 16 Convex function runs; about 60 more per minute from the 2-second poll.

**Simplest design.** Read the task row once per model step and hand it to the tools of that step. Return the task's small fields without its evidence unless a check asks for it. Drop the 2-second poll: Stop already reaches the runner directly (`/runs/stop`), and the 30-second heartbeat already returns whether the run is active. Check the subscription at start and on resume, not per step.

**Saving.** Roughly half the round trips per tool call, and the per-minute polling goes to two.

**Risk.** A Stop that fails to reach the runner is noticed up to 30 seconds later instead of 2. Tool writes are refused server-side once a run is stopped, so nothing is saved late; the cost is model time. Low.

**Size.** Medium.

### 5. A 75,000-token prompt to recolour a caption

**What happens now.** Every request carries every available tool with its full description, the system prompt and the project.

**Measured and counted.** Tool definitions are about 17,000 tokens by OpenAI's count and 32,000 by Claude's. 146 descriptions total 93,488 characters. Haiku 5.5 bills five times more above 100,000 prompt tokens; the fifth small request was at 75,474.

**Simplest design.** A description says what the tool does and its argument rules in two or three sentences. Usage guidance (when to prefer it, worked examples, what other tools to call first) moves to the skill pages the model already loads with `readSkill`. The largest 25 descriptions are the place to start.

**Saving.** If the 25 descriptions over 1,000 characters drop to about 300 each, that is roughly 30,000 characters, a third of the total. With item 1 the fifth request would be near 35,000 tokens instead of 75,000.

**Risk.** This is the one with real quality risk: descriptions carry rules that stop wrong calls today. It needs the same requests run before and after, not a bulk edit. `fix/assistant-transcript-first-order` owns guidance text; this should be done with that agent.

**Size.** Medium, mostly evaluation time.

### 6. Behaviour decided by matching English sentences

**What happens now.** Whether an error is a conflict, whether it may be retried, which failures count three times, and what the chat shows are all decided by regular expressions over message text: in `editSession.ts`, `editorTurn.ts`, `lib/ai/tool-failures.ts` and `assistant-turn-presentation.ts`. Rewording a message changes what a run does. #335 added `lib/ai/failure-text.ts`, which cleans the transport wrapper off a message; it does not give the message a type.

**Simplest design.** Every failure the server raises on the run path carries a code (`conflict`, `locked`, `refused`, `limit`, `unavailable`, `invalid`, `internal`) next to its sentence: `ConvexError({ code, message })`. The turn loop, the retry rules and the chat switch on the code. The chat's map from code to wording is a TypeScript record keyed by the code type, so a new code without wording does not compile. `plainFailureText` stays for old stored text.

**Saving.** Not time or tokens: it removes a class of silent behaviour change, and it ends the catch-all message for anything the regex did not recognise.

**Risk.** Stored turns and old clients still hold text; both paths must be read for one release. Medium.

**Size.** Medium. Best done as two pull requests: codes at the source, then the consumers.

### 7. The timeline lock engages late

**What happens now.** A run takes the project at start but the timeline is locked only from its first edit (`editingWorkflowActive`). While the model reads and plans, the user's saves and finished background jobs (an upscale placing itself, an import landing) move the revision. The run then meets a conflict on its first write; #335 added a rebase for that.

**Simplest design.** Keep the user unlocked, and make every assistant write a rebase onto the current revision as #335 now does for staged drafts. Then remove the refusals: "the timeline changed elsewhere", the inspect-before-continuing gate and the failed-draft guard become unreachable. The alternative, locking at run start, is simpler in code and worse for the user, who could not touch the timeline while the model thinks.

**Saving.** Removes a failure the user can cause by editing during a run, and several tool errors that exist only to make the model re-read.

**Risk.** A rebase can merge an assistant edit onto a clip the user just changed in a way neither intended. The editor's own save queue already takes this risk with the same function. Medium.

**Size.** Medium.

### 8. Two kinds of "saved"

**What happens now.** Appearance and text edits save at once. Trims, splits, deletes and everything after them are staged privately and published when the request ends. The system prompt spends about 250 words on the difference, tool results carry six save states, and three incident tables with a settle job exist to detect when the two disagree. That detector is what crashed production on 2026-11-11.

**Simplest design.** Every edit saves as a revision inside the request's undo group, which already exists (`aiUndoRecorded`, `aiCheckpointRevision`): one Undo takes the whole request back. Nothing is staged, so nothing can be lost on Stop and there is one save state. The live preview becomes the saved timeline.

**Saving.** The staging explanation leaves the prompt; publication receipts, the draft restore on resume, the save-incident tables and their settle job can be deleted.

**Risk.** The user sees intermediate states during a multi-step cut (a clip removed before the gap is closed), and an export or post started mid-request would use one. Both need a rule: exports and posts wait for the run. This is the largest behaviour change on the list. High.

**Size.** Large. Do it last, after 7, because without staging every write needs the rebase.

## Order and why

1. History (item 1): smallest change, largest measured saving, and it fixes a reported wrong result.
2. Cache and reasoning (item 2): small, saves money on every request on Claude.
3. Polling with writes (item 3): small, no risk.
4. Round trips (item 4): medium, makes every tool call faster.
5. Tool descriptions (item 5): medium, needs before-and-after runs, shared with the guidance agent.
6. Error codes (item 6): medium, unblocks honest failure messages.
7. Late lock (item 7), then one kind of saved (item 8): the two behaviour changes, in that order.

Items 1 to 4 are independent and could go out in one week. Items 7 and 8 should each have the founder's decision before any code.
