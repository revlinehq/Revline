# YouTube posting: what the API docs say (read 2026-11-10)

Notes behind `lib/posting/platforms/youtube/`, taken from Google's pages on the date above. Three things
differ from what was commonly true before 2026 and are marked **changed**. Nothing here was exercised with
real credentials; "not confirmed" marks what the pages did not state.

## OAuth
- Web-server flow: authorise at `https://accounts.google.com/o/oauth2/v2/auth`, exchange and refresh at
  `https://oauth2.googleapis.com/token`, revoke at `https://oauth2.googleapis.com/revoke`.
  [web-server](https://developers.google.com/identity/protocols/oauth2/web-server)
- A refresh token is returned only with `access_type=offline`, and for an existing grant only with
  `prompt=consent`. A refresh response carries no new refresh token. The adapter sends both on every connect.
- A refresh token dies when: the user revokes access, it is unused for six months, the app is in *Testing*
  (7 days), or the same Google account gets more than 100 tokens for this client (oldest dropped silently).
  The token endpoint then answers `invalid_grant`.
  [expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- People can untick individual permissions, so the granted `scope` can be narrower than requested; the
  adapter refuses a connection that lacks either scope.
  [oauth2](https://developers.google.com/identity/protocols/oauth2)
- Scopes requested: `youtube.upload` ("Manage your YouTube videos") and `youtube.readonly` ("View your
  YouTube account"). `videos.insert` accepts `youtube.upload`. The list and channel pages name no scope for
  reading; `youtube.readonly` is the narrowest read scope. Whether Google classes them sensitive is shown in
  the console, not on the scope page. [authentication](https://developers.google.com/youtube/v3/guides/authentication)
- Verification: sensitive or restricted scopes need app verification; unverified production apps show a
  warning and stop at 100 new users. [13463073](https://support.google.com/cloud/answer/13463073) ·
  [7454865](https://support.google.com/cloud/answer/7454865)
- Several channels (Brand Accounts): Google's consent screen asks which account or channel to use and the
  token then acts for that one channel; `channels.list?mine=true` returns it. Not confirmed on a current doc
  page (the help article would not load); the adapter adds `prompt=select_account` and reads `items[0]`.

## Upload
- `videos.insert` with `uploadType=resumable`: `POST https://www.googleapis.com/upload/youtube/v3/videos`
  with the metadata as JSON and `X-Upload-Content-Length` / `X-Upload-Content-Type`; the session address
  comes back in `Location`. Then `PUT` the bytes with `Content-Range: bytes a-b/total`; `308` means more is
  expected (its `Range` header says what is stored), `201` is the finished video. Chunks must be multiples
  of 256 KB. `PUT` with `Content-Range: bytes */total` asks how far it got. `500/502/503/504` are resumable;
  `404` means the session expired (its lifetime is not stated).
  [resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- Limits: file up to 256 GB, `video/*` or `application/octet-stream`. Title up to 100 characters,
  description up to 5,000 bytes, neither may contain `<` or `>`.
  [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) ·
  [video resource](https://developers.google.com/youtube/v3/docs/videos)
- Settable on insert: `status.privacyStatus` (defaults to `public` when omitted),
  `status.selfDeclaredMadeForKids`, `status.containsSyntheticMedia` (the altered/AI content disclosure,
  added 30 Oct 2024), `notifySubscribers` (default true).
- Shorts: no API flag. A square or vertical video up to three minutes is sorted into Shorts
  automatically; wider or longer stays a normal video. `#Shorts` is not mentioned as required, and the
  adapter adds nothing to the user's text. [15424877](https://support.google.com/youtube/answer/15424877) ·
  [10059070](https://support.google.com/youtube/answer/10059070)
- After the upload, `status.uploadStatus` goes `uploaded` → `processed`, or `failed` / `rejected` with a
  reason. The adapter reports "published" only at `processed`.
- **Changed, 2 Nov 2026:** "Videos uploaded through the videos/insert method from unverified API projects
  are no longer restricted to private viewing mode." Before that (since 28 July 2020) they were locked
  private until the project passed the compliance audit.
  [revision history](https://developers.google.com/youtube/v3/revision_history)

## Quota
- **Changed, 1 Jun 2026:** uploads have their own bucket: **100 `videos.insert` calls a day**, 1 unit each.
  (Until Dec 2025 an upload cost about 1,600 of the shared 10,000 units, so about 6 a day.) Everything else
  shares 10,000 units a day; `videos.list` and `channels.list` cost 1. Invalid requests still cost a unit.
  Resets at midnight Pacific Time. Whether chunk requests are counted is not stated.
  [quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- More quota requires the compliance audit, requested through the
  [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form).
  [guide](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- `uploadLimitExceeded` is the channel's own upload limit; the docs give no number.

## Stats
- `videos.list?part=statistics&id=…` (1 unit): `viewCount`, `likeCount`, `commentCount`, as strings. No
  share count in the Data API. **Changed, 27 Aug 2026:** a view is counted when playback starts.
- `videos.batchGetStats` (3 Jun 2026) reads many videos for 1 unit from its own 10,000-a-day bucket: worth
  using if the base refreshes stats in bulk.

## Policies that touch the product
[Developer Policies](https://developers.google.com/youtube/terms/developer-policies) ·
[Required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- The user must be able to choose public, private or unlisted for each upload.
- User-typed titles and descriptions must not be shortened or added to without consent. The adapter rejects
  an over-long typed title instead of cutting it; it does swap `<` and `>` for full-width look-alikes,
  because YouTube refuses them outright.
- Link YouTube's Terms of Service; revoke the token when a user disconnects and delete their data within
  7 days; refresh or delete stored stats within 30 days.

## Convex limits the upload is built around
[limits](https://docs.convex.dev/production/state/limits) · [actions](https://docs.convex.dev/functions/actions)
- Default runtime action: 64 MiB memory; the actions page says a 10-minute timeout, the limits page says
  30 minutes. The adapter assumes 10.
- So: 8 MiB chunks read from storage with `Range` and sent one at a time (memory stays near one chunk at any
  file size), each request capped at 90 seconds, and no new chunk after 4 minutes in one call, so a call
  ends within about 7 minutes. If the file is not finished, `publish` returns
  `processing` with the session inside `platformJobId` and `checkPublish` carries on from wherever YouTube
  says it got to. A call moves about 1 GB at 5 MB/s, so a Short (tens to a few hundred MB) finishes in the
  first call; larger files take more scheduler ticks, up to YouTube's 256 GB, provided the file link still
  works and the session has not expired.

## What the posting base has to add (the contract cannot carry these)
- **Per-post YouTube settings.** `PublishInput.youtube` (`YouTubePublishOptions`) carries them. The Post
  dialog offers the privacy choice YouTube's policies require (Public, Unlisted, Private); it is stored on
  the post as `visibility` and sent as `privacyStatus`. The dialog starts from the owner's last choice,
  "Public" the first time; a post from the editor, which has no dialog, uses that last choice too.
  Made-for-kids, AI-disclosure and notify-subscribers are not offered yet and keep the adapter's defaults.
- **A file link that outlives the upload.** `platformJobId` stores the original `videoUrl`; `checkPublish`
  cannot be given a fresh one. The link must stay valid for as long as the scheduler may keep ticking, and
  the storage must answer `Range` requests.
- **Room and secrecy for `platformJobId`.** It is a JSON string of 0.5 to 2 KB holding the upload session
  address and the file link. Store it whole and never send it to the browser.
- **Token refresh before each call.** Refresh when `expiresAt` (milliseconds) is less than 10 minutes away,
  and on any `PostingError` with code `unauthorized`, then call again.
- **Retry spacing by code.** `quotaExceeded`: wait for midnight Pacific Time. `uploadLimitExceeded`: wait
  about a day. Both are `retryable`, but retrying sooner only burns quota.
- **Disconnect.** Done: the adapter's `revoke` is called when an account is disconnected or its Revline
  account is deleted, then the stored tokens are deleted (also when Google does not answer).
- **Keep calling `checkPublish`** after the upload: the adapter answers `processing` until YouTube has
  processed the video, and gives up with `failed` one day after the job started.
