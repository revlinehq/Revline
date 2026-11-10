# TikTok posting: setup

The adapter is `lib/posting/platforms/tiktok/`. It needs two server environment variables and a reviewed TikTok app. Nothing here has been run against TikTok yet: no credentials existed when it was written (docs read 2026-11-10).

## Checklist

1. **Register the app.** [TikTok for Developers](https://developers.tiktok.com/) → Manage apps → create an app for Revline, owned by an organization. The name must not contain "TikTok", and the website must be the real product site with Privacy Policy and Terms links visible without opening a menu ([app review guidelines](https://developers.tiktok.com/doc/app-review-guidelines)).
2. **Add products.** Login Kit, Content Posting API with **Direct Post** switched on ([get started](https://developers.tiktok.com/doc/content-posting-api-get-started)), and the Display API for stats ([video query](https://developers.tiktok.com/doc/tiktok-api-v2-video-query)).
3. **Add scopes:** `user.info.basic`, `video.publish`, `video.list`. Nothing else is requested; `video.upload` (drafts) and `user.info.profile` are not used.
4. **Redirect URI.** Login Kit → Web → add `https://editor.tryrevline.com/<POSTING_CALLBACK_PATH>` (the posting base defines the path). It must be https, static, with no query string or `#`, and match exactly; up to 10 are allowed ([Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web)).
5. **Verify the media domain** so TikTok can pull videos ([media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)). Videos are served by the media Worker, today on `*.workers.dev`, which Revline cannot verify by DNS. Put the Worker on a Revline subdomain (for example `media.tryrevline.com`), point `MEDIA_WORKER_URL` at it, then in the portal's **URL properties** add the domain `tryrevline.com` and add the DNS record it shows. A verified domain covers its subdomains. Until this is done the adapter falls back to uploading the file itself, which works only up to 1 GB and is not what TikTok wants for server-side files.
6. **Set the environment variables** on the Convex deployment: `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` (both from the app page; sandbox has its own pair).
7. **Test in a sandbox first** ([add a sandbox](https://developers.tiktok.com/doc/add-a-sandbox)): create a sandbox, add up to 10 TikTok accounts as target users, set each account to **private**, and use the sandbox key and secret. Posts are visible only to the account ("Only me").
8. **Submit for app review, then the Direct Post audit** ([audit form](https://developers.tiktok.com/application/content-posting-api)). See "The audit" below.

## What an unaudited app can and cannot do

Source: [content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines).

- Can: connect accounts, post, read status. Every post is forced to **Only me** (`SELF_ONLY`).
- Cannot: post publicly, post to an account that is not set to private (`unaudited_client_can_only_post_to_private_accounts`), or serve more than **5 accounts per 24 hours**.
- Private posts get no post id from TikTok, so they have no link and no stats. Stats work only for public posts, so only after the audit.

## The audit

- Demo video (at least one, up to 5, 50 MB each) recorded from the sandbox, showing the whole flow in Revline's real UI on the same domain as the registered website: connect, the post screen, posting, the result.
- The post screen must follow TikTok's required UX, all of it visible in the video:
  - the creator's nickname, from the creator-info query made when the screen opens;
  - a "who can view" dropdown listing only that account's options, with **no default**;
  - Allow comment / duet / stitch checkboxes, **unchecked by default**, greyed out when the account has them off;
  - a commercial content toggle, off by default; when on, "Your brand" and/or "Branded content" must be picked, the matching label notice shown, and branded content cannot be "Only me";
  - the consent line "By posting, you agree to TikTok's Music Usage Confirmation" (plus the Branded Content Policy when branded) before the publish button;
  - a preview of the video, an editable caption, and a note that processing can take a few minutes.
- No Revline logo, watermark, link or promotional text in the posted video or added to the caption.
- The app must be a live product, not a test or internal tool. The form asks for expected usage; TikTok sets the app's daily active-creator cap from it.

## Known limits

| Limit | Value | Source |
| --- | --- | --- |
| Posts per account | about 15 per 24 hours, shared by all apps | [guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines) |
| Accounts per app | 5 per 24 hours unaudited; a cap set at audit afterwards | same |
| Start a post | 6 requests a minute per account | [direct post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post) |
| Creator info / status | 20 / 30 requests a minute per account | [creator info](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info), [status](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status) |
| User info, video query | 600 a minute | [rate limits](https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit) |
| Video | MP4 (H.264 recommended), WebM or MOV; 360–4096 px each side; 23–60 fps; up to 4 GB; 10 minutes at most, and each account's own limit (3, 5 or 10 minutes) from creator info | [media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide) |
| Caption | 2200 UTF-16 units | direct post |
| Tokens | access 2 hours, refresh 180 days; every refresh returns a **new** refresh token and kills the old one. One page's example shows 24 hours / 365 days, so the adapter uses the returned `expires_in` | [token management](https://developers.tiktok.com/doc/oauth-user-access-token-management) |
| Pulled URL | https, no redirect, reachable for up to 1 hour | media transfer guide |

## How the adapter behaves

- **Direct Post, not inbox.** Inbox upload (`video.upload`) only drops a draft the user must finish in the TikTok app, capped at 5 pending a day; a scheduler needs the post to go out.
- **Pull from URL, with file upload as fallback.** TikTok tells apps to pull files that already sit on a server, and pulling costs Revline no memory or action time. If TikTok answers `url_ownership_unverified` (step 5 not done), the adapter copies the file in 10 MB chunks instead, up to 1 GB.
- **No PKCE.** TikTok's web login takes no `code_challenge`; only desktop and mobile apps use PKCE (hex-encoded SHA-256 there). `state` is the CSRF check.
- `publish` always returns `processing`. `checkPublish` returns `published` with the post id once TikTok gives one. For a private post TikTok never gives one, so it returns `platformPostId: "no-id:<job>"` with the profile link; a public post waits up to 10 minutes for moderation before doing the same. `postStats` on a `no-id:` id asks TikTok again for the real id, so stats start working once the post is public.
- Without user-chosen settings a post goes out as **Only me** with comments, duet and stitch off, which is the only choice valid for every account and for an unaudited app.

## What the posting base must add

1. **Per-post TikTok settings.** `PublishInput` has no place for privacy, comment/duet/stitch, commercial disclosure or the AI label. The adapter reads them from an optional `tiktok` field (`TikTokPostSettings`, exported from the adapter); the contract needs that field or a general per-platform options field, and the scheduler must store and pass it.
2. **The post screen.** Call the exported `creatorInfo(tokens)` when it opens and build the UX listed under "The audit". Public posting is impossible without it.
3. **Token upkeep.** Save the tokens returned by `refresh` every time (the refresh token rotates). `expiresAt` is epoch milliseconds. `AccountTokens` cannot carry the refresh token's own expiry (180 days): treat `invalid_grant` on refresh as "reconnect needed". On a `PostingError` with code `access_token_invalid`, refresh and retry once.
4. **Callback.** Compare `state`, handle the `error` / `error_description` parameters (the user declined), and pass the URL-decoded `code`.
5. **Video link.** `videoUrl` must not redirect and must stay valid for an hour, so use the 7-day media read link, not the 15-minute download link.
6. **Polling.** A thrown `PostingError` from `checkPublish` means the status could not be read (poll again if `retryable`); a returned `failed` means the post is dead and `retryable` says whether publishing again may work. Poll every 15–30 seconds; keep the opaque `platformJobId` unchanged. Stats for an id starting with `no-id:` fail with code `post_not_public` until the post is public.
7. **No blind retry of a post start.** If TikTok does not answer the request that starts a post, the adapter reports `publish_unconfirmed`, not retryable, because a retry could post the video twice. Show it as "check TikTok before posting again".
8. **Caps.** The daily post cap and the app's account cap are reported as not retryable; if the scheduler should try again the next day, key that on the codes `spam_risk_too_many_posts` and `reached_active_user_cap`.
9. **Disconnect.** The contract has no revoke call; TikTok has one ([revoke](https://developers.tiktok.com/doc/oauth-revoke-a-user-access-token)).
10. **If TikTok ever requires PKCE on web**, `exchangeCode` would need the `state` (or a verifier) passed in; the current contract cannot supply one.

## Not verified

No real call was made. Unconfirmed against the live API: the whole OAuth round trip, whether Direct Post works in sandbox, how a URL-prefix (rather than domain) verification is done, pulling a signed `…/read?token=…` link, the chunk upload, the exact JSON of the post id field, and whether `creator_username` is always present for the connect screen.
