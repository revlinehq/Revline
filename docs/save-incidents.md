# Save confirmation incidents

The shared editor toolkit reports successful editing-tool results from Convex,
the Cloudflare agent runner, and MCP. The browser is not involved. Read-only
tools, tools that save outside the timeline, explicit tool failures, and
`unchanged: true` results without staging do not create incidents.

The tool layer now supplies atomic write receipts and shared classifications;
see [the audit and receipt contract](save-receipts.md). Brief reads and saved
briefs, tracking/analysis results, background-job acknowledgements and unchanged
edits no longer fall through a convention-only save-envelope check. Legacy
missing-evidence groups remain historical diagnostics, not proof of lost work.

The terminal conditions diagnose missing protocol evidence; the editor does not infer a failed save from a missing field:

- `missing_save_evidence`: a completed editing step has neither `saved: true`
  nor `unchanged: true`.
- `staged_without_receipt`: a staged step outlives its run without publication
  confirmation.
- `staged_revision_missing`: a staged result has no integer revision to match.
- `staged_receipt_mismatch`: the output revision and publication do not match.

Staging is normal while a turn is running. Small pending rows are checked when
`assistant.finish` commits, with a scheduled fallback for stopped actions and
lost runners. Timeline publication records its revision in the same transaction
as the save. MCP publication uses that transaction's confirmation because MCP
has no assistant-message receipt. A matching saved publication clears pending
steps. Matching failed or aborted receipts already have the separate `Not saved`
card, so they do not produce these incidents.

Each group has a SHA-256 fingerprint of the version, tool, condition and output
shape, a count, deployment identity, first/latest timestamps, and one latest
sample. The sample includes project, thread when available, run/turn, prompt when
available, tool-call identity, step revisions before/after, and bounded input and
output shapes. The latest publication status and revisions are retained when
available, including mismatches. All free-form string values become type labels.
Code, media, URLs and credential fields are omitted or redacted. No original prompt, scene
code, media bytes, secrets or tokens are retained. Shapes are capped at 1,800
characters each; pending steps are deleted after settlement. There is no
historical payload archive or backfill.

`saveIncidentRuns`, `saveIncidentSteps` and `saveIncidentGroups` are operational
tables, separate from all editor subscriptions. Readers use indexes and bounded
batches following [database-io.md](database-io.md). Only administrative internal
functions expose groups. Deployment identity comes from the backend's built-in
`CONVEX_CLOUD_URL`, with the same dev/prod mapping as the release scripts.

## Run the local PR agent

Use Node 22, local Codex login, authenticated `gh`, Git access to `origin`, and
existing Convex CLI login or the selected deployment's own deploy credential.
Install dependencies in the checkout containing this script with `npm ci`.

```sh
npm run incidents:fix -- --env dev --list
npm run incidents:fix -- --env dev --limit 3
npm run incidents:fix -- --env prod --limit 1
```

The runner reads `.env.local` for dev or `.env.production.local` for prod from
the main Git worktree. Use `--credentials-dir /absolute/path/to/checkout` if
those existing files live elsewhere. It passes that file directly to
`npx --no-install convex run --env-file ...`, adding `--prod` only for prod.
It validates the deployment, public URL and any deploy-key target, and refuses
inherited deployment overrides. Environment files and secrets are never copied
to a fix worktree, brief, terminal output or agent log. Only public Convex and
Clerk build values are passed to the child agent.

The default is three agents, sequentially, with a maximum of five per invocation.
The runner examines up to 100 open and 100 proposed groups in descending
frequency. It checks GitHub for an existing open PR using the stored link and the incident marker before
starting work. A Mac lock prevents overlapping runs for the same repository and
deployment. Listing does not start agents or write backend state.

Each agent starts in a new worktree under `../revline-incident-fixes/`, on a
unique `fix/save-...` branch from a freshly fetched `origin/main`. Its scrubbed
brief is retained in that worktree's ignored `.data/save-incident-brief.txt`.
The invocation uses the requested local binary and model:

```sh
codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  -m gpt-6.1-sol -c model_reasoning_effort=high -C WORKTREE -
```

The brief asks it to find the root cause, install dependencies, fix it, pass
`npm run typecheck`, `npm run typecheck:agent-runner` and `npm run build`, commit,
push its own branch, and use `gh pr create` with a title beginning
`Fix save not confirmed:`. It explicitly overrides repository deployment
defaults: no deployment, merge, force push, main push, test-only files or changes
to the live development server. If it cannot justify a fix, it leaves the group
open. The parent verifies the PR's repository, branch, base, title and incident
marker with GitHub before recording its URL. Child CLI output is not printed or
persisted because it can contain private diagnostics.

A proposed patch is `pr_open`, not fixed. Reruns skip its open PR, retry closed
unmerged PRs, and mark a merged PR fixed. New incidents after a fixed group
reopen it. Worktrees and branches remain available for review; the runner never
merges, deploys, pushes to main or removes your worktrees. If interrupted, inspect
the lock path reported by the next run and remove the lock only after the old
process has stopped. If GitHub succeeded but the backend update failed, rerun:
the retained attempt's exact branch and incident marker let it recover the
existing PR, even before GitHub search indexes the PR body. An occurrence newer
than a merged PR remains eligible for another fix.

Admin functions, run with the same environment selection:

```sh
npx convex run saveIncidents:listOpen '{"limit":20}' --env-file /path/.env.local
npx convex run saveIncidents:markFixed '{"groupId":"GROUP_ID","prUrl":"https://github.com/OWNER/REPO/pull/123"}' --env-file /path/.env.local
```

The backend/schema and Cloudflare agent runner must be released together before
reporting and the local command can work. This implementation does not deploy
anything or run a fixer automatically. No production fixer run was performed.
