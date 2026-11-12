# Posting through Post Bridge

Revline posts through [Post Bridge](https://www.post-bridge.com). Post Bridge holds the platform tokens; a user connects an account through one of its connect links, so Revline needs no approved YouTube, TikTok or Instagram app of its own and stores no platform token. Reference: <https://api.post-bridge.com/reference> (OpenAPI at `/openapi.json`).

## Settings (Convex environment)

| Setting | Meaning |
| --- | --- |
| `POSTBRIDGE_API_KEY` | Revline's Post Bridge API key (`pb_live_…`). Server only: no function returns it and nothing logs it. |
| `APP_ORIGIN` | Connect links send the user back to `<APP_ORIGIN>/accounts`. |

## Without the key

While `POSTBRIDGE_API_KEY` is not set, nothing crashes and nothing half-works; every surface gives the same line, "Posting isn't set up yet: no Post Bridge key provided." (`POSTING_NOT_SET_UP` in `lib/posting/limits.ts`):

- Connected accounts shows the line and its Connect and Reconnect buttons are off. Disconnect still works; the removal at Post Bridge is asked again every six hours until the key exists.
- The Post dialog and the editor's Post button list the accounts but none can be picked, with the line beside the button. The server refuses a new post, a retry and a connect link with the same line.
- The assistant and MCP tools return it as a refusal (`postVideo`, `schedulePost`), `listConnectedAccounts` marks every account `canPost: false` with it, and `getPost`/`listPosts` give it as the reason on a post that waits.
- A post already queued stays queued: it is not claimed, failed or deleted, reads "Waiting" on Posts with the line, and goes out at the next scheduler tick after the key is set. Cancel and reschedule keep working.
- Stats show the numbers already stored; nothing is refreshed. Tokens of accounts connected before Post Bridge are kept.

Setting the key (`npx convex env set POSTBRIDGE_API_KEY …`) turns everything on with no deploy.

## Accounts connected before Post Bridge

Accounts connected through Revline's own platform apps cannot be moved over. They read "Reconnect needed" with one message, and their posts stay in the history. Reconnecting the same handle keeps the same row. Their stored tokens are deleted by a daily job (`posting.retireLegacyAccounts`), which does nothing until `POSTBRIDGE_API_KEY` is set; a post that was still waiting for one fails at its time with "Reconnect @handle, then retry". Revline's old grant stays listed in the person's Google, TikTok or Instagram settings until they remove it there; Revline holds nothing that could use it.

Post Bridge needs no callback from Revline: it has no webhooks, and the platforms' own callbacks (Meta's deauthorize and data deletion) go to Post Bridge's apps.

## How it works

- **Connect.** `postingActions.startConnect` asks Post Bridge for a connect link (`POST /v1/social-accounts/connect-link`) tagged with the user's `external_ref`: a random reference stored in `postingConnectRefs`, never the user id. The link lasts 15 minutes. The user approves on the platform's consent screen and lands on `/accounts`.
- **Sync.** Post Bridge has no webhooks. `postingActions.syncAccounts` runs when the user returns and when Connected accounts opens (at most once a minute per user, since every user shares the one API key): it lists the accounts under the user's reference (`GET /v1/social-accounts?external_ref=`) and stores them, with Revline's own copy of each picture. Nothing in the return address is trusted.
- **Scheduling.** Revline's scheduler stays the only one. A post is created at Post Bridge at send time, without `scheduled_at`, so cancel, reschedule and "edited after scheduling" are unchanged and nothing is scheduled twice.
- **Publish.** The export is piped from Revline's storage to Post Bridge's signed upload address (`POST /v1/media/create-upload-url`, then `PUT`), never base64. A file over 500 MB, or an upload that fails, is handed over as a link (`media_urls`). Then `POST /v1/posts` for the one account.
- **Status.** `GET /v1/post-results?post_id=` is polled by the existing checks (15 s, 45 s, 2 min, 4 min, then every 5 minutes for a day): success gives the platform link, failure gives the platform's reason.
- **Stats.** One `POST /v1/analytics/sync` per run, then `GET /v1/analytics` for 50 posts per request. A post is read hourly for two days after it goes out, then daily, and not at all after 30 days.
- **Disconnect.** `DELETE /v1/social-accounts/{id}` ends the connection and frees the slot. A removal that fails is retried four times over about seven hours, then logged; until it succeeds the account still counts on the Post Bridge plan.

## Keeping users apart

Every user's accounts sit in Revline's single Post Bridge workspace, and the API key reaches all of them. The mapping in `postingAccounts` (`provider`, `providerAccountId`, `ownerId`) is the only thing that says whose account an id is:

- an account is stored for a user only when Post Bridge reports that user's reference on it, even if the listing returns more;
- a Post Bridge account id is only read from a row whose owner was checked; no id from a client reaches Post Bridge;
- before a post is created the account is read again and must still carry the owner's reference and platform;
- an outcome is only read for the post's own account id.

## Account cap

Post Bridge bills per connected account (15 on the $39 plan, 99 on the $99 plan, then $1 each). `lib/posting/account-caps.ts` sets how many a Revline user may connect per platform: 3 on Pro (trial and complimentary access included) and on Ultra, 0 without a plan. The server enforces it twice: no link is made at the cap, and an account that arrives over the cap is removed at Post Bridge.

## What Post Bridge cannot do

- **YouTube visibility.** There is no privacy field; videos go out public. The Post dialog says so instead of offering a choice, and a post asking for Unlisted or Private is refused rather than sent public.
- **TikTok privacy.** `privacy_status` is `public` or `private` (Only me). Friends and Followers are not available, and TikTok's per-account options (allowed privacy levels, switched-off interactions, maximum length) are not passed on.
- **Limits.** The reference states one limit: 10 requests a second per key. It gives no video size or length per platform, so Revline keeps checking the platforms' own (`lib/posting/precheck.ts`).

## Assumptions to confirm with Post Bridge

- A connect link opened for an account that is already connected reconnects it under the same id.
- When the same platform account is connected under a second reference, Post Bridge reports it under the newer one only. Revline then ends the older user's connection.
- `media_urls` accepts a signed storage link.
- The 500 MB upload limit (stated to us, not in the reference).
