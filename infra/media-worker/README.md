# Hosted production media processor

This package runs Revline's existing `processMediaTask` pipeline in a Linux container. It includes FFmpeg, Chromium, Python 3.13, the pinned CPU-only Beat This runtime/model, PySceneDetect and yt-dlp. Convex still owns the queue, leases, workflow retries and saved results; R2 still owns the media. No new database or queue is introduced.

## Production deployment

The processor is deployed in Cloudflare account `701645e913477e567db69b11343f59d8`, using production backend `different-gnu-398`. The user authorized this existing Workers Paid account; no billing plan was changed. Containers management and read-only runtime-log authorization were granted for rollout. The laptop's production consumer is stopped; the separate development consumer remains local on `majestic-alpaca-541`.

Production wake URL: `https://revline-media-processor-production.makaradze98-s.workers.dev/wake`.

The existing `cloudflare/media` Worker signs and serves R2 media. This separate processor is needed because FFmpeg, Python/Torch and Chromium require a container rather than a plain Worker.

## Runtime and lifecycle

- One named production instance; `standard-2` provides 1 vCPU, 6 GiB memory and 12 GB ephemeral disk. Start with one processing slot. OpenMP/MKL thread caps avoid excessive CPU contention.
- A protected wake request schedules a Durable Object alarm and promptly acknowledges it. The alarm starts processing outside the request lifetime. Convex sends the wake after each queued attempt becomes claimable, including retries; waking at initial enqueue would run before the asynchronous workflow publishes attempt 1. A one-minute Cron Trigger provides fallback recovery, subject to Cloudflare trigger propagation and startup time.
- The consumer subscribes to Convex's ready queue and claims tasks through the existing worker API. It renews task leases every 20 seconds, reuses the normal progress/result APIs and enforces the existing 15-minute task timeout.
- A private health port becomes ready independently of rendering or model inference. The consumer exits after 90 seconds without work. Health polling does not extend its idle timer, so the container can scale to zero.
- After all task slots settle, transport cleanup is bounded to five seconds. This prevents an unfinished WebSocket handshake from keeping an idle container running indefinitely.
- When the edge controller sees a new image digest, it asks the previous consumer to stop claiming work and finish its current task. The next tick starts the replacement image after the previous process exits. Do not rotate the worker secret simultaneously with a runtime rollout, because the old image must authenticate its drain request.
- SIGTERM aborts active work; unfinished task leases expire and Convex retries. Disk is temporary: downloaded sources and export scratch files are cleaned by `processMediaTask`. A sudden host failure can discard scratch files without discarding the saved project or durable task.
- Native Docker/container execution is still a capacity boundary. Large exports and several simultaneous jobs need measured memory/disk checks before increasing concurrency.

## Wake contract

The deployed controller URL is:

`https://revline-media-processor-production.makaradze98-s.workers.dev/wake`

Send `POST` with an empty body and `Authorization: Bearer <RENDER_WORKER_SECRET>`. An authenticated request returns 202 and schedules singleton startup. Other public routes return 404; the container health and drain ports are not exposed publicly. The secret comparison uses constant-time comparison, and responses/logs never include credential values.

Convex production's `MEDIA_PROCESSOR_WAKE_URL` is configured to this URL. Keep `MEDIA_WORKER_URL` pointing at the existing R2 media Worker. An unset wake variable disables immediate wake without changing the durable queue.

## Build and local verification

Run from the repository root:

```sh
npm ci
node infra/media-worker/prepare-context.mjs
npx tsc -p infra/media-worker/edge/tsconfig.json
docker build --platform linux/amd64 -f infra/media-worker/Dockerfile -t revline-media-processor:review .wrangler/media-processor-build
WRANGLER_LOG_PATH=/tmp/revline-hosting-wrangler.log npx wrangler deploy --dry-run -c infra/media-worker/edge/wrangler.jsonc --outdir /tmp/revline-processor-edge
```

Check available disk space before building locally; allow at least 20 GB for the image, temporary dependency installs and build cache. Repeated builds that invalidate dependency layers can consume substantially more space. The production deployment build must use a host or CI runner with adequate disk capacity.

Wrangler's dry-run builds the container image locally as well as bundling the edge code. It does not deploy the application. The prepared context is an explicit allow-list; `.env` files, credentials, local uploads, Git history, tests and fixtures are omitted. Do not replace it with an unrestricted repository context: Wrangler rewrites Dockerfiles and may omit a Dockerfile-specific ignore file.

The Docker build verifies the pinned model checksum, Python imports, FFmpeg/ffprobe, yt-dlp, Chromium startup, and required tracking/export assets. It generates bundled text effects and visual effects through the repository's normal vendor build. `consumer.ts` stays in the root Node/Next TypeScript check; the edge folder uses Wrangler's generated runtime types and its standalone TypeScript check.

Verification recorded on 2026-10-13:

- The complete Linux image built successfully, including model checksum, Python imports, FFmpeg, Chromium rendering and export assets. Its final size was 4.76 GB.
- Wrangler's local dry-run bundled the edge controller and built the preceding image successfully; it exited without a cloud deployment.
- The final consumer source passed health (200), unauthenticated drain rejection (401), authenticated drain (202), clean drain exit (0), and automatic idle exit (0), mounted read-only into the already-built image with dummy credentials and an invalid backend. This exposed and verified the bounded WebSocket cleanup fix without another image build.
- Root TypeScript and the standalone edge TypeScript check passed after that fix. The production rollout rebuilt the fixed source and deployed the image to Cloudflare.
- With the laptop's production consumer stopped, an isolated one-second graphic export completed through the hosted consumer and normal R2 upload pipeline.
- After the wake-order fix, a fresh synthetic export completed on attempt 1 in 13.467 seconds without a manual wake request. Its downloaded output was verified as H.264, 1280×720, 24 fps, 24 frames and exactly 1.000 second. Decoded luminance ranged from 8 to 244, confirming visible content. Cloudflare subsequently reported the production instance inactive.
- The public queue/worker regression verifies that an outgoing wake sees claimable attempt 1 and that a retry sends another wake with claimable attempt 2. All 168 Convex tests and the root TypeScript check passed for that batch. Actual interruption of a hosted in-flight task and its recovery have not been exercised; this is a remaining operational check.
- Earlier disposable local images, explicitly identified build cache and staged context were removed to recover storage. The current rollout image is retained for the next coordinated runtime update; do not blanket-prune unrelated images or volumes.
- Both successful synthetic fixtures were removed through the existing project-removal API with cleanup authorization. The natural-wake fixture's generated owner has no remaining project, and its R2 export returns 404 after deletion. No customer footage was used. Temporary production log tails were stopped after verification.

## Runtime secrets and rollout

The 2026-10-13 text update is deployed as controller version `4b832ecc-17b5-4b72-be5e-382d32771961`, using processor image digest `sha256:ea8c8836619f475bf849bdf7740efbb5b4c8fba3c43591be367c5bf7dbfa89fc`. It includes editable text rotation and the Neon echo, Lyric slam and Kinetic stack presets. The frozen image rendered all three presets and rotated text roots in an isolated, network-disabled check. A synthetic MP4 render separately verified entrance/hold/exit frames, split timing and preview/export agreement. Image comparisons use bounded pixel statistics instead of large Buffer assertion diffs, which exhausted local RAM on failures; local verification runs use a capped Node heap.

The processor uses three secret values:

- `RENDER_WORKER_SECRET`: the existing production media worker credential, matching Convex production.
- `GOOGLE_GENERATIVE_AI_API_KEY`: the production Gemini provider credential used for native video understanding and inspection.
- `OPENAI_API_KEY`: the production OpenAI credential used by Whisper for word-timed speech transcription. Audio is compressed to 32 kbps mono MP3; uploads exceeding 24 MB are split into source windows and their measured word times are offset back into source time. The stored transcript supports up to 5,000 words and 500 overview segments; overview compaction preserves every measured word.

Non-secret backend/media URLs and the Gemini video model are declared in the edge Wrangler configuration. There is no Clerk secret, Anthropic secret, Convex deploy key or Cloudflare token inside the image. Workers secrets are passed into the process at container startup; no secret is passed as a Docker build argument or baked into a layer.

For subsequent runtime rollouts:

1. Verify Containers authorization remains available. Preserve existing scopes and the existing paid plan.
2. Build and verify the new runtime, then deploy this separate processor application in the existing account. Rebuild when export code, bundled text presets, Python dependencies or the pinned model change; a frontend or Convex deployment does not update the running image.
3. Install its runtime secrets using Wrangler's encrypted secret commands or the dashboard. Transfer existing values through a secure pipe or prompt; never print them or include them in CLI argument strings.
4. Keep `MEDIA_PROCESSOR_WAKE_URL` on Convex production, then enqueue an isolated synthetic task and confirm its saved result through normal task/render APIs without manually waking the controller.
5. Confirm the export reaches R2 and the container becomes inactive. Use an explicitly authorized synthetic fixture for an interruption/retry drill and cleanup. Keep the development consumer separate; avoid running a laptop production consumer alongside the hosted one during verification, since either consumer can claim the task.

## Cost estimate

Cloudflare Containers requires the $5/month Workers Paid plan. Based on the official rates checked on 2026-10-13, one `standard-2` instance costs approximately:

| Running time per 30-day month | CPU assumption | Base plus container compute |
| --- | --- | --- |
| 30 hours | Full 1 vCPU while running | $8.15 |
| 60 hours | Full 1 vCPU while running | $12.02 |
| 720 hours | Full 1 vCPU continuously | $97.17 |

These are calculations, not a spending cap or a bill forecast. They assume the included 25 GiB-hours memory, 375 vCPU-minutes and 200 GB-hours disk allowances remain unused elsewhere in the account. CPU is billed for active usage; provisioned memory and disk are billed while the instance runs. Idle shutdown therefore matters. Workers/Durable Objects request usage, logs, excess egress, Gemini usage, and existing Convex/R2 costs are separate.

## Official references

- [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
- [Limits and instance sizes](https://developers.cloudflare.com/containers/platform/limits/)
- [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/)
- [Wrangler container configuration](https://developers.cloudflare.com/containers/configuration/wrangler/)
- [Environment variables and secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)
- [Cron container example](https://developers.cloudflare.com/containers/examples/cron/)
- [Subscription inspection permissions](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/)

### 2026-10-14 composition-review rollout

Controller version `9edcb8ab-a683-4b34-9b2d-2e80317b52b3` uses image
`registry.cloudflare.com/701645e913477e567db69b11343f59d8/revline-media-processor-release@sha256:6e1c976bfc8e1ac6d940cf54bfc1a2b703080e7650e9c981a161f81e616c5b21`.
The frozen image includes compact queue claims, the shared Remotion runtime,
composition preparation shared with export, and bounded edited/reference frame
capture. The controller and consumer advertise processor version 2, so review
work can wake an idle instance. Older consumers skip review jobs.

The image passed runtime dependency checks, a network-disabled synthetic video
review (six edited/reference samples with FFmpeg injection and text-safe-area
checking), and a 36-frame MP4 export check. A disposable production queue export
completed on attempt 1 and reached R2 as H.264, 1280×720, 24 fps, 24 frames,
exactly 1 second, 12,212 bytes. Cold-start verification took 74.273 seconds,
including CLI/polling overhead; this is not a normal export-speed benchmark.
The container subsequently returned inactive. No paid model was invoked.

Review provider responses are verified with mocks; live Gemini judging quality
has not been benchmarked. The synthetic project was removed and its temporary
access was revoked. Neither customer footage nor customer projects were edited.

### 2026-10-15 renderer optimization rollout

Controller version `f7819038-5c2f-4584-91ef-c1cb50750cd0`, tagged `f6df3bd`, uses image
`registry.cloudflare.com/701645e913477e567db69b11343f59d8/revline-media-processor-production-mediaprocessor-processor@sha256:e11af52df207c25187ab77bdec217705bd44d4953171a9578c7b909e2b97f828`.
The frozen source skips motion-key construction for inactive effects and validates
intermediate GPU targets at allocation or resize, preserving rendered pixels.
Failed or lost contexts are discarded instead of entering the reuse pool.

The exact image passed dependency/runtime checks and a network-disabled H.264 MP4
check: one second, 720p, 24 fps, Dither followed by two ordered zoom-blur passes,
mean browser/export RGB error 1.16/255, zero warnings. Under a 1-CPU/6-GiB cap the
entire fixture took about 108 seconds, including preparation; its original
90-second test timeout was insufficient. This verifies output, not instantaneous
exports. Complex software-GPU rendering remains a throughput limit.

The production backend, worker secrets, instance size, concurrency and idle
shutdown remain unchanged. No paid model call or customer editing job was used
for release verification.

### 2026-10-15 silent-video export fix rollout

Controller version `669990b4-a359-4ea1-b7ce-fd5377c192e7` uses image
`registry.cloudflare.com/701645e913477e567db69b11343f59d8/revline-media-processor@sha256:7fed72083b3e316cb5397ab1dfd981bc864841fa60b86944f3fb1d159dd0306a`.
The frozen image includes source fix `885230d`: composition preparation probes
downloaded video sources and mutes sources that have no audio stream. Embedded
audio in audible videos and separately extracted audio remain supported. This
prevents silent video from being rejected as an incorrectly authored audio asset.

The source-only Linux/amd64 build reused the retained renderer-optimization image
and its installed dependencies. Its additional image layers total 93.8 MB; no
dependency installation, download or broad Chromium ownership change was needed.
The exact resulting image (`sha256:543f1242a65de1d82220f358886c96098c27c7fc83864eed02c1e9c7de3b7c20`)
passed the runtime checks and a network-disabled export as the `node` user under
a 1-CPU/6-GiB cap. The real silent NASA fixture exported as H.264, 1280×720,
24 fps, 66 frames and 2.750 seconds, with no audio stream and zero warnings.
The render plus output verification took 19.196 seconds. Four sampled frames,
including both sides of the cut, matched their source times with mean RGB error
1.96–2.18/255. A subsequent isolated hosted retry through the normal queue
completed in 150.058 seconds. Its downloaded result was independently verified
as H.264, 1280×720, 24 fps, 66 frames and 2.750 seconds. This measured hosted
latency is not a steady-state renderer benchmark: queue, container startup and
controller polling were not separately timed.

Wrangler deployed the digest-pinned image with `--keep-vars --strict` through a
temporary non-secret configuration; the tracked configuration remains build-based.
The latest version and its image binding were verified through Wrangler, and
deployment `1ae40041-e9bf-4124-8f38-e44aac3bc448` routes 100% to that version.
Existing backend, secrets, instance size, concurrency, cron and graceful drain
behavior were preserved. No shared task was interrupted and no paid model was
called during this rollout.
