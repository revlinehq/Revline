# CPU podcast speaker framing

Speaker analysis version 2 prioritizes the existing camera edit. PySceneDetect finds source-frame cuts. MediaPipe CPU face detection and landmarks sample each shot at 2.5 fps, including its first frame. A face must persist through at least 70% of a shot and dominate the observed face area to supply one fixed median face anchor. A profile or microphone can obscure its lips without blocking this framing decision. Dominant framing never establishes an audio identity.

Only unresolved shots receive dense 10 fps mouth sampling. Faces retain identities through position/size continuity inside shots and a conservative 88-value appearance descriptor across cuts. Complete diarization turns supply articulation variation, activity and competing-face scores. Turns shorter than 1.2 seconds or with very weak diarization are ignored. Missing competitor lips, overlapping speech, poor visibility and conflicting associations abstain. A confident voice-to-face match is remembered for later turns and recurring shots in this analysis window. Memory does not cross independently analyzed windows, even when audio speaker IDs have source scope.

Framing holds one anchor per face per shot. Confirmed speaker changes ease for 600 ms inside that shot. Camera cuts use adjacent microsecond crop keys, with a one-microsecond rounding allowance for ffprobe PTS, so the first decoded cut frame receives its new crop. Uncertain intervals hold within the shot; uncertain new shots use the stable center. Entirely uncertain analysis does not enable follow crop. No Gemini or GPU participates in speaker analysis; missing diarization still uses Deepgram. Speaker windows use native input and a microsecond encoder clock, preserving VFR source cut times instead of rounding them to a fixed frame grid. Older previews are bypassed because their clocks may already be rounded; long original files therefore require more download I/O.

Saved `speakers.framing` intervals cover the entire source window and identify shot, method, confidence, face, local face ID and optional audio speaker. `speakers.turns` separately records audiovisual identity evidence. `followSubject` returns retained timeline seconds by method, accounting for trim and playback speed. `analyzeMedia` and ranged `inspectAssetAnalysis` expose source-time summaries. Confidence is a duration-weighted heuristic, not measured accuracy or a calibrated identity probability. Fallback confidence is zero, including a deliberate hold through an ignored backchannel.

## Real footage verification, 2026-11-02

Kept development project [Test: speaker framing](http://localhost:3001/editor/j972r4qxdx432m6jqsma0kgneh8heahd), with one vertical timeline per input. Existing short Lex Fridman/Sam Altman, Dwarkesh/Dario Amodei and Syntax two-person sources were copied into it. No existing source project was edited and no export was requested.

| Clip | Duration | Dominant shot | Whole-turn mouth | Identity reuse | Safe fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lex Fridman | 70.00 s | 70.00 s, 0.975 | 0 | 0 | 0 |
| Dwarkesh | 55.01 s | 55.01 s, 0.980 | 0 | 0 | <0.00001 s |
| Syntax two-person | 60.00 s | 25.90 s, 0.980 | 23.13 s, 0.833 | 2.72 s, 0.841 | 8.25 s, 0 |

Cells report seconds and mean confidence. The tiny Dwarkesh tail is container rounding. PySceneDetect found four, four and five shots respectively. The initial staged CPU passes took 69.6, 113.6 and 112.4 seconds respectively on this machine, excluding the separate source download and missing wide-shot diarization. Final matching and crop timing were rerun against that saved face evidence. The final VFR-preserving whole-function rerun for Syntax, including window preparation, took 224.3 seconds and retained cut times 2.067, 20.833, 32.267 and 47.600 seconds. These times are observations, not throughput guarantees.

The live dev server and media worker on port 3001 were left running unchanged. Another any-lane worker would compete for the same dev queue, so the candidate Python/MediaPipe/TypeScript analysis was run directly from the isolated worktree, against downloaded media. The wide VP9 source had inconsistent container frame counts; it was prepared with the same `extractVideoWindow` function the production speaker task uses. A rendered first-cut-frame check exposed subframe clock rounding in that preparation, so the final path preserves VFR timestamps and bypasses older previews. The resulting crop paths were saved through the existing dev API and attached with the existing face-follow tool, without asking the old worker to recompute them. Full version-2 speaker receipts require the schema deployment below.

`getFrames` reviewed composited Lex and Dwarkesh crops around camera cuts, the wide-shot 600 ms acquisition, the right speaker at 19 seconds, the left speaker at 40 seconds, and first-frame crop behavior at the wide camera cuts. The wide footage demonstrates identity reuse on its later right-speaker turn and the recurring close-up. The early unmatched left-speaker turn and short uncertain interjection retain the safe fallback.

Verification: web typecheck, agent-runner typecheck and Next.js production build. No test files, fixtures or smoke scripts were added. Temporary downloaded media and face-evidence files were deleted after inspection.

## Release requirements

This branch performs no deployment. It is pushed only to `speaker-framing`.

Deploy the media processor image with contract 28 and its existing pinned PySceneDetect/MediaPipe CPU dependencies, the Convex version-2 schema and analysis/tool functions, and the agent runner that bundles the updated toolkit, context and clipping skill. Old version-1 results remain readable but are reanalyzed rather than reused for new speaker-follow requests. Version gating prevents a contract-27 worker from claiming the new tasks once the backend is released.

Development requires its own Convex development deployment and a worker running this code. Production requires its separate Convex production deployment, media worker and agent-runner credentials. Never point the hosted app at the development backend. The frontend build was verified; no browser UI or renderer deployment is required for the crop-path format, which uses the existing shared focus representation.
