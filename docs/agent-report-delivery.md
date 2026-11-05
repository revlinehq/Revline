# Agent report delivery

Agent reports stay in `incidents`, including during GitHub outages. The backend excludes them from the old automatic fixer and webhook path. Runtime incident delivery otherwise retains its existing executor. Issue delivery runs independently of T3 authentication, using the existing private `~/.revline-incidents/github-token`; never copy this credential into backend records or prompts.

Grouping is deliberately conservative: the existing SHA-256 fingerprint combines normalized message, location, kind and tool/task signature. Environment plus fingerprint identifies an issue across generations. It does not merge different fingerprints merely because their tool or generic error matches. Every issue names its saved incident ID; that record retains the occurrence count and latest four scrubbed samples. Older samples were already bounded before this change; full historical evidence cannot be reconstructed. Issue reconciliation reads all open and closed repository issues directly, avoiding search indexing delays. A closed issue is updated, never reopened. Each distinct saved occurrence count appends an idempotent evidence section; existing issue text is preserved. Closed issues are excluded from fixer dispatch. GitHub body-size failures retain the report for operator review.

Issue delivery has its own lease/status, attempt budget (five consecutive failures), and exponential delay capped at one hour. A crash after creation is recovered by the environment/fingerprint body marker. Claims expire after ten minutes. Do not run overlapping delivery services for the same environment. A failed ambiguous request stops the pass; the next pass reconciles before creating anything. Failed GitHub requests never print subprocess errors. Exhausted rows remain saved for operator inspection; they are not automatically reset.

## Review-stage status and rollout

This PR changes source only. No shared deployment, secret, running listener or GitHub Issue is changed during implementation. Production's subscription error remains unconfirmed: verify with the production credential in isolation after approval rather than assuming it shares development's credential mismatch.

After approval, announce each backend target separately, deploy the backend gate first, then update the listener checkout. Only then coordinate private credential repair for dev and prod separately. Do not restart the old Mac checkout or run `incidents:install` to repair credentials: it changes shared configuration and can enable legacy delivery. Verify the updated backend excludes agent reports before enabling any executor. Keep the PC service disabled until explicitly enabled.

Dry-run the whole saved backlog (paginated counts, no writes):

```sh
npm run incidents:issues -- --deployment dev --backfill --limit 5
npm run incidents:issues -- --deployment prod --backfill --limit 5
```

After approval/deployment, deliver at most five eligible backlog reports per invocation:

```sh
npm run incidents:issues -- --deployment dev --backfill --deliver --limit 5
```

Repeat deliberately after reviewing results; use the separate prod command only after its credentials are verified. New reports have issue bookkeeping initialized; legacy reports require `--backfill`. Run the independent delivery service with the following command under the existing service manager (one per environment), after approval:

```sh
npm run incidents:issues -- --deployment dev --deliver --watch --limit 5
```

Fixer dispatch is separately opt-in. Preview up to two eligible saved issues, then enqueue them explicitly:

```sh
npm run incidents:issues -- --deployment dev --dispatch --limit 2
npm run incidents:issues -- --deployment dev --dispatch --deliver --limit 2
```

Dispatch only considers issues already recorded before that pass. The existing listener must be running to consume them. Its two-worker cap, durable jobs, claim token, fingerprint PR reconciliation and PR write-back remain in force. A saved issue can be dispatched once; fixer failures need explicit operator investigation/retry through the existing incident retry mutation. Existing PRs block redispatch. PR prompts link back with `Refs`, and prohibit deployment. No automated merge or deployment occurs. No LLM triage or new orchestration service is introduced.
