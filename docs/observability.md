# Observability and Discord setup

Clerk signup/deletion and Stripe billing alerts are connected to production (`different-gnu-398`). Each provider has a private channel and a branded webhook under Revline Notifications in Sonic's server. All four channel connection tests were delivered successfully on October 20, 2026. Sentry and PostHog provider configuration remains pending.

## Frontend hosting

Set these in the intended Cloudflare frontend environment, then rebuild. Local development uses `.env.local`; production settings must remain separate.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_TELEMETRY_ENABLED` | Set to `true` only when ready to start sending events. Defaults to disabled. |
| `NEXT_PUBLIC_SENTRY_DSN` | Public DSN for the Revline Sentry project, for browser error capture. |
| `SENTRY_DSN` | Optional server DSN; falls back to the public DSN. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Sentry organization and project slugs. |
| `SENTRY_AUTH_TOKEN` | Optional build-only token for source maps. Never expose this in a public variable. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Public project token from the Revline PostHog project, never a personal API key. |
| `NEXT_PUBLIC_POSTHOG_HOST` | The project's regional ingestion host, such as `https://us.i.posthog.com` or `https://eu.i.posthog.com`. |

Sentry captures Next.js browser, error-boundary, and server request errors once enabled. Performance tracing, session replay, and logs are off. Request bodies, headers, cookies, query parameters, user identity, extra context, and breadcrumbs are excluded. This scaffold does not instrument Convex actions or the media-processing container.

PostHog captures browser page views and page leaves, including client navigation. Text/click autocapture, replay, surveys, feature flags, and duplicate exception capture are off. There is no user identification or person-profile creation. Analytics IDs are stored in memory; URL query strings and fragments are removed from captured URL properties. Custom editing funnels and backend events can be added later.

The SDK modules load only after their enable flag and provider configuration are present. SDK loading failures do not stop the editor.

## Discord and provider webhooks

Set these server-side on the intended Convex deployment:

| Variable | Purpose |
| --- | --- |
| `DISCORD_ALERTS_ENABLED` | Set to `true` only when the channel and signed providers are ready. Defaults to disabled. |
| `DISCORD_WEBHOOK_URL` | An incoming webhook for the chosen Discord channel. This URL is a secret. Only HTTPS `discord.com/api/webhooks/...` destinations are accepted. |
| `DISCORD_CLERK_WEBHOOK_URL`, `DISCORD_STRIPE_WEBHOOK_URL`, `DISCORD_SENTRY_WEBHOOK_URL`, `DISCORD_POSTHOG_WEBHOOK_URL` | Optional per-provider incoming webhooks. Each provider uses its own channel when configured; otherwise it uses `DISCORD_WEBHOOK_URL`. Invalid configured destinations are rejected. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Signing secret for the Clerk webhook endpoint below. |
| `SENTRY_WEBHOOK_SECRET` | Client Secret of a Sentry internal integration that signs webhook bodies. This is not the Sentry DSN or auth token. |
| `POSTHOG_WEBHOOK_SECRET` | A long random shared secret to put in the PostHog destination's Authorization header. |

Use `https://different-gnu-398.convex.site` for production and `https://majestic-alpaca-541.convex.site` for development. Do not connect live providers to development or reuse signing secrets across environments.

| Provider | Path | Configure in the provider |
| --- | --- | --- |
| Clerk | `/clerk/webhook` | Subscribe to `user.created` and `user.deleted`. The handler verifies the signed Svix payload using Clerk's SDK. It only queues notifications; existing JWT-based profile synchronization stays unchanged. |
| Stripe | `/stripe/webhook` | Keep the existing endpoint, signing secret, and billing events. Add selected notification events as needed: checkout completion/async success, subscription lifecycle, invoice paid/payment failed, charge refunded, dispute created. Billing reconciliation runs before optional notification queuing. |
| Sentry | `/sentry/webhook` | Create a Sentry internal integration with the webhook URL and relevant issue/error/alert subscriptions. The handler verifies `sentry-hook-signature` against its Client Secret. A legacy unsigned webhook does not work here. |
| PostHog | `/posthog/webhook` | Create an HTTP Webhook destination with POST, JSON body, and custom `Authorization: Bearer <POSTHOG_WEBHOOK_SECRET>` header. Apply filters for the events worth notifying. |

The PostHog destination body is:

```json
{
  "id": "{event.uuid}",
  "event": "{event.event}"
}
```

An optional `url` may point to a HTTPS `posthog.com` project page. Use the destination editor's event variables; verify the rendered preview contains a real stable event ID, not the literal template. Do not forward every page view to Discord.

Discord messages contain bounded operational metadata such as provider event names and IDs, with mentions disabled. Emails, uploaded media, chat text, raw provider payloads, and raw exception messages are not included. Validated Sentry/PostHog dashboard links have query strings and fragments removed.

Delivery uses an internal Convex outbox, event deduplication, a 10-second timeout, and at most four attempts for network errors, rate limits, and server errors. Other failures are terminal. Finished receipts expire after 30 days. Delivery is at least once: a process interruption after Discord accepts a message can still produce a duplicate. Discord outages do not turn successful Stripe reconciliation into a payment failure. Other unconfigured notification endpoints return 503 so providers can retry after configuration.

## Discord channel routing

Production uses the following private channels in Sonic's server (`1549103943215218689`), under Revline Notifications (`1561825820689960981`):

| Provider | Channel ID | State |
| --- | --- | --- |
| Clerk | `1561825875249340516` | Signup/deletion alerts active |
| Stripe | `1561826018660978783` | Billing alerts active |
| Sentry | `1561826076794159185` | Discord delivery ready; provider configuration pending |
| PostHog | `1561826134726025296` | Discord delivery ready; provider configuration pending |

Each webhook uses the service's official website icon and its configured display name. The previous `revline-notifications` channel (`1556933361660989440`) was moved into this category and retains its history. No older channels were deleted. Dedicated webhook URLs are stored only on production; development has no production Discord credentials.

## Production status and remaining activation

- The Clerk endpoint now targets `https://different-gnu-398.convex.site/clerk/webhook`, replacing the old backend URL. Its existing signing secret and event subscriptions were preserved. A signed ignored event returned 200; an invalid signature returned 400.
- Stripe's current production billing endpoint remains `https://different-gnu-398.convex.site/stripe/webhook`. Notification delivery is optional and runs after billing reconciliation. An unsigned request was rejected.
- A clearly labeled connection test was delivered to the original channel on October 19, 2026. After splitting the channels on October 20, all four provider routes recorded `sent` on their first attempt. Clerk delivery was also verified in the Discord UI. These tests do not simulate actual signups, payments, or provider errors.
- The old Stripe endpoint on `proficient-chicken-697` is still enabled. It must be reviewed before retirement; do not disable billing reconciliation solely to remove duplicate notifications.
- Sentry and PostHog provider event integrations and frontend telemetry remain pending. Configure the intended projects, signed integration/shared secret, and filtered events before enabling them. Provider channel creation alone does not activate these integrations.

Verify each provider with its dashboard test and confirm the expected channel receives the alert. Replay a signed event to confirm deduplication. Keep production secrets separate from development and never commit webhook URLs.

## Sign-in recovery

The sign-in form shows a recovery message if Clerk initialization or an authentication request remains pending for 20 seconds. The callback page shows the same message after 20 seconds. A completed attempt or new attempt removes/resets the timer. Users can reload explicitly; the app does not clear storage, retry authentication, or send Discord diagnostics. The notice detects a delay, not the underlying browser or session failure.

## Local hydration recovery

The reported composer mismatch showed old server HTML (`New video` with the previous punctuation) against a new client bundle. The label in source is static. Restarting `npm run dev` with a fresh generated `.next/dev` cache restored matching output; no hydration suppression was added. Reload an already-open stale local tab once after restarting.

References: [Sentry Next.js setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/), [PostHog Next.js setup](https://posthog.com/docs/libraries/next-js), [Clerk webhooks](https://clerk.com/docs/guides/development/webhooks/overview).

## Where assistant runs spend their time

Every in-app turn and every MCP task records one row in `assistantRunTimings` (`convex/runTimings.ts`): for each model call and tool call, its name, start, duration and token counts, and for an in-app tool call whether it failed (MCP rows carry no failure flag). A tool call also stores a short hash of its arguments so an identical repeat can be counted. No prompt, argument, result or owner is stored, and rows expire after 30 days.

```sh
npm run incidents:speed -- --env prod --from 2026-11-01 --to 2026-11-11   # slowest tools, repeated calls, median run per lane
npm run incidents:speed -- --env dev --runs                                # adds one step table per run
npm run incidents:speed -- --env isolated --json                           # this worktree's isolated backend
```

"other" in the lane table is wall time outside model calls and tool calls: round trips between steps, queueing and saves (for MCP runs it is the external agent's own thinking). Not built yet: filing a run far slower than its lane's norm as a slow-run incident.
