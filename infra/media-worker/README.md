# Hosted production media processor

This package runs Revline's existing `processMediaTask` pipeline in a Linux container. It includes FFmpeg, Chromium, Python 3.13, the pinned CPU-only Beat This runtime/model, PySceneDetect and yt-dlp. Convex still owns the queue, leases, workflow retries and saved results; R2 still owns the media. No new database or queue is introduced.

## Deployment prepared, not deployed

The intended Cloudflare account is `701645e913477e567db69b11343f59d8`, and the intended backend is production `different-gnu-398`. The account is reachable with the existing OAuth login, but that login lacks `containers:write`. An account subscription lookup also returned 403 because it lacks Billing Read. **Workers Paid eligibility is unconfirmed**, and no paid plan or container application has been created.

The existing `cloudflare/media` Worker signs and serves R2 media. This separate processor is needed because FFmpeg, Python/Torch and Chromium require a container rather than a plain Worker.

## Runtime and lifecycle

- One named production instance; `standard-2` provides 1 vCPU, 6 GiB memory and 12 GB ephemeral disk. Start with one processing slot. OpenMP/MKL thread caps avoid excessive CPU contention.
- A protected wake request starts processing promptly. A one-minute Cron Trigger is a fallback for disconnected wakes or process failures. The fallback can add up to a minute of initial queue latency.
- The consumer subscribes to Convex's ready queue and claims tasks through the existing worker API. It renews task leases every 20 seconds, reuses the normal progress/result APIs and enforces the existing 15-minute task timeout.
- A private health port becomes ready independently of rendering or model inference. The consumer exits after 90 seconds without work. Health polling does not extend its idle timer, so the container can scale to zero.
- After all task slots settle, transport cleanup is bounded to five seconds. This prevents an unfinished WebSocket handshake from keeping an idle container running indefinitely.
- When the edge controller sees a new image digest, it asks the previous consumer to stop claiming work and finish its current task. The next tick starts the replacement image after the previous process exits. Do not rotate the worker secret simultaneously with a runtime rollout, because the old image must authenticate its drain request.
- SIGTERM aborts active work; unfinished task leases expire and Convex retries. Disk is temporary: downloaded sources and export scratch files are cleaned by `processMediaTask`. A sudden host failure can discard scratch files without discarding the saved project or durable task.
- Native Docker/container execution is still a capacity boundary. Large exports and several simultaneous jobs need measured memory/disk checks before increasing concurrency.

## Wake contract

The prepared controller URL is:

`https://revline-media-processor-production.makaradze98-s.workers.dev/wake`

Send `POST` with an empty body and `Authorization: Bearer <RENDER_WORKER_SECRET>`. An authenticated request returns 202 and schedules singleton startup. Other public routes return 404; the container health and drain ports are not exposed publicly. The secret comparison uses constant-time comparison, and responses/logs never include credential values.

Set the new optional Convex variable `MEDIA_PROCESSOR_WAKE_URL` to this URL after deployment. Keep `MEDIA_WORKER_URL` pointing at the existing R2 media Worker. The optional wake action is wired; the unset variable leaves current operation unchanged.

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
- Root TypeScript and the standalone edge TypeScript check passed after that fix. The fixed shutdown source has not been rebuilt into a new image or exercised on Cloudflare yet; the rollout must build it and verify a real owned task.
- Disposable local images, this task's explicitly identified build cache and staged context were removed after verification to recover storage. Source files and build commands remain available.

## Runtime secrets and rollout

Only two secret values are required in the new Worker:

- `RENDER_WORKER_SECRET`: the existing production media worker credential, matching Convex production.
- `GOOGLE_GENERATIVE_AI_API_KEY`: the production Gemini provider credential used for video understanding/transcription.

Non-secret backend/media URLs and the Gemini video model are declared in the edge Wrangler configuration. There is no Clerk secret, Anthropic secret, Convex deploy key or Cloudflare token inside the image. Workers secrets are passed into the process at container startup; no secret is passed as a Docker build argument or baked into a layer.

After account eligibility and costs are approved:

1. Refresh Cloudflare authorization with Containers access, and confirm the Workers Paid subscription without purchasing or upgrading it implicitly.
2. Verify the local build and dry-run, then provision/deploy this separate processor application in the existing account.
3. Install its two runtime secrets using Wrangler's encrypted secret commands or the dashboard. Transfer existing values through a secure pipe or prompt; never print them or include them in CLI argument strings.
4. Set `MEDIA_PROCESSOR_WAKE_URL` on Convex production, then trigger a harmless owned test task and confirm its saved result through normal task/source APIs.
5. Confirm a real production export reaches R2, idle shutdown works, and an interrupted test task retries. Stop the laptop's production consumer only after the hosted consumer passes these checks; keep the local development consumer separate.

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
