# Real editor model benchmark

This CLI compares the same three saved editor tasks on Sonnet 5.5 and GPT-6.1 Sol. It calls the deployed editor through the fixture owner's real authenticated session, pins `api.assistant.send.modelChoice`, clones a fresh project for each case/model, and exports through the hosted media worker. It never modifies the source projects. Existing development-only integration-test guards remain in place.

Create a private mode-600 fixture file outside Git using the disposable fixture harness. No API keys belong in this JSON:

```json
{
  "version": 1,
  "target": "production",
  "convexUrl": "https://YOUR-PRODUCTION-DEPLOYMENT.convex.cloud",
  "deploymentName": "YOUR-PRODUCTION-DEPLOYMENT",
  "ownerId": "user_DISPOSABLE_FIXTURE_OWNER",
  "projectTitlePrefix": "MVP QA YOUR-NONCE ",
  "allowedSourceProjectIds": ["OWNED_SOURCE_PROJECT_ID"],
  "sources": {
    "cutsAssetId": "OWNED_VIDEO_ASSET_ID",
    "speechAssetId": "OWNED_SPEECH_ASSET_ID"
  },
  "auth": {
    "clerkSessionId": "sess_DISPOSABLE_FIXTURE_SESSION",
    "clerkAppId": "app_3IhaKL6Wz1vzw3QGkUusb094tcX",
    "clerkInstance": "prod",
    "clerkSecretEnv": "CLERK_SECRET_KEY"
  },
  "usageEnvFile": "/absolute/path/to/.env.production.local",
  "models": ["claude-sonnet-5-5", "gpt-6.1-sol"],
  "maxModelCostUsd": 3,
  "perRunReserveUsd": 1.68,
  "deadlineSeconds": 300,
  "renderDeadlineSeconds": 720,
  "analysisPreparation": {
    "usd": null,
    "note": "Shared extraction, transcription and overview; costs separate from editor-model totals."
  }
}
```

For development, use `target: development`, `clerkInstance: dev`, and its own Convex deployment/environment credentials. The explicit target, environment URL, and deployment name must agree. As an alternative to Clerk token minting, `auth: {"convexTokenFile":"/absolute/private-token.json"}` reads a mode-600 `{ "jwt": "..." }` file on every request. An external fixture harness must refresh that short-lived token while the benchmark runs.

The cut/style source must contain at least six seconds. The speech test uses up to the first twelve seconds and requires a measured, saved transcript before running. Both models receive identical source bytes, cached analysis, initial timeline, and prompt. Shared analysis is fingerprinted and excluded from editor-model usage totals; `null` preparation cost means unmetered, never zero. The subtitle task intentionally tests editing against the same transcript rather than comparing two speech-analysis runs.

Dry-run first; this writes the plan and makes no network calls:

```sh
node --import tsx scripts/editor-model-benchmark.ts \
  --target production \
  --fixture /tmp/revline-mvp-qa/private-fixture.json \
  --output /tmp/revline-mvp-qa/benchmark
```

After reviewing the fixture, source preparation, billing entitlement, target, and plan, run with the target's existing private environment file and explicit `--run`:

```sh
node --env-file=.env.production.local --import tsx scripts/editor-model-benchmark.ts \
  --target production \
  --fixture /tmp/revline-mvp-qa/private-fixture.json \
  --output /tmp/revline-mvp-qa/benchmark \
  --run
```

The existing Clerk CLI mints and refreshes the fixture session's Convex JWT. It receives the explicit environment secret without logging arguments, tokens, stdout, stderr, or raw CLI errors. The runner reads stored Agent usage through the installed `convex run ... --component agent` admin CLI; this is a read-only operation and must work in preflight before any paid edit. No backend endpoint or deployment is added.

All six runs are serial; the subtitle pair reverses model order. Each run reserves $1.68 against the chosen total model-cost ceiling before sending. A successful run refunds its unused reservation only after persisted usage reconciles. Missing usage, an unexpected actual model, inconsistent token counts, a cost overrun, or an editing timeout blocks further runs. Stop is sent on editing deadlines/interruption; hosted render tasks are cancelled on their own deadline. A stopped provider request can still finish remotely, so its reservation remains held. The reservation covers the backend token ceiling at the conservative native GPT long-context rates and guards this controller. It does not guarantee a global provider-account spending cap; provider billing and media-worker costs need separate reconciliation. Native GPT long-context rate multipliers are included in measured cost estimates.

`results.json` records the created project IDs for fixture cleanup, deterministic input fingerprints, final timelines, objective checks, latency, tool-call counts, per-call token usage, cache categories, reasoning token counts, and estimated model cost. Per-run folders contain MP4 exports, `ffprobe` metadata, timeline checks, and PNG samples for visual inspection. Signed media URLs and private provider metadata/reasoning are omitted. Objective timeline checks and valid MP4 files do not establish visual quality: inspect the videos/frames before naming a winner. These are three single-trial tasks, not a statistical ranking.

Keep output directories private and outside Git (or inside the ignored `.data/` directory). Use the disposable fixture harness and its strict nonce prefix plus recorded project IDs to remove benchmark projects when inspection is complete.

An exclusive output-directory run lock and an existing-results check prevent accidental restart from discarding an unsettled reservation. Inspect the previous manifest and provider usage before removing a stale lock or starting another paid run in a fresh directory.
