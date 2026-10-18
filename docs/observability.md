# Observability and Discord setup

The integration scaffolds are installed. Account configuration and end-to-end delivery are pending. No new accounts, keys, paid subscriptions, provider destinations, or Discord messages were created as part of the scaffold.

## Frontend hosting

Set these in the intended Vercel environment, then rebuild. Local development uses `.env.local`; production settings must remain separate.

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

## Remaining activation checklist

1. Choose the Revline Sentry and PostHog projects and supply their public DSN/project token and regional host.
2. Choose the Discord server/channel and create its incoming webhook.
3. Configure the signed Clerk endpoint, Sentry internal integration, and filtered PostHog HTTP destination. Keep Stripe's existing billing setup intact.
4. Store the server-only secrets in the correct Convex environment and the frontend variables in Vercel. Enable the Discord alert flag and telemetry flag only when ready, and rebuild the frontend.
5. Run provider dashboard test events and confirm one expected Discord alert for each provider. Replay a signed event to confirm deduplication, then inspect a real browser page view and a controlled error in the corresponding provider dashboard.

Until step 5 is complete, the scaffold is not verified as a live account integration.

## Local hydration recovery

The reported composer mismatch showed old server HTML (`New video` with the previous punctuation) against a new client bundle. The label in source is static. Restarting `npm run dev` with a fresh generated `.next/dev` cache restored matching output; no hydration suppression was added. Reload an already-open stale local tab once after restarting.

References: [Sentry Next.js setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/), [PostHog Next.js setup](https://posthog.com/docs/libraries/next-js), [Clerk webhooks](https://clerk.com/docs/guides/development/webhooks/overview).
