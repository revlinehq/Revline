---
name: "moments"
description: "Scans the whole source, ranks evidenced hooks and payoffs, and chooses 15 to 60 second boundaries."
---
# Finding moments for clipping

Good candidates are distinct, self-contained moments with a hook in the first seconds and a resolved payoff, each backed by cited source times.
Use this search only for a clipping request.

## Workflow
1. Speech-led sources: read the saved timed transcript once and propose distinct, self-contained hooks and payoffs. Register them with planClips found, quoting exact words and times. Spoken moments need no video judging or frames.
2. Action sources: propose timestamped candidates from the findHighlights evidence. Call inspectVideo with a focused question only where visual context matters; start with short windows and extend only a specific uncertain event. Reuse saved observations.
3. Silent sources: sample a bounded set of short video windows across the source, refine the observed events, and disclose the inspected coverage.
4. Score each candidate with the rubric below and pick the count from the clipping Defaults.
5. Call planClips before building: accept the chosen candidates and drop every other returned top-10 candidate with a concrete reason.
6. When shorts are requested, carry the ranked plan into page batching.

## Defaults
Viral-potential score out of 100:

| Criterion | 0 | Middle | Full |
|---|---|---|---|
| Hook (25) | absent | 12: after setup | 25: in the first 2 s |
| Payoff (25) | absent | 12: implied | 25: resolved |
| Clarity (20) | prior short required | 10: one missing detail | 20: self-contained |
| Surprise (20) | absent | 10: stated | 20: visible reaction |
| Quotability (10) | absent | 5: context-dependent | 10: standalone line |

Count examples: 8:16 source with 4 good moments → 3; 45 min with 14 → 10; 8:16 with 2 → 2, naming the reason no third qualified.

## Rules
Evidence:
- Stills and scene cuts cannot establish continuous action.
- For silent content, never invent transcript-based rankings or claim coverage of unseen source.
- Cite source times for every candidate. Scores are editorial estimates, never promised views.
- Keep uncertainty visible; never fill a requested count with unsupported highlights.

Choosing:
- Prefer distinct moments over overlapping versions of the same joke.
- Never pad. State any shortfall. When fewer than the target qualify and dropped reasons do not explain it, give planClips a concrete shortfallReason, for example "Other fights repeat the same payoff or need setup beyond 60 s."
- Account for strong moments left out only because of the requested count, too. Good drop reasons: "same payoff as H3", "needs prior context", "lower-ranked than the three requested".
- The accepted name becomes the short's exact, distinct tab title.
- For gaming and sports, record critical HUD regions in the plan when they matter.
- If review drops a candidate that is already built, open a retained or original tab first, then update planClips with the reason.

Boundaries:
- Keep planClips' clean in and out points, or improve them with word timings while keeping the grounded hook and payoff.
- Read exact word timings around speech boundaries from the saved transcript in short source windows.
- The first sentence names its subject: for "That's why it failed", also retain "The upload stalled."
- End after the payoff and its real reaction, before the reset. Keep words and the thought complete.
- If a candidate cannot stand alone within 60 s, choose another or explain the constraint. When no word-timed pause follows the payoff, planClips suggests the moment's own range; finishClipping then checks the built tab's in and out points against the words.
- A moment longer than 60 s is deliverable only as a requested montage or trailer: one tab cutting several of its ranges to 15–60 s, accepted by its retained source span and timelineId.
- Respect exact user timestamps and flag any conflict with the 15–60 s range.

## planClips and findHighlights details
- Transcript-first discovery, or a findHighlights that fell back: register the COMPLETE found set after reading the transcript.
- On the visual path, spoken moments are grounded by their quotes; action or non-verbal hooks and payoffs need a saved targeted inspectVideo observation and come back unresolved when Gemini is unavailable or the inspection budget is spent.
- Use planClips' suggested ranges by default; changes stay within 12 s of each suggested boundary and keep the hook and payoff. Accepted tabs keep the source aspect and framing unless the user asked for reframing. Bind timelineId when known; exact unique tab titles also resolve.
- A choice bound to a built tab is measured by that tab: 15–60 s, or for a requested montage or trailer cut from several ranges, its retained source span (first in to last out) with the hook and payoff inside retained footage.
- Revise the plan when a built candidate is dropped and restore or remove its abandoned tab: updating the plan removes that tab only when this batch created it and it holds no approved work.
- shortfallReason goes into finishClipping's finalMessage. finish compares the plan to the populated tabs with cheap data checks; only explicitly requested QA needs receipts, and no normalization or checkClip runs unless requested.
- findHighlights: commentary over gaming or action does not prove the visuals irrelevant; establish visual events with short explicit inspectVideo windows. Silent content uses bounded adaptive video discovery. Preserve original framing and audio.
