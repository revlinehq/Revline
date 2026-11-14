# Railway worker hosting

Railway runs media processing and standard/Ultra exports. Convex retains project data, realtime updates, task leases, progress, account seats, and scheduling. Cloudflare retains the website, agent runner, and media storage.

## Environment boundaries

| Target | Convex deployment | Railway environment |
| --- | --- | --- |
| Production | `different-gnu-398` | `b81548ce-f856-433b-a3aa-80f51d06ddd8` |

There is no staging environment; production protects itself (`docs/releases.md`, Railway). Keep manifests, credentials and rollout records in ignored `.data/` files. Development worktrees use their scoped backend and local worker, never production credentials.

## Permanent services

Each pool contains explicit service IDs. Every service deploys from GitHub `revlinehq/Revline` branch `main` with Railway's automatic deploys (which need the Railway GitHub app installed on `revlinehq`, "Wait for CI" off and no watch paths; `docs/releases.md`, When main does not deploy) (Dockerfile `media-processor/Dockerfile`, target from `REVLINE_FINAL_TARGET`): Railway decides which commit runs, and the Convex dispatcher only starts a slot's newest good build (`docs/releases.md`, Railway). One replica in the selected region, `railway-entry.sh`, no public workload endpoint, and no automatic restart after a normal idle exit.

CPU and memory limits are read from the dashboard. A resource change invalidates cached deployment snapshots so the next controlled start uses the current limits. Pool counts remain bounded by `MEDIA_PROCESSOR_MAX_WORKERS`, `EXPORT_MAX_WORKERS_STANDARD`, and `EXPORT_MAX_WORKERS_ULTRA`. Existing legacy capacity settings remain compatible until replaced with those names.

The lean export image serves both Pro and Ultra queues. Ultra jobs use only their dedicated pool. Renderer settings preserve resolution, frame rate, and quality independently of the service resource allocation.

## Releases and rollback

Nothing stages the permanent services: every merge to `main` deploys them. `npm run release:status` shows what each production slot runs. Roll back by reverting on `main`, or by redeploying an earlier deployment of the slot in the Railway dashboard. To hold a lane on one registry image, use the pinned-image `stage` (`docs/releases.md`, Pinned-image rollback):

```sh
node scripts/railway-workers.mjs plan --environment production --config .data/railway/production.json --kind processor
node scripts/railway-workers.mjs stage --environment production --config .data/railway/production.json --env-file .data/railway/production.env --kind processor --apply
```

The pinned commit must be one production already ran (the promotion ledger or the slot's Railway deployments).

`pause` and `resume` still hold and release claims for maintenance. `stage-repository` and `verify` are retired. Routing (`cutover`, `rollback`) is unchanged: it supports only Railway, local or Cloudflare processing, and rejects retired-host receipts before changing routing.

## Distributed exports

Keep `distributedExports: false` on Hobby. Temporary distributed chunks still run a pinned `exportsImage` from the private GHCR registry with the environment's registry credentials (`RAILWAY_REGISTRY_USERNAME`/`RAILWAY_REGISTRY_PASSWORD`), so enabling them needs that pin kept current. They also require immutable private image support, scoped artifact credentials, and evidence proving chunk completion and assembly. Enabling distributed exports must preserve source, artifact, and environment isolation.

A distributed export that fails (a chunk service that cannot start, a chunk that fails twice, a failed join) renders on the coordinating machine instead of failing the export.

Joins, verified 2026-11-13 on a 60 s 1080x1920 30 fps captioned reel with seams inside captions, a crossfade, a wipe, a shake and a punch zoom, against a single-machine export of the same composition: the same 1800 frames and 60.000 s, an IDR keyframe at each seam (HyperFrames locks the GOP to the chunk with a closed GOP and joins by stream copy), every chunked frame closest to the same single-pass frame, SSIM ≥ 0.99 outside the single-pass glitch below, and bit-identical audio (one track mixed at plan time, not per chunk). The single-machine render dropped the outgoing clip for two frames at a cut inside a transition; the chunked render did not.

Before turning it on: each chunk creates and deletes a Railway service, and Railway caps new services per account at about 25 a day on every plan, so with 3 extra chunks per export it stops after about 8 exports a day. Chunks run the pinned `exportsImage`, which nothing rebuilds now that slots deploy from `main`. The plan for a 60 s reel was 335 MB, uploaded once and downloaded by each chunk.

Temporary chunk services have a separate bounded CPU/RAM profile. Artifacts use an attempt-specific prefix; cleanup validates both that prefix and object age before deletion. Permanent service resource settings are never overwritten by chunk defaults.
