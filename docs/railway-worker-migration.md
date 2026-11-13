# Railway worker hosting

Railway runs media processing and standard/Ultra exports. Convex retains project data, realtime updates, task leases, progress, account seats, and scheduling. Cloudflare retains the website, agent runner, and media storage.

## Environment boundaries

| Target | Convex deployment | Railway environment |
| --- | --- | --- |
| Staging | `striped-starling-234` | `dde1b6c2-9225-46d3-ae43-c20fd2456d3b` |
| Production | `different-gnu-398` | `b81548ce-f856-433b-a3aa-80f51d06ddd8` |

Each environment has separate Convex and Railway credentials. Keep manifests, credentials, verification receipts, and rollout records in ignored `.data/` files. Development worktrees use their scoped backend and local worker, never production credentials.

## Permanent services

Each pool contains explicit service IDs; staging and production use the same three services in their own Railway environments. Every service deploys from GitHub `revlinehq/Revline` branch `main` with Railway's automatic deploys (Dockerfile `media-processor/Dockerfile`, target from `REVLINE_FINAL_TARGET`): Railway decides which commit runs, and the Convex dispatcher only starts a slot's newest good build (`docs/releases.md`, Railway). One replica in the selected region, `railway-entry.sh`, no public workload endpoint, and no automatic restart after a normal idle exit.

CPU and memory limits are read from the dashboard. A resource change invalidates cached deployment snapshots so the next controlled start uses the current limits. Pool counts remain bounded by `MEDIA_PROCESSOR_MAX_WORKERS`, `EXPORT_MAX_WORKERS_STANDARD`, and `EXPORT_MAX_WORKERS_ULTRA`. Existing legacy capacity settings remain compatible until replaced with those names.

The lean export image serves both Pro and Ultra queues. Ultra jobs use only their dedicated pool. Renderer settings preserve resolution, frame rate, and quality independently of the service resource allocation.

## Releases and rollback

Nothing stages the permanent services: every merge to `main` deploys them. `npm run release:status` shows what each production slot runs. Roll back by reverting on `main`, or by redeploying an earlier deployment of the slot in the Railway dashboard. To hold a lane on one registry image, use the pinned-image `stage` (`docs/releases.md`, Pinned-image rollback):

```sh
node scripts/railway-workers.mjs plan --environment production --config .data/railway/production.json --kind processor
node scripts/railway-workers.mjs stage --environment production --config .data/railway/production.json --env-file .data/railway/production.env --kind processor --staging-receipt .data/railway/promotion.json --staging-env-file .data/railway/staging.env --apply
```

`pause` and `resume` still hold and release claims for maintenance. `stage-repository` and `verify` are retired. Routing (`cutover`, `rollback`) is unchanged: it supports only Railway, local or Cloudflare processing, and rejects retired-host receipts before changing routing.

## Distributed exports

Keep `distributedExports: false` on Hobby. Temporary distributed chunks still run a pinned `exportsImage` from the private GHCR registry with the environment's registry credentials (`RAILWAY_REGISTRY_USERNAME`/`RAILWAY_REGISTRY_PASSWORD`), so enabling them needs that pin kept current. They also require immutable private image support, scoped artifact credentials, and additional staging evidence proving chunk completion and assembly. Enabling distributed exports must preserve source, artifact, and environment isolation.

Temporary chunk services have a separate bounded CPU/RAM profile. Artifacts use an attempt-specific prefix; cleanup validates both that prefix and object age before deletion. Permanent service resource settings are never overwritten by chunk defaults.
