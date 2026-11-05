# Railway worker hosting

Railway runs media processing and standard/Ultra exports. Convex retains project data, realtime updates, task leases, progress, account seats, and scheduling. Cloudflare retains the website, agent runner, and media storage.

## Environment boundaries

| Target | Convex deployment | Railway environment |
| --- | --- | --- |
| Staging | `striped-starling-234` | `dde1b6c2-9225-46d3-ae43-c20fd2456d3b` |
| Production | `different-gnu-398` | `b81548ce-f856-433b-a3aa-80f51d06ddd8` |

Each environment has separate Convex and Railway credentials. Keep manifests, credentials, verification receipts, and rollout records in ignored `.data/` files. Development worktrees use their scoped backend and local worker, never production credentials.

## Permanent services

Each pool contains explicit service IDs. Every service uses the repository Dockerfile, one replica in the selected region, `railway-entry.sh`, no public workload endpoint, and no automatic restart after a normal idle exit. Autodeploy triggers stay disabled: release commands select an explicit reviewed commit.

CPU and memory limits are read from the dashboard. A resource change invalidates cached deployment snapshots so the next controlled start uses the current limits. Pool counts remain bounded by `MEDIA_PROCESSOR_MAX_WORKERS`, `EXPORT_MAX_WORKERS_STANDARD`, and `EXPORT_MAX_WORKERS_ULTRA`. Existing legacy capacity settings remain compatible until replaced with those names.

The lean export image serves both Pro and Ultra queues. Ultra jobs use only their dedicated pool. Renderer settings preserve resolution, frame rate, and quality independently of the service resource allocation.

## Manual release

Use the existing operator entrypoint with an explicit environment, manifest, environment file, and role:

```sh
node scripts/railway-workers.mjs plan --environment staging --config .data/railway/staging.json
node scripts/railway-workers.mjs stage --environment staging --config .data/railway/staging.json --env-file .data/railway/staging.env --kind all --apply
```

`plan` makes no API calls. Mutations require a clean reviewed checkout. The exact published open PR head may perform bounded isolated staging verification; production operations require reviewed main. No GitHub Actions are needed for manual releases.

Before production, run real staging processing, standard export, and Ultra export jobs. The promotion receipt records their task IDs, service IDs, deployment IDs, and the verified manifest. Promotion queries the live staging backend and authenticated Railway logs to prove completion on the exact selected revision.

```sh
node scripts/railway-workers.mjs pause --environment production --config .data/railway/production.json --env-file .data/railway/production.env --kind all --apply
node scripts/railway-workers.mjs stage --environment production --config .data/railway/production.json --env-file .data/railway/production.env --kind all --staging-receipt .data/railway/promotion.json --staging-env-file .data/railway/staging.env --apply
node scripts/railway-workers.mjs resume --environment production --config .data/railway/production.json --env-file .data/railway/production.env --kind all --staging-receipt .data/railway/promotion.json --staging-env-file .data/railway/staging.env --apply
```

Pause drains existing leases without killing active jobs. Stage verifies the packaged runtime, configures only the selected services, authenticates consumers while claims are paused, and records verification after normal idle exit. Resume requires the exact staged manifest and scoped token. Verify real production jobs and downloaded export artifacts after resuming.

For a release rollback, restore a previously reviewed Railway release and its matching backend manifest through the same staging verification path. Routing receipts support only Railway, local, or Cloudflare processing; retired-host receipts are rejected before changing routing.

## Distributed exports

Keep `distributedExports: false` on Hobby. Permanent services build from the private repository without registry credentials. Temporary distributed chunks require immutable private image support, scoped artifact credentials, and additional staging evidence proving chunk completion and assembly. Enabling distributed exports must preserve source, artifact, and environment isolation.

Temporary chunk services have a separate bounded CPU/RAM profile. Artifacts use an attempt-specific prefix; cleanup validates both that prefix and object age before deletion. Permanent service resource settings are never overwritten by chunk defaults.
