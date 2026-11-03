# Footage loading progress

One overall percentage follows a source from transfer to an editable timeline. Task activity is the current step; its worker percentage is never shown separately.

## Stage map

| Stage | Previous reporting and reset | Overall share |
| --- | --- | --- |
| Project creation / metadata | No measured value; each upload began at 0 | Holds at the previous value |
| Upload or video-link import | File transfer 0–100 for each file; link import showed raw task progress only while running | 25% |
| Playback / transcode | Separate preview task 0–100; editor label embedded its percentage | 35% |
| Audio extraction / waveform | Import callback supplied a constant 100; UI switched back to a sweep | 10% |
| Transcription | New task starting at 0; preparation callback still supplied 100 | 20% |
| Browser playback / timeline thumbnails | New indeterminate loading surface after routing to the editor | 10% |
| Retry | `ProjectImportJob.start` reset its percentage; `mediaTasks.prepareAttempt` cleared task progress | Retains the highest value |

These are workload estimates, not elapsed-time predictions. The 45-second live upload took 9.7 seconds for upload/cloud save, 33.5 seconds for preparation, and 2.7 seconds for browser opening (plus routing). Playback and transcription therefore own most of the bar. Network speed, file length and queue delays vary.

Preparation tasks run concurrently. Each adds its weighted contribution independently; skipping playback encoding for a playable original or skipping transcription for silent footage completes that contribution. Multiple files use fixed byte weights for the batch, so moving to the next file cannot restart it. Saved-source selections use one fixed share per source.

## Continuity

- `footage-progress.ts` maps worker results and saved asset readiness to overall progress.
- The import session retains a high-water mark per source and the job retains its batch percentage on retry.
- `footage-progress-store.ts` shares project/asset high-water marks between the card, editor, Sources and composer. Session storage survives remounts/reloads; memory handles unavailable storage.
- An unfinished project opening resumes its stored percentage. A later opening after readiness starts a new operation.
- Convex retains progress across attempts for import, preview, extraction, waveform and transcription. Heartbeats already take the maximum, and the existing task/progress queries continue to expose it.
- Only browser readiness completes the project's final 10%. Source-only preparation completes when the media is ready, without waiting for an unrelated editor opening.

## Live observations — 2026-11-03

Source: real 45-second video, `Hormozi-distractions-45s.mp4` (4.4 MB), development backend `majestic-alpaca-541`.

Before: upload text showed `0, 8, 17, 25, 34, 42, 51, 59, 68, 76, 85, 93, 99%`; processing removed the number and returned to an indeterminate sweep. The editor opened with another sweep.

After upload: displayed `0, 2, 4, 6, 9, 11, 13, 15, 17, 19, 21, 23, 25, 60, 66, 76, 90, 96, 100%`. The card and editor both showed 90% at the route handoff. No decrease occurred.

After video link: the displayed bar showed `0, 4, 16, 20, 29, 34, 35, 41, 43, 44, 45, 80, 82, 86, 99%`, then reached ready. It held 16% through running → retrying → queued → running; the development import completed on attempt 6. A reload held the previous 4% value. These samples predate the separately developed three-attempt retry cap.

The link handoff exposed a query-ordering gap: task completion can arrive before its asset and timeline. Completed imports now keep their preparation state while the asset is unresolved, and the initial editor keeps the import surface while an import is pending. Extracted audio is counted with its parent video rather than treated as another transcription source.

Final link pass on the MDN CC0 flower video (5.055 seconds), with the updated handoff: displayed `0, 2, 3, 6, 7, 9, 11, 12, 16, 20, 25, 29, 35, 40, 75, 76, 78, 80, 82, 86, 99, 100%`. No decrease or premature ready transition occurred. A two-file upload (45-second speech plus 11.4-second silent footage) retained 25% at the second-file boundary and increased through preparation; reopening retained 99% and reached ready.
