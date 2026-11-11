# Instagram posting: setup checklist

What the founder does once so Revline users can connect Instagram and post Reels. The code is in
`lib/posting/platforms/instagram/`; it needs only the two environment variables in step 5.

Everything here was read from Meta's documentation on 2026-11-10. The adapter has not yet made a real call.

## The route, and why

Meta documents three ways to use the Instagram API ([overview](https://developers.facebook.com/docs/instagram-platform/overview)):

| | Instagram Login (chosen) | Facebook Login | Unified Login |
|---|---|---|---|
| Facebook Page needed | No | Yes, linked to the account | No |
| Meta business portfolio needed by each user | No | Depends | Yes |
| Token | Instagram user token, 60 days, refreshable | Facebook user or Page token | System-user token owned by the user's business |
| Publishing and insights | Yes | Yes | Yes |

Revline uses **Instagram API with Instagram Login**. A creator signs in with Instagram and nothing else; the other
two routes make each user first own a Facebook Page or a business portfolio, which most solo creators do not have.

Trade-off to know: Meta calls Unified Login "the recommended setup for new integrations" and says new API features
are released only there ([Unified Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login)).
Instagram Login is not marked deprecated. It also cannot do hashtag search, product tagging or partnership ads,
none of which posting needs. An app uses one login type, not both
([App Review](https://developers.facebook.com/docs/instagram-platform/app-review)).

## 1. Create the Meta app

Guide: [Create an Instagram app](https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app)

- [ ] At [developers.facebook.com/apps](https://developers.facebook.com/apps), create an app: use case **Other**, type **Business**.
- [ ] Connect the app to Revline's business portfolio (App settings > Basic > Verification). Needed before the app can go live.
- [ ] Add the **Instagram** product and click **Set up**. "API setup with Instagram login" is the one to use.
- [ ] Fill in App settings > Basic: privacy policy URL, app icon (1024x1024), category, business email.

## 2. Permissions

Request exactly these three; unneeded permissions are a common reason for rejection
([permissions reference](https://developers.facebook.com/docs/permissions)).

| Permission | What Revline does with it |
|---|---|
| `instagram_business_basic` | Reads the account's ID, username, name and picture; needed to refresh the token |
| `instagram_business_content_publish` | Posts the Reel |
| `instagram_business_manage_insights` | Reads views, likes, comments and shares of the posts Revline made ([insights](https://developers.facebook.com/docs/instagram-platform/insights)) |

Two things Meta's pages disagree on; check them in the App Dashboard:
- The App Review page spells the publish permission `instagram_business_content_publishing`. The permissions
  reference and the login guide say `instagram_business_content_publish`, which is what the code requests.
- `instagram_business_manage_insights` is on the insights pages but missing from the login guide's scope list. If the
  dashboard does not offer it, remove it from `SCOPES` in `lib/posting/platforms/instagram/index.ts`; stats then
  show likes and comments only, without views and shares.

## 3. Redirect URI

Guide: [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)

- [ ] In the Instagram product, under **Set up Instagram business login** > **Business login settings**, add the OAuth redirect URI:

  ```
  https://<REVLINE_APP_DOMAIN>/<POSTING_CALLBACK_PATH>
  ```

  `<POSTING_CALLBACK_PATH>` is the callback route of the posting base (`convex/posting`); fill it in when that lands.
  It must match what the app sends character for character. Add one line per environment (production, development).
- [ ] Add the **Deauthorize callback URL** and **Data deletion request URL** on the same screen (Meta requires both fields).

## 4. Test before review

Guide: [App modes](https://developers.facebook.com/docs/development/build-and-test/app-modes)

A new app starts in **Development mode**: everything works, but only for Instagram accounts that have a role on the app.

- [ ] App roles > Roles: add your own Instagram account as a tester and accept the invite from that account
      ([step 7 of the create-app guide](https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app)).
      The account must be public and professional.
- [ ] Connect it in Revline and post one Reel. This is the first real run of the adapter, and it also produces the
      "one successful API call per permission" that App Review requires within 30 days of submitting.
- [ ] Open the post's stats in Revline once, so the insights permission is exercised too.

Do not switch to Live mode before review passes; Meta warns it can break the app for role users.

## 5. Environment variables

Set on the server (Convex deployment), separately for development and production:

| Variable | Value |
|---|---|
| `INSTAGRAM_CLIENT_ID` | **Instagram app ID** |
| `INSTAGRAM_CLIENT_SECRET` | **Instagram app secret** |

The login guide names these as the `client_id` and `client_secret` of the Instagram login, so use the Instagram app
ID and secret from the Instagram product's setup screen, not the Meta app ID and secret from App settings > Basic.
(The docs do not say where on the screen they sit; if sign-in fails with "Invalid platform app", the wrong pair was
used.) With both unset, Instagram shows as "coming soon".

## 6. Business verification

Guide: [Business verification](https://developers.facebook.com/docs/development/release/business-verification)

- [ ] Verify Revline's business portfolio in Meta Business Manager, done by an admin of that portfolio.

Required for Advanced Access. Until it is done, accounts without a role on the app cannot grant permissions.

## 7. App Review

Guides: [App Review for Instagram](https://developers.facebook.com/docs/instagram-platform/app-review),
[submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)

Revline serves accounts it does not own, so each of the three permissions needs **Advanced Access**.

- [ ] App purpose: **Clients**.
- [ ] One written description per permission, each in its own words (no copy and paste between them).
- [ ] One screen recording per permission. Missing a recording means that permission is not approved.
      Record at 1080p or better, browser at most 1440 wide, no audio, interface in English, large cursor, captions
      for anything unclear. Each must show the user granting the permission and Revline using it:
  - `instagram_business_basic`: click "Connect Instagram" in Revline, the Instagram consent screen, then the
    connected account's username and picture shown in Revline.
  - `instagram_business_content_publish`: pick a video, write a caption with hashtags, post, then open the Reel on Instagram.
  - `instagram_business_manage_insights`: open that post in Revline and show its views, likes, comments and shares.
- [ ] Step-by-step instructions for the reviewer, with a Revline login they can use. Meta tests with its own
      Instagram accounts; do not hand over personal Instagram credentials.
- [ ] The login button must be visible and follow Meta's brand guidelines.
- [ ] After approval, switch the app to **Live**. Meta says a decision takes about a week.

## Known limits

| Limit | Value | Source |
|---|---|---|
| Account type | Professional only: business or creator. Personal accounts cannot connect | [overview](https://developers.facebook.com/docs/instagram-platform/overview) |
| Posts per account | 50 API posts per rolling 24 hours (one guide page says 100; the adapter reads the live number before each post) | [media_publish](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish), [content_publishing_limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) |
| Uploads per account | 400 per rolling 24 hours; an upload not published within 24 hours expires | [media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) |
| Video file | MP4 or MOV, moov atom at the front, H.264 or HEVC, AAC audio up to 48 kHz, 23-60 fps, up to 25 Mbps | same page, "Reel Specifications" |
| Video size | 3 seconds to 15 minutes, up to 300 MB, up to 1920 pixels wide, 9:16 recommended | same |
| Caption | 2,200 characters, 30 hashtags, 20 @ mentions | same |
| Video address | Instagram downloads the file itself, so the URL must be public at that moment | [content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing) |
| Processing | Check once a minute; Meta suggests it normally finishes within 5 minutes | same |
| Token | 60 days; refreshable once it is 24 hours old and before it expires. An expired token means reconnecting | [refresh](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token) |
| API calls | 4,800 x the account's impressions per 24 hours | [rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) |
| Stats | Can lag up to 48 hours; a new post may show 0 views at first | [media insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights) |

The adapter refuses a video before uploading when it breaks the duration, size, width, shape or caption limits. It
cannot see codec, frame rate or bitrate; Instagram rejects those during processing and the post fails with the reason.

## Notes for the posting base

- The API version is pinned in one constant, `INSTAGRAM_API_VERSION` in `lib/posting/platforms/instagram/api.ts`.
- `publish` always returns `processing`; call `checkPublish` about once a minute until it returns `published` or `failed`.
- While `checkPublish` returns `processing`, keep polling the same job. Only a `failed` result with `retryable: true`
  means "call `publish` again"; that rule is what prevents a double post.
- Call `refresh` at least once every 60 days per account (weekly is fine); it returns the same tokens when the token
  is younger than 24 hours.
- Pass the `code` query parameter from the callback as received; a trailing `#_` is stripped.
- Disconnect: the Instagram API with Instagram Login documents no call that revokes a token or removes the app's
  permissions, so the adapter's `revoke` sends nothing. Revline deletes its copy of the token (which then expires
  unrefreshed within 60 days); the person can also remove Revline in Instagram under Settings > Apps and websites.
- Instagram has no per-post privacy, so the Post dialog offers none for it.
