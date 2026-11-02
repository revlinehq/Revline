# Timeline-first playback preparation

The editor can open as soon as its retained video source ranges are playable. A probed H.264/AAC MP4 with 8-bit 4:2:0 pixels, at most 3840 pixels on its long side and at most 40 Mbps, can play directly from its original private URL. A faststart remux becomes the permanent preview when sampled keyframe spacing is at most ten seconds. Sparse keyframes, other codecs, larger geometry and higher bitrates use the encoded path. Adding keyframes requires encoding video; changing container metadata cannot add them.

For encoded previews, source windows from all saved timeline tabs are merged with two seconds of padding. Packet timestamps place segment boundaries on actual source frames, including variable-frame-rate footage. Segments are at most about 30 seconds long, with additional boundaries at the padded window edges. The used windows encode and publish first. Remaining segments follow in the background, checking the latest saved timelines between batches so a newly extended clip moves ahead of unused footage. Completed segments survive task retries. The editor waits locally for a missing source range, or plays the original when it is compatible.

A fast poster seek runs before preview encoding and, when remote range reads work, before the worker downloads the whole source. The stored JPEG updates the loading card, media library and project cover. Playback preparation percentages come from FFmpeg's encoded video packet timestamps over the duration of the priority ranges. Remux progress comes from FFmpeg's progress pipe. Worker updates are throttled to approximately one per second. No estimated completion time is shown.

The encoder budget follows available CPUs, capped at four, with at most two concurrent chunks and a divided thread budget. The Cloudflare controller sets the budget to its actual two or four vCPUs. Mac workers probe a real VideoToolbox session, use hardware decoding for H.264/HEVC and hardware H.264 encoding when available, and fall back to software if a hardware job fails. CPU encoding uses libx264 superfast. Sources of ten minutes or longer use 540p when encoding; remuxes preserve the original resolution.

Segments retain source timing through a local time offset. They do not independently reset the first frame's fractional timestamp. The shared player compatibility patch permits this offset to be negative when a clip spans segments. The final preview concatenates exact-duration video ranges and takes audio once from the original, avoiding AAC priming offsets at joins. Exports continue to use the original media.

`importVideoLink` already supports paired source `start`/`end` values throughout the agent, MCP, task and yt-dlp paths. Section downloads use `--download-sections` and `--force-keyframes-at-cuts`; omitting the range retains the full-video default. The editor agent's tool description now explicitly explains when to use a section and that imported section time starts at zero. Direct MP4 imports still download the source before cutting it.

Claimable previews go ahead of other regular media jobs, including agent frame checks, while retaining processor-version checks, owner fairness and the dedicated export lanes. Running jobs are not interrupted. Repeated canonical source links with the same exact section reuse the existing video in that project, returning a completed receipt without downloading, charging import capacity or scheduling preparation again. Older completed imports are found through their receipts and acquire the same source identity. Deleted assets and different source sections require a fresh import.

## Verification and measurements

Measured in the isolated worktree on the user's busy 8 GB Mac, with Node 22.22.3. The input was real 1920 by 1080 H.264/AAC footage at 60 fps: 600.016667 seconds, 316,777,259 bytes and 36,001 video frames, copied from a longer local source. These are local processing times, excluding remote transfer and upload.

| Operation | Measured wall time |
| --- | ---: |
| Original full preview, libx264 veryfast, two threads, 720p | 1,040.8 seconds (17m21s) |
| New full faststart preview, same MP4 | 3.4 seconds |
| Early JPEG poster from the longer 10m33s source | 1.0 second |
| Complete encoded preview, same footage in Matroska, two hardware chunks at a time, 540p | 102.2 seconds (1m42s) |
| All padded windows needed for a 24-second timeline in that encode | 8.0 seconds |

The remux retained all 36,001 video packet timestamps exactly. A separate 23.976 fps sample retained all 677 frame timestamps exactly after chunk concatenation. Browser inspection used the real HyperFrames player and native video decoding: paused seeks, playback across a segment boundary, loading only an unavailable range, recovery when the range arrives, and original-file fallback. The live development server and queue consumer were left untouched. No test files or fixtures were added.

The complete re-encode used the same footage in a Matroska container to exercise the non-browser-compatible path. Its 23 segments published the used 300 to 324 second window, with two seconds of padding, before background ranges. All 36,001 frame timestamps matched that source exactly after concatenation. Hardware decoding and encoding used VideoToolbox. The CPU-only Cloudflare path was typechecked but was not benchmarked on a deployed container.

Follow-up verification ran the actual Convex functions and R2 worker on isolated local development ports, without deploying or touching the shared server. A preview claim overtook an older audio extraction and queued analysis. A public MP4 import completed through the real download and multipart-upload path; repeating it returned the same asset at 100 percent with attempt zero. Asset count stayed at one and the other preparation-job count stayed at three.

Review screenshots use real uploaded footage, a fresh development Clerk session and the running application on port 3005, at desktop and phone widths. The review encoder was paused at its measured FFmpeg progress to capture both sizes, then resumed. No screen or API response was mocked.

## Release requirements

This branch performs no deployment. Deploy the Convex schema and functions first, including `previewSegments`, playback identification/poster endpoints, segmented upload completion, asset queries and task gating. Deploy the processor image with contract 29 and its edge controller CPU-budget configuration, then the frontend with the regenerated HyperFrames playback patch. Deploy the agent runner to pick up the revised section-import guidance bundled in `editorToolkit`.

Development and production must use their own Convex deployment and credentials. The hosted frontend must stay on the production backend. The R2 storage worker's existing multipart/read protocol is unchanged. New preview tasks require processor contract 29; requests replace older active whole-file preview tasks so an old worker cannot keep the editor behind the previous gate.
