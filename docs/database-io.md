# Convex database I/O

The billing totals include reads before `84c5979`, which removed
`sceneThumbs.forProject` and `sceneThumbs.renderingForProject`. Those functions
scanned image-bearing snapshot rows for the entire project. Their replacements
remain per clip; this change also removes image bytes from their read path.

## Read paths

| Reader | Cause | Change |
| --- | --- | --- |
| `assistant.messages` | The latest chat page re-read complete tool arguments and results, including full scene code and legacy inline screenshots. The earlier image fix only affected new screenshots. | Indexed `assistantMessageViews` contain display data, without code or image bytes. Complete Agent component messages stay intact for model context. Legacy images move to file storage during backfill. All message writers, including the Cloudflare runner and publication receipts, maintain the display copy. |
| `sceneThumbs.forProject` | Historical whole-project snapshot/image scan, invalidated by project edits. | Remains removed. Per-clip queries read `sceneThumbnails` metadata and file URLs. |
| `sceneThumbs.ensure` | Latest-version checks and pruning still loaded base64 snapshot images, and capacity checks read running task rows. | Checks small thumbnail metadata by project/key, prunes by project/clip/status, and stops after starting two jobs. Worker results move to files through a one-shot action; their temporary snapshot row is deleted. Capacity uses reservations. |
| `mediaTasks.list` | Read the latest 40 complete task documents on every heartbeat, including requests and cached inspection evidence. Recent sampled tasks were small; repeated invalidation was still costly. | Reads the same 40 tasks from `mediaTaskViews`. Views change only when visible status, progress, activity or other displayed fields change. Lease-only heartbeats leave them untouched. |
| `sceneThumbs.renderingForProject` | Historical scan read image-bearing rows to return only rendering state. | Remains removed. Rendering comes from the same small per-clip thumbnail record. |

Account capacity previously counted queued/running/retrying `mediaTasks` rows in
each requesting mutation. A worker heartbeat invalidated those reads, causing
OCC retries for reference reads, frame requests, thumbnails and imports.
`mediaTaskSlots` now reserve work from enqueue through retries until a terminal
state. Heartbeats never touch them. Import deduplication and the three-import
limit also use these reservations, with an exact source/range index.
Enqueues and terminal transitions still serialize capacity decisions atomically.

Read-only samples on majestic-alpaca-541 found six-frame thumbnail rows around
18–240 KB, almost entirely base64 images. Recent 60 KB chat tool rows became
roughly 9 KB display copies before moving legacy images to files. These are
document-size observations, not a measured reduction in the billing rate.

## Deployment and backfill

No deployment or migration was performed while implementing this branch.
Merge the backend and frontend changes into the same release. The frontend
must support thumbnail URLs before users receive file-backed thumbnail results;
reload existing editor tabs after the release. Media workers need no protocol
change. Agent frame/reference tool results retain their existing format.

The schema adds seven tables and their indexes:
`assistantMessageViews`, `assistantMessageThreads`, `assistantDisplayFiles`,
`mediaTaskViews`, `mediaTaskSlots`, `mediaCapacityOwners`, and `sceneThumbnails`.
No existing schema fields are removed.

After deploying the combined release **to dev majestic-alpaca-541**, run from
the checkout configured for that development deployment:

```sh
CONVEX_DEPLOYMENT=dev:majestic-alpaca-541 npx convex run databaseIO:initialize '{}'
CONVEX_DEPLOYMENT=dev:majestic-alpaca-541 npx convex run databaseIO:status '{}'
```

Wait for `tasks`, `thumbnails`, and `chats` to report `true`, and for the scheduled
thumbnail file conversions to finish. Each historical page reads one document;
owner capacity initialization reads only active tasks. Existing task lists and
chat histories keep their legacy query until their backfill is complete. New
owners initialize capacity lazily, and new conversations use display rows
immediately. Pagination cursors distinguish legacy and display pages so open
conversations can finish paginating during the cutover.

Initialization is safe to repeat to resume interrupted table migrations and
unfinished chat backfills. Duplicate image work discards the unused files, and
updates during backfill take precedence over older copies. Superseded thumbnail
files, task display records/reservations, and project chat display files are
removed with their owning records.

Run the same migration separately with production's own configuration only
when this release is approved for production. Do not point production at the
development deployment.

After rollout, compare daily DB reads and `convex insights` with the reported
baseline. Until then, the actual billing reduction and live OCC rate remain
unverified.

## Reference frame cache (2026-11-03)

Reference reads now check R2 before reserving a media-task slot. The cache retains
native decoded PNG bytes and complete deterministic results, including motion maps,
tracking JSON and comparison sheets. Overlapping reads share individual PNGs; a
partly cached read decodes only its missing PNGs. Window-specific motion/moment
analysis retains its original sampling and is cached by window and parameters.
Sound descriptions and live font-catalog matches remain fresh; their source PNGs
can still be reused.

Keys hash the owner/project, asset and immutable source identity, exact seek times
(including end-of-file fallback seeks), dimensions, crop, encoding parameters and
`MEDIA_PROCESSOR_VERSION`. Timeline keys additionally include the tab, rendered
revision and frozen timeline fingerprint, so staged edits and historical revisions
cannot alias current renders. Full-request results retain the existing JPEG budget;
a small cached sheet is never substituted for a native PNG or a different crop.

`mediaFrameCache` holds only keys, ownership, expiry and short-lived writer leases.
Workers upload bytes directly to the existing media Worker using an exact-key
write grant; reads use the existing signed `/read` URLs. Frozen timeline payloads
live in `frameSnapshotPayloads`, outside polling rows. New cached snapshots carry
an R2 pointer instead of base64 frames. Atomic batch reservations preserve grouped
scene captures and prevent overlapping workers from waiting on each other's frames.

Reference objects remain until their asset is deleted. Asset removal clears its
cache and project render/comparison caches; project deletion drains all entries in
bounded batches. Timeline renders and comparison results expire after 14 days and
are deleted by a daily indexed cleanup. Pending uploads also receive a delayed
delete after their upload grant/task deadline, covering deletion during a PUT.

### Local verification

A throwaway duplicate of the real **Clone 06** project supplied its scene and media.
The worktree ran `npm run dev -- --port 3021`, an isolated local Convex backend on
3216/3217, and the actual media Worker with a local R2 binding on 8796. Both web and
worker readiness were observed. Port 3001 and the original clone were untouched.
No shared backend, media Worker or hosted processor code was deployed. These are local timings,
not measurements of Cloudflare network latency or hosted-worker cold starts; some samples
overlapped a production build.

| Tool/request | Cold | Repeat | New tasks on repeat |
| --- | ---: | ---: | ---: |
| readFrames, 4–4.2 s at 30 fps, 7 frames | 5,817 ms | 377 ms | 0 |
| compareReference, three moments | 12,102 ms | 1,578 ms | 0 |
| compareReference after an edit | 13,898 ms | 571 ms | 0 |
| getFrames, three moments | 3,436 ms | 258 ms | 0 |
| trackReference | 5,073 ms | 221 ms | 0 |
| reference motionMap | 2,232 ms | 670 ms | 0 |

All six warmed cases hit without creating a media task. The overlapping 30 fps
window reused **4/7 PNGs (57%)**, decoding three missing PNGs. Comparison reused
**3/3 reference PNGs (100%)**, including after an edit. That edit created a new
snapshot task and new rendered bytes; its subsequent repeat created no task.
Two concurrent overlapping timeline requests completed and returned identical
bytes for their shared frame. Direct signed reads of the local R2 result took
5.8–11.5 ms (median 6.8 ms).

The repeated read and an independent uncached decode produced the same sheet
SHA-256: `fe2dd5ab0458f0588be4264620ccdb5e8550bd9b6db51431a1b1c44161b13539`.
Tracking image hashes and motion-map JSON hashes also matched between cold and
warm calls. Wrong-owner cache reads and unsigned R2 reads/writes were refused.
Verification used typecheck, build and direct runtime calls, without test files.

### Release

This is processor contract **36**. Release the media Worker, Convex backend and
media processors together; restart development workers too. Frame writers reject
processor/backend version mismatches. Bump the contract whenever decoding,
encoding, deterministic analysis or its toolchain changes. No backfill is needed
for this cache: entries populate on demand. Deploy to the intended environment
only after merge approval, with that environment's own storage credentials.
