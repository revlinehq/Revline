# YouTube posting: setup checklist

What the founder does once so Revline can connect YouTube channels and upload Shorts. The code is in
`lib/posting/platforms/youtube/`; it needs only the two environment variables at the end. The facts behind
each step, with what changed recently, are in [youtube-api-notes.md](youtube-api-notes.md).

1. **Create a Google Cloud project** for Revline posting (one project: quota is counted per project).
   [Console](https://console.cloud.google.com/projectcreate) ·
   [Getting started](https://developers.google.com/youtube/v3/getting-started)
2. **Enable "YouTube Data API v3"** in that project.
   [API library page](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
3. **Configure the consent screen** under Google Auth Platform: *Branding* (app name without the word
   "YouTube", support email, logo, homepage, privacy policy and terms links on a domain verified in Search
   Console), *Audience* = External, *Data Access* = add the two scopes below.
   [Branding](https://support.google.com/cloud/answer/10311615) ·
   [Audience](https://support.google.com/cloud/answer/15549945) ·
   [Scopes and verification](https://support.google.com/cloud/answer/13463073)
   - `https://www.googleapis.com/auth/youtube.upload` (upload)
   - `https://www.googleapis.com/auth/youtube.readonly` (read the channel and the video's status and stats)
4. **Create the OAuth client**: *Clients → Create client → Web application*. Authorised redirect URI:
   `https://<APP_DOMAIN>/<POSTING_CALLBACK_PATH>` (the posting base defines the path; add the local
   `http://localhost:3000/...` one too). It must match exactly, including the trailing slash. The secret is
   shown only once. [Clients page](https://console.developers.google.com/auth/clients) ·
   [Manage OAuth clients](https://support.google.com/cloud/answer/15549257)
5. **Add test users** while the app's publishing status is *Testing*: only listed Google accounts can
   connect, and their refresh tokens expire after 7 days, so every tester reconnects weekly. Fine for
   trying it out, not for customers.
   [Refresh token expiry](https://developers.google.com/identity/protocols/oauth2#expiration)
6. **Publish the app and submit scope verification** before real users: set the status to *In production*
   and submit for verification. Until verified, users see an "unverified app" warning and the app is capped
   at 100 new users. Needs the verified domain, the privacy policy, a written reason for each scope and an
   unlisted demo video showing the whole connect-and-upload flow with the client ID visible in the address
   bar. Google quotes up to 10 days for sensitive scopes; the console shows how each scope is classed.
   [When verification is needed](https://support.google.com/cloud/answer/13463073) ·
   [What to submit](https://support.google.com/cloud/answer/13464321) ·
   [Unverified apps](https://support.google.com/cloud/answer/7454865)
7. **YouTube API compliance audit**. Needed to get more than the default quota, via the
   [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form)
   ([guide](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)). The form wants a
   working upload demo, not screenshots. Uploads from projects that have not passed it were locked to
   private from July 2020; Google's [revision history](https://developers.google.com/youtube/v3/revision_history)
   says that ended on 2 November 2026 and such uploads now keep the chosen privacy. **Check it with the first
   real upload**: if the video comes out private, the audit is still required before launch.
   Revline must also follow the [Developer Policies](https://developers.google.com/youtube/terms/developer-policies):
   link YouTube's Terms of Service, let the user pick public/unlisted/private, revoke access on disconnect,
   and not keep stats older than 30 days without refreshing them.
8. **Quota**. Default per project, per day, resetting at midnight Pacific Time
   ([cost table](https://developers.google.com/youtube/v3/determine_quota_cost)):
   - **100 uploads a day** across all Revline users (uploads have their own bucket, 1 unit each).
   - 10,000 units for everything else; a stats read, a channel read and each "is it processed yet?" check
     cost 1 unit. A post uses a handful of them, so the upload bucket runs out first.
   - More: pass the audit in step 7 and ask for the amount in the same form.
9. **Set the environment variables** on the Convex deployment (development and production separately):
   `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. With both unset YouTube shows as "coming soon".

Nothing here has been run against Google yet: there were no credentials when the adapter was written. The
first connect and upload with a test user is the real check.
