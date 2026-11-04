# Media processing on Fly.io

All `processMediaTask` kinds run in the full Fly processor image: playback previews, poster frames, import, extraction, transcription, beats, shots, facecam, speaker framing, tracking, parallax, cutouts, reference inspection, snapshots, blueprint checks and composition review. Convex still owns task claims, 20-second heartbeats, leases, progress, cancellation and workflow retries. R2 still stores media.

Exports retain their existing dedicated Fly apps and lean `exports` Docker target. Processing uses the `fly-processor` target from the same Dockerfile, including FFmpeg, Chromium, Python, CPU Torch, the pinned Beat This model, PySceneDetect and yt-dlp. Separate apps keep export capacity and credentials independent and avoid adding Python/model download time to export cold starts.

| Environment | Convex | Processor app | Export app |
| --- | --- | --- | --- |
| Development | `majestic-alpaca-541` | `revline-processor-dev` | `revline-render-dev` |
| Production | `different-gnu-398` | `revline-processor` | `revline-render` |

The R2 media Worker (`cloudflare/media`), frontend Worker and agent runner stay on Cloudflare. Never change `MEDIA_WORKER_URL` to the processor app. It continues to name the environment's R2 media Worker.

## Queue backend and lifecycle

Set `MEDIA_PROCESSOR_BACKEND` on Convex:

- `fly`: enqueue and retry wakes reconcile on-demand Fly processor machines. A Convex cron reconciles every minute after a missed wake or failed API call.
- `cloudflare`: the existing authenticated `MEDIA_PROCESSOR_WAKE_URL` wakes the retained Cloudflare controller. Its own cron also recovers missed wakes.
- `local`: the existing `npm run dev` media consumer handles processing. No hosted processor is started. This remains the normal development setup.

Before an explicit selection, a deployment with a Cloudflare wake URL keeps using Cloudflare; otherwise it keeps using local processing. A successful Fly deployment selects `fly`, unless `--stage-only` was passed. This preserves the existing deployment until Fly's full image and backend contract have been verified.

Both queue readiness and atomic claims enforce the selection. Old Cloudflare consumers and the already-running local consumer require no restart to stop taking new jobs after cutover. In-flight jobs keep their existing leases and finish normally. Export-only credentials and their separate dispatcher are unaffected.

Each processor machine gets one task slot, performance CPUs, two GiB RAM per CPU, and a private 20 GB scratch volume. Default size is 8 performance CPUs with 16 GiB RAM. `FLY_PROCESSOR_CPUS` accepts `4` or `8`; `FLY_PROCESSOR_MAX_MACHINES` defaults to `4` and accepts `1` through `8`. The serialized dispatcher counts starting and active machines against the cap, including a create whose acknowledgement was lost. Each machine subscribes to the existing queue and can process several jobs sequentially.

A machine exits after 60 seconds with no work and auto-destroys. Detached scratch volumes are removed by reconciliation after a ten-minute grace period, including after a backend rollback. Scratch is cleared at startup and the consumer runs as the unprivileged `node` user. No processor HTTP service is publicly exposed. Task timeouts stay at 15 minutes, including the existing special handling for pixel tracking. SIGTERM or a lost host leaves the normal lease expiry/retry mechanism in charge.

`MEDIA_PROCESSOR_THREADS` sizes native encoding to the machine's CPUs; local consumers retain their two-thread budget. `MEDIA_PREVIEW_CPUS` divides that budget across two simultaneous chunks, with the full budget assigned to a short source that needs one chunk. The parallel chunk boundary and final mux approach follows `fast-preview` (`f608190`), while this branch retains the existing preview quality and queue contract. Browser-based encoders receive `REVLINE_RENDER_ENCODE_THREADS` too. Torch/OpenMP/MKL receive the full CPU budget. Each machine has its own CPU budget, so concurrent jobs do not split one encoder's cores.

For isolated development reads, set `MEDIA_WORKER_PROJECT_ID` to a project ID before `npm run dev`. The local worker then subscribes to and claims only that project’s tasks; other worktrees keep their own queues. Stop the development launcher to stop both its frontend and worker. Reference element tracking reuses the pinned scene-detection OpenCV/NumPy runtime and decodes native-resolution source frames.

## Deployment

Use Node 22. Install dependencies and keep environment files private:

```sh
npm ci
npm run agent-runner:install
npm run typecheck
npm run typecheck:agent-runner
npm run typecheck:processor-edge
npm run build
```

The target environment file must contain matching `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`: `.env.local` for dev, `.env.production.local` for production. A production deploy key, if present, must match `prod:different-gnu-398|...`. The scripts reject mismatched targets before creating or changing an app. Ambient deploy keys are ignored unless declared in the selected file.

Configure that environment's `DEEPGRAM_API_KEY`, `FAL_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` in the selected file, selected Convex deployment, or explicitly supplied deployment environment. These enable the full processor. The script reads `RENDER_WORKER_SECRET` and `MEDIA_WORKER_URL` directly from the selected Convex deployment. Optional `GEMINI_VIDEO_MODEL` and `MEDIA_VISION_GEMINI_FALLBACK` can be supplied in the selected file. No signing secret, Convex deployment credential, Clerk key or Fly API token enters the runtime image.

Authenticate `flyctl` with an account allowed to create the selected app, or supply a Fly deploy token scoped to that app for subsequent releases. The script creates a separate app-scoped dispatcher token, stores it as `FLY_PROCESSOR_API_TOKEN` on that Convex deployment and imports runtime secrets into only that Fly app. Subsequent releases reuse the selected Convex deployment's `FLY_PROCESSOR_API_TOKEN`; supply a new `FLY_PROCESSOR_API_TOKEN` to rotate it. Generated tokens expire after one year; rotate before expiry by redeploying. Revoke replaced tokens after the deployment is verified.

```sh
# Build remotely, verify on Fly, deploy dev Convex and select Fly processing.
npm run deploy:fly-processor

# Build and verify without changing the currently selected queue backend.
npm run deploy:fly-processor -- --stage-only

# Full production processor release, including Convex.
npm run deploy:production

# Processor image only when CI has already deployed this commit's Convex.
npm run deploy:production -- --processor-only

# Environment/credential preflight with no cloud mutations.
npm run deploy:fly-processor -- --prod --dry-run
```

Builds use `flyctl deploy --remote-only --build-only --push`. No local Docker engine or builder is required. The allow-list build context excludes credentials, Git history, uploads and local data, and is deleted after the release. The pinned beat model can be seeded from `.data/beat-tracking-models/hub/checkpoints/beat_this-final0.ckpt`; its checksum is verified during the build.

Before activating, the deployment command creates scratch with scheduled snapshots disabled and starts a queue-free machine from the new image on the production CPU/memory profile and runs the existing full runtime check, verifies clean exit without OOM, deploys Convex unless `--skip-convex` was specified, then checks the processor version against the source. Only then does it publish the image settings and select Fly. Existing processing machines finish on their original images. New machines use the new image.

`npm run deploy:fly-exports [-- --prod]` still deploys the separate lean export image and updates only `FLY_RENDER_IMAGE` in its matching environment. Processor releases leave export configuration unchanged.

CI's production environment needs `FLY_PROCESSOR_DEPLOY_TOKEN` scoped to `revline-processor`, plus `CONVEX_DEPLOY_KEY`, `DEEPGRAM_API_KEY`, `FAL_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY`. The frontend job retains its Cloudflare credentials. The processor job uses remote builds, stages the verified image without changing the selected backend, and no longer deploys the Cloudflare container controller. Once production is explicitly switched to Fly, subsequent staged releases are picked up by new Fly machines.

## Production cutover

The branch's trial rollout changes development only. Run these steps after merging the verified branch:

1. Confirm `.env.production.local` targets `prod:different-gnu-398` and `https://different-gnu-398.convex.cloud`, with the production provider credentials. Preserve the current production `MEDIA_PROCESSOR_WAKE_URL` and Cloudflare app for rollback.
2. Run `npm run deploy:production -- --stage-only`. This creates `revline-processor` if needed, installs its production secrets, remotely builds and verifies its full runtime, deploys production Convex, and stages the Fly image. The selected queue backend is unchanged. Check the command reports `different-gnu-398` and `revline-processor`.
3. Set any desired production capacity overrides using `npx convex env set FLY_PROCESSOR_CPUS 8 --prod` and `npx convex env set FLY_PROCESSOR_MAX_MACHINES 4 --prod`.
4. Run `npx convex env set MEDIA_PROCESSOR_BACKEND fly --prod`, then `npx convex run flyProcessor:dispatch '{}' --prod`. New attempts route to Fly. Cloudflare finishes any existing leases and claims nothing further.
5. Upload a video and request preview, transcription and a representative analysis through the hosted editor. Follow `flyctl logs -a revline-processor` and `npx convex logs --prod`. Confirm attempt 1 completes, output reaches the production R2 media Worker, progress updates, and `flyctl machine list -a revline-processor` becomes empty after idle. `flyctl volumes list -a revline-processor` should show no attached/live scratch volumes after the cleanup grace period. Fly may retain deleted entries as `pending_destroy` while removal finishes.
6. Keep the Cloudflare container app until the user confirms Fly works. For subsequent releases, `npm run deploy:production` performs the verified Fly activation in one command.

Rollback takes one setting: `npx convex env set MEDIA_PROCESSOR_BACKEND cloudflare --prod`, followed by `npx convex run mediaProcessor:wake '{}' --prod`. This does not interrupt active Fly leases. Keep the old Cloudflare wake URL and secret valid throughout the confirmation period. To return dev to its laptop consumer, set `MEDIA_PROCESSOR_BACKEND local --deployment majestic-alpaca-541`; leave the existing dev server and worker running.

## Trial verification

The complete image and scratch preflight passed on development. Natural queue wake started processors within the configured cap, existing snapshot work reported progress and renewed leases, and transcription, music beats and shot detection completed through the normal task APIs. The fresh beat task completed on attempt 1 in 6.283 seconds; shot detection of the original 25-second 4096×2160 source completed on attempt 1 in 41.137 seconds. The first trimmed podcast shot sample was rejected by the existing completeness check because its container declares 1,897 frames but only 1,800 decode; that check remains intact.

Cold processor provisioning was observed at 36 to 52 seconds, including image pull and fresh scratch initialization. Benchmark times exclude this startup. All trial machines were removed, and scratch volumes were marked for deletion (`pending_destroy` on Fly). Both duplicated projects were removed while the original assets remained present. Development was returned to `MEDIA_PROCESSOR_BACKEND=local` after the trial; the existing server and local worker were never restarted. Production was not changed.

## Delete the retired Cloudflare container app

Only after the user's confirmation, with production backend still set to `fly`:

1. Confirm the old controller reports no active tasks at its authenticated `/status` endpoint. Send the worker bearer credential through a secure pipe or client, never a CLI argument or printed URL.
2. Run `npx wrangler containers list --config infra/media-worker/edge/wrangler.jsonc`. Record only the application ID belonging to `revline-media-processor-production` / its `MediaProcessor` container. Do not select the R2, frontend or agent applications.
3. Run `npx wrangler containers delete <that-application-id> --config infra/media-worker/edge/wrangler.jsonc`.
4. Run `npx wrangler delete revline-media-processor-production --config infra/media-worker/edge/wrangler.jsonc`. This removes its controller, cron and Durable Object namespace. Inspect the named application before confirming deletion.
5. Run `npx convex env remove MEDIA_PROCESSOR_WAKE_URL --prod`. Remove any obsolete processor-only Cloudflare deployment secrets from CI. Retain Cloudflare credentials used by the frontend, media Worker and agent runner.
6. List containers and Workers again to confirm only the named retired processor is gone. Code/config under `infra/media-worker/edge` remain in Git until a later cleanup change.

## Measurements and costs

Measured on Fly development in `iad`, 2026-11-02, with the existing encoder from `origin/main` and machine-sized threads:

| Operation | Machine | Wall time | Result |
| --- | --- | --- | --- |
| 10-minute 1080p60 preview | performance-4x, 8 GiB | 338.318 s | 1280×720, 60 fps, 600.016667 s |
| Same preview, same source/settings | performance-8x, 16 GiB | 236.674 s | 1280×720, 60 fps, 600.016667 s |
| Fresh 60.000635 s podcast transcription | performance-8x, 16 GiB | 2.630 s | 196 timed words, 48 segments, quiet-audio and speech cleanup results |

The preview source was the first ten minutes of the existing dev 1920×1080, 60 fps gameplay upload. Timings cover `preparePreviewVideo`, including its probes and faststart; they exclude machine startup, source download and output upload. The download took 7.726 seconds in the 4-CPU run. The transcription timing covers the full `processMediaTask` path, including a fresh source download, MP3 extraction, actual Deepgram request and both cleanup passes. It excludes machine startup and queue latency. No provider response was mocked. Outputs retained source duration and frame rate.

The final parallel encoder was then measured with the same source and quality settings:

| Operation | Machine | Wall time | CPU budget |
| --- | --- | --- | --- |
| Parallel 10-minute 1080p60 preview | performance-4x, 8 GiB | 232.247 s | Two chunks, two threads each |
| Same parallel preview | performance-8x, 16 GiB | 177.603 s | Two chunks, four threads each |
| Real 18.239708 s VFR portrait video | performance-8x, 16 GiB | 8.570 s | One chunk, eight threads |

The ten-minute output retained all 36,001 video packets with exactly matching presentation timestamps and all 25,840 AAC packet timestamps. The VFR output retained all 1,083 video timestamps and 855 audio packet timestamps exactly. Every presentation timestamp was compared, including chunk joins. MP4 average-frame-rate headers can differ after concatenation even though presentation timestamps are identical.

Eight CPUs reduced parallel preview wall time by 23.5%, at approximately 53% more encoding compute cost per preview than four CPUs. The default prioritizes faster processing and the larger memory allowance. Set `FLY_PROCESSOR_CPUS=4` for the cheaper alternative. The first table is the single-process baseline; the parallel table includes boundary scanning, encoding, concatenation and probing.

Prices are per running machine, billed by the second in `iad`: performance-4x with 8 GiB RAM costs $0.1833/hour; performance-8x with 16 GiB costs $0.3667/hour. A 20 GB scratch volume adds approximately $0.00417 per provisioned hour, including its cleanup grace period. Four running performance-8x processors cost approximately $1.4668/hour in compute. These are rates, not a monthly spending cap. Internet egress and external transcription/vision APIs are separate.

Sources checked 2026-11-02: [Fly pricing](https://fly.io/pricing/), [resource billing and volumes](https://docs.fly.io/about/pricing), [Machines API](https://docs.fly.io/machines/api/machines-resource).
