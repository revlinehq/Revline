# Isolated agent development

The primary checkout on `main` owns `majestic-alpaca-541`. Its app on port 3001, including the Mac's app, keeps using that deployment. Agent worktrees use separate cloud dev deployments, queues, secrets and Cloudflare Workers.

Run in a worktree after `npm ci`:

```sh
npm run dev:isolated
```

This creates or reuses a backend, renews its five-day expiration, copies shared **dev** environment settings through stdin, deploys this branch, seeds a project with up to 20 R2 media references from one recent dev project, and starts the frontend and local media worker on a free port other than 3001. Both services must report ready. The project URL, owner and timeline IDs are printed. Use that owner when signing in through Clerk dev. No shared schema, function, project or auth record is written, and no database export is used.

For setup without starting the app, or to choose footage and a Clerk dev user:

```sh
npm run dev:isolated -- --setup-only --project=<dev-project-id> --owner=<clerk-dev-user-id>
npm run dev
```

The default source search considers the 30 most recent projects. Add `--source-owner=<clerk-dev-user-id>` with `--project` to select an older project. Source projects must have video stored in R2; legacy Convex storage IDs cannot be shared across deployments. The seed puts one short video shot on the timeline and keeps the other media in the bin as footage/references. Repeated setup keeps its source project and preserves the seeded project and edits. Choose a source when first setting up a worktree; a fresh backend is needed to replace its seed. Stop this worktree's services before repeating setup or cleanup; a PID guard prevents reconfiguring a running editor's origin.

Clerk development authentication uses the same issuer and public key as main. The local frontend reads the Clerk **test** secret from the primary checkout into process memory. `REVLINE_MAIN_ENV` can select a different main env-file path; it must target shared dev with Clerk test keys. Backend model and media credentials are never written into the repository. `.env.local` contains public settings, deployment pointers and the intentionally scoped Convex deploy key. Do not copy main's env file over it.

The shared global `revline-local` connector stays on main. Configure the agent's **worktree-local** MCP server named `revline-local` as a stdio command:

```text
command: node
args: [<absolute-worktree-path>/scripts/isolated-mcp.mjs]
```

That transport reads its personal MCP token from its own backend in memory and forwards the real MCP protocol, including images and long-running media calls. It never changes the global connector. Existing agent sessions connected to shared `revline-local` must use this transport in a new session. Never drive tools with `npx convex run mcpActions:callTool` or `--identity`: that acts as a user without the MCP's owner and task checks. Always pass the printed project and timeline IDs explicitly.

`npx convex dev --once` now targets the scoped backend. The npm postinstall hook installs a local CLI guard: branch worktrees need valid isolation state and a matching dev key before pushing; deployment override flags are refused. `npm run dev` also refuses an unconfigured worktree. This is an accidental-deploy guard around the installed CLI, not an access-control boundary against someone deliberately bypassing it with another binary or editing credentials.

After merging this change, update existing worktrees to include it and run `npm ci` before their next Convex command. Updating main alone cannot install the guard in an older checkout's separate dependencies.

Each worktree has a private agent runner built from its branch, with its `CONVEX_SITE_URL` fixed to that backend. HMAC authentication, nonce checks and run tokens remain in force. A private media Worker accepts only that worktree's exact localhost origin, retains signed media grants, and prevents writes to borrowed source keys. No wildcard Convex-origin or localhost allowlist is added to a shared Worker. R2 objects are referenced, not duplicated; deletion in the isolated project cannot remove borrowed footage. Fresh derived media belongs to the isolated project. Source footage must remain in the original project while the branch uses it.

The local media worker and log tail connect to the selected backend. Hosted processor wakeups are disabled, so an agent's frontend and worker must keep running during media processing. Billing and Discord alerts are disabled; live Stripe/webhook credentials are omitted. Runner, media-signing and queue secrets are unique per backend.

## GPU export rendering

Browser exports draw frames in chrome-headless-shell with SwiftShader (CPU WebGL) by default, as on the hosted media processor. A development worker on a machine with a real GPU can draw them on the GPU instead:

```sh
REVLINE_RENDER_GPU=1 npm run worker   # or add REVLINE_RENDER_GPU=1 to .env.local
```

Before each export, `scripts/render-gpu.mjs` launches Chrome with HyperFrames' hardware flags plus `--disable-accelerated-video-decode`, decodes the export's own footage and draws through four WebGL canvases. If it gets a software renderer, a lost context, a GL error or wrong pixels, the export uses SwiftShader. The worker log shows `Export renderer: [revline] GPU effects preflight passed on <GPU>` or `... failed (<reason>); drawing export frames with SwiftShader`. GPU exports are also strict: if an effect cannot draw mid-render, that frame fails and the export renders again on SwiftShader, so effects are never silently dropped. On Linux the NVIDIA EGL vendor is preferred when installed; without it, hybrid machines draw on the integrated GPU. A non-software `PRODUCER_BROWSER_GPU_MODE` takes the same checks.

GPU mode raises capture workers to `min(6, CPUs/2, memory)`, FFmpeg slots to 4 and x264 threads to `min(8, CPUs)`; preset, CRF, resolution and frame rate stay what the export asked for. `REVLINE_RENDER_WORKERS`, `REVLINE_RENDER_FFMPEG_SLOTS` and `REVLINE_RENDER_ENCODE_THREADS` still override. Without `REVLINE_RENDER_GPU`, or with `PRODUCER_BROWSER_GPU_MODE=software` (the media processor image), rendering is unchanged.

## Cleanup and limits

Stop this worktree's development services, then remove its resources before removing the worktree:

```sh
npm run dev:isolated:cleanup
```

Convex expires the backend server-side five days after its last isolated startup, even if the PC is off. Each subsequent isolated startup also reaps recorded worktrees that disappeared or expired, deleting their private Workers and remaining backend. Records live in the shared Git directory, outside the repository. Worker cleanup is opportunistic; on an unused machine the Workers remain until another startup or explicit cleanup. They have no cron and no work after their backend expires. Generated R2 media is not swept by deployment expiration; delete the isolated project before cleanup to reclaim generated files. Borrowed originals are retained.

Cloud dev deployments were selected over preview deployments because Convex 1.46 supports named, expiring agent dev deployments directly with the existing CLI login. Preview deployments need a preview key and have plan-dependent automatic lifetimes. Local deployments save cloud usage but require a tunnel for the remote runner's callbacks and a continuously running local backend.

There is no extra developer seat per agent. Cloud usage counts toward the team's plan; Free/Starter currently allow 40 deployments, Professional 300, and higher plans unlimited. US usage beyond included quotas: Starter $2.20/million function calls, $0.33/GB-hour action compute and $0.22/GB-month database storage; Professional $2, $0.30 and $0.20 respectively. Model API calls, Cloudflare Workers/Durable Objects and newly generated R2 objects use their usual metered charges. The seed itself duplicates only metadata. Provisioning requires a logged-in Convex CLI and Cloudflare Wrangler account with deployment rights; no production credentials or preview key is needed.

Sources checked November 3, 2026: [Convex agent deployments](https://docs.convex.dev/cli/agent-mode), [multiple deployments](https://docs.convex.dev/production/multiple-deployments), [local deployment limitations](https://docs.convex.dev/cli/local-deployments), [limits](https://docs.convex.dev/production/state/limits), [pricing](https://www.convex.dev/pricing).

## Live verification, November 3, 2026

Verified from the `isolated-dev-backends` worktree against `energetic-jay-790`:

- `npm run dev:isolated` created/reused the backend and seeded project `sx7d6m7x124pkh057gy1sd23kd8hh3z5` with six R2 references to existing uploaded footage/audio. Repeated setup retained its project and edits. The frontend and media worker both reported ready on port 3253.
- A real Clerk development session's `convex` JWT authenticated and read the seeded project. The stdio `revline-local` transport listed 168 tools and completed `readFrames` with one image from the 1920×1080, 60fps footage. The final uncached frame request completed in 19.3 seconds.
- A normal Clerk-authenticated editor request changed the seeded video's volume from 50% to 40%, saved revision 2, rendered its adjacent verification frames, and finished `completed` with no error. This caught and verified the `snapshotFrames` Cloudflare redirect-mode fix.
- Copied settings matched shared dev byte-for-byte except the documented isolation overrides/omissions. Queue, media-signing and runner secrets differed from shared dev. Worktree env files contained no copied backend secrets.
- The media Worker allowed its own localhost origin (200), refused port 3001's origin (403), and rejected a harmless control probe against a borrowed key (403). The runner refused an unsigned call (401).
- Bare Convex dev before setup, an inherited shared deployment selector, explicit deployment/env-file overrides, and reconfiguration while the editor was running all failed before deployment.
- `npm run typecheck`, `npm run build`, and `npm run typecheck:agent-runner` passed. No test files, mocks, fixtures, smoke scripts, database exports or production operations were used.

Shared-dev schema and function API hashes matched the original snapshots. An unrelated session redeployed shared dev at 23:59:45 UTC while this work was running. A fresh baseline before the final successful run also compared the compiled code: all **247 module hashes**, schema and `lastDeployTime` were unchanged afterward (checked 00:05:18 UTC November 4, still November 3 locally). We issued no shared-dev deploy.

```text
schema SHA-256:       301e4a211af74f0ef7be260a7b19bf20f1d260012742200e7213de5a5ea78c95
function API SHA-256: 8963e2a3969a7299e9705b3f64c800fec08699659524a7cd8455a28267049f3b
compiled config SHA: f5c2076dd35e12efb674e0928367c8e4ed8afd1f37bc24fa1c7408181a176e82
lastDeployTime:       1793750385779
```

## Faithful project snapshots

For a cached-analysis development baseline, use `npm run dev:isolated -- --snapshot --project=<source-project-id> --source-owner=<source-owner-id>` (add `--setup-only` to avoid starting services). This reads the complete current timeline, saved tabs and hydrated asset analysis through existing owner-checked queries. It imports a new private project, remaps media IDs and links, and borrows original and preview R2 objects read-only. It never writes the source or transfers credentials. Source scene code is materialized before import. Undo history, chats, running jobs and revision-bound verification are not imported.

All source media must use R2, with fewer than 200 assets and at most ten tabs; unsupported or missing references fail the transaction. Legacy deployment-local thumbnails are omitted. Convex transaction and argument limits still apply: oversized imports fail rather than truncate analysis. Snapshot reads reject concurrent timeline changes; stop source editing and analysis before importing. Repeat startup retains the imported project's edits. Add `--fresh-snapshot` to create another baseline without replacing the previous private project. Stop only that worktree's services before setup, as usual.
