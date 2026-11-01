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
