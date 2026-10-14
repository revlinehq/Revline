# Planned effect review

Ordinary trim/move/delete requests do not authorize effects. Named effects,
animated text and creative styling such as AMVs do. The shared effect/text
catalog describes purpose, emphasis, anchors, typical duration, supported
strength examples, pairings and cautions.

`planEffects` records expectations without editing or asking for approval.
Observed-event anchors require current inspection evidence; marker/cut anchors
must match the timeline. New timed effects require a matching recorded plan.
Plain added text defaults to no animation.

`previewRender` checks one or two expectations in a window of at most three
seconds. Owned, revision-checked edited/reference snapshots use the shared
composition generator, local media/runtime preparation, HyperFrames export
file server/capture engine and FFmpeg video-frame injection. Capture runs in
an isolated Node process. Review uses 720p SDR frames with original source
positions and animation phases.

Cheap checks measure effect range, sampled pixel differences, optional return
to reference, and text bounds. Gemini receives paired edited/reference frames
and specific expectations, returning pass/fail/unverifiable with evidence.
Images and embedded text remain untrusted data.

Sparse samples cannot prove continuous motion, exact between-sample contact,
audio sync, full-edit quality or HDR appearance. Pixel differences are not
measured scale/brightness; text bounds are not contrast/readability checks.
These limits are returned to the agent.

The server permits one initial review and one fix-pass review per run, without
resetting expectations afterward. Provider failures do not automatically retry
paid reviews. Stopped/expired runs are refused before processing. Old consumers
skip review tasks until the version-2 processor is deployed. Captured files are
temporary; review snapshots/receipts are pruned after seven days or project
removal.

Verification uses mocked providers and disposable synthetic media. The separate
human-labeled edit-quality dataset has not been implemented.
