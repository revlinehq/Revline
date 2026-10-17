# Editor and harness review · October 17, 2026

Scope: targeted source review, reproduced regressions, focused tests and browser
checks. No paid model benchmarks or exhaustive security certification.

## Implemented

- **Transition paste:** keep a copied stack together when a destination clip
  collides, preserving transition sources on the same visual lane.
- **Save recovery:** drain and save edits made while a failed save reloads.
- **Effect library performance:** calculate transition placement only when its
  results are visible. A synthetic 150/750/1,500-clip check previously took
  approximately 1.65/15.8/66.6 ms on unrelated tab renders. This measures that
  calculation, not end-to-end frame rate.
- **Composition review coverage:** reject an expectation whose start, anchor,
  peak or explicit return is outside the captured window, before queueing paid
  analysis. Sample distinct anchors and peaks within the existing 12-frame cap.
- **Solid-color plans:** recognize current visual solids as well as legacy FX
  solids in timing verification.
- **Preview:** remove the ordinary dark outline around the preview frame while
  keeping a keyboard focus indicator.
- **Model choice:** show the selector only in development; production requests
  use the configured backend default.

## Existing architecture

The main editing agent runs in Convex. Media workflows and workers perform
analysis, rendering and composition review. The 62 registered tools are choices
available to a model, not 62 calls executed for every edit.

The harness already has effect plans, event anchors, style guidance, prompt
caching, saved-state recovery and bounded model/review runs. Composition review
uses the actual export composition, an effect-disabled reference, pixel
differences, text bounds and Gemini observations. These are useful checks, but
timeline validity and image differences do not establish visual taste or smooth
motion.

## Next improvements, in priority order

1. **Expose precise frame inspection.** The worker in
   `lib/server/inspect-video-frames.ts` already supports timestamped frames, but
   the main agent in `convex/assistantActions.ts` does not expose that tool.
   Search source video coarsely once, inspect a 0.3–0.5-second burst around the
   candidate action, record contact frame, movement direction and subject center,
   then map that evidence through the existing cuts. Preserve the working
   trimming and silence-removal paths.
2. **Use explicit review receipts.** Track each expectation as reviewed, failed
   or unverified. Verify peak/return timing from animation curves, then use a
   short rendered clip where continuity or smoothness matters. Keep one repair
   pass. Current review checks ranges rather than measuring zoom strength;
   text bounds are not a readability/contrast test.
3. **Meter the complete request.** Editor token budgets do not include all
   Gemini, Whisper and render work. Use durable per-user and per-run reservations
   across providers. The analysis guard in `convex/assistant.ts` counts temporary
   request rows deleted by `clearAnalysis`, so it caps outstanding work rather
   than lifetime analysis jobs. A cumulative counter is needed for a true limit.
4. **Reuse evidence.** Native-video inspection currently uploads the whole source
   even when a prompt asks about a small time window. Cache by source fingerprint,
   window, question and model/prompt version. Create bounded clips with an exact
   source-time offset; cache frame indexes rather than probing every frame again.
5. **Reduce orchestration overhead.** Use a stable core tool set plus relevant
   capability groups for trimming, captions, visual effects or audio. Batch
   deterministic operations from a validated plan. Avoid paying a second
   autonomous agent to perform routine operations already handled by tools.

Recommended sequence:

`request → relevant evidence → edit plan → existing deterministic tools → targeted rendered checks → one correction → saved receipt`

## Performance candidates to profile next

- `lib/editor/timeline-viewport.ts` measures every mounted clip on scroll.
  Consider virtualization or a visible-node index for long timelines.
- `components/editor/text-preview-card.tsx` runs separate animation clocks for
  visible preview cards. Consider a shared clock and pausing secondary previews
  during primary playback.
- `convex/lib/editSession.ts` can use map-based diffs and batched saves to reduce
  repeated clip searches and whole-timeline writes.

These are recommendations, not changes included in this batch. Validate them
against a real long timeline before changing the rendering architecture.
