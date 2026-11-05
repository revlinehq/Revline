# Media processing and exports

Production uses three Railway services: Media Processing, Video Export, and Ultra Video Export. Convex owns task claims, leases, progress, cancellation, account seats, and retries. Cloudflare R2 holds media; the frontend and agent runner remain on Cloudflare.

## Runtime images

The Dockerfile packages a full `railway-processor` target and a lean `railway-exports` target. The full processor includes FFmpeg, Chromium, Python trackers, CPU Torch, the checksum-pinned Beat This model, PySceneDetect, and yt-dlp. Export services omit the analysis models. The default `processor` target remains available for the Cloudflare container backend.

Railway services use unprivileged ephemeral scratch, authenticate against their selected Convex deployment, process one task at a time, and exit after the configured idle period. Enqueueing work wakes the matching service. Standard and Ultra queues retain separate account seats and worker pools.

## Capacity

Permanent service CPU and RAM limits are managed in the Railway dashboard. The entrypoint derives native thread budgets from the actual container allocation. Worker counts use these optional backend settings:

- `MEDIA_PROCESSOR_MAX_WORKERS`: defaults to 4, range 1–8.
- `EXPORT_MAX_WORKERS_STANDARD`: defaults to 10, range 0–100.
- `EXPORT_MAX_WORKERS_ULTRA`: defaults to 10, range 0–100.

A zero export pool limit holds that lane. New capacity settings take precedence over the legacy deployment variable names; existing settings remain effective during adoption. The persisted dispatch-lock table keeps its original name to preserve outstanding locks.

Distributed exports are disabled on Hobby. When enabled in the verified manifest, Railway chunk workers use the separate bounded chunk resource contract. They require supported private image pulls and matching staging job evidence. Single-worker export does not require those image pulls.

## Development and releases

Local development uses `npm run dev:isolated` in an agent worktree. It starts the frontend and local media worker against a scoped development backend. See [isolated development](../../docs/isolated-development.md).

Hosted releases use explicit manifests and separate environment files, runtime preflight, authenticated queue verification, and real staging jobs before production promotion. See the [Railway hosting runbook](../../docs/railway-worker-migration.md). No release command runs during install or build.
