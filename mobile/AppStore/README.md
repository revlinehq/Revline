# Revline for App Store review

This folder contains a draft listing, product configuration, review checklist, and production screenshots when they are available. Nothing here submits the app for review. The legal documents and listing need the owner's final review.

## One-time account setup

1. Accept any pending Apple Developer Program License Agreement in the developer account and the Paid Apps agreement in App Store Connect → Business. The agent does not accept legal agreements.
2. Create the app record in App Store Connect → My Apps → + → New App. Apple’s REST API cannot create it. Use iOS, Revline, English (U.S.), SKU `revline-ios`, and the identifier registered under the paid team. The original `com.revline.app` placeholder was unavailable; this Mac uses the ignored Release override `com.zurahq.revline` under team `Z42PHGH527`.
3. Keep the App Store Connect key at `~/.appstoreconnect/private_keys/AuthKey_LRJSB8ZQWB.p8`. Never put the key in the repo. `~/.appstoreconnect/asc.env` holds `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, `ASC_APP_IDENTIFIER` and `ASC_TEAM_ID`. Key ID `LRJSB8ZQWB` is configured on this Mac. Do not print or commit the file or private key.
4. Confirm the production Clerk native registration matches the Release App ID Prefix and bundle ID, Native API is enabled, Apple is enabled, the callback URL is allowlisted, and `webcredentials:clerk.tryrevline.com` is associated. The publishable key belongs only in ignored `mobile/Config/Release.local.xcconfig`. No Clerk secret belongs in the app.
5. Review the draft `/privacy` and `/terms` documents, identify the legal operator and monitored support address, and publish them through the normal reviewed web release. The listing privacy URL must return a real policy before submission.
6. Configure Superwall's `onboarding_paywall` to offer only `com.revline.app.monthly`, matching `subscription.json`. Its copy must disclose the eligible one-week trial and the price after it, plus Restore, Privacy and Terms. The native StoreKit membership screen is also available. The public SDK key belongs in ignored `mobile/Config/Secrets.xcconfig`; never put administrative keys in the app.

## Local distribution signing

Cloud export initially returned “Cloud signing permission error” and “No profiles for com.zurahq.revline were found.” The authorized API key could create a local Apple Distribution certificate and a matching App Store profile, avoiding cloud signing. Both were installed on this Mac. See [the actual changes](asc-changes.md).

The new signing private key is outside git at `~/.appstoreconnect/signing/revline/distribution.key`; the original App Store Connect `.p8` was not copied. `ASC_DISTRIBUTION_PROFILE` in the local `asc.env` selects the installed profile and manual App Store export. If that variable is absent, fastlane uses automatic signing. Both paths retain API-key authentication and never submit for review.

Local distribution export succeeded and the IPA passed strict signature verification under the Apple Distribution identity. It is at `mobile/.build/AppStoreExport/Revline.ipa` on this Mac. The existing-IPA TestFlight upload was attempted and stopped because the App Store app record is absent. If a future Keychain prompt appears, the owner must enter the Mac login password directly in the system dialog and choose Allow or Always Allow. The agent cannot operate SecurityAgent or enter that password. Do not send it in chat.

On another Mac, an authorized team member must provision an Apple Distribution identity and matching profile securely or use Xcode → Settings → Accounts → Ivan Kolos → Manage Certificates. Do not put signing private keys in this repository. See [Apple’s cloud-managed certificate documentation](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/). A development-signed archive is separate from successful App Store distribution export.

## Commands

Fastlane is installed with Homebrew on this Mac. From the repo:

```sh
set -a
source ~/.appstoreconnect/asc.env
set +a
cd mobile
fastlane ios subscriptions             # read-only plan
fastlane ios subscriptions apply:true  # group, one monthly product, prices and trial
fastlane ios precheck                  # App Store listing checks
fastlane ios metadata                  # draft metadata only
fastlane ios listing                   # draft metadata and reviewed screenshots
fastlane ios archive                   # signed Release archive only
fastlane ios testflight                # archive + upload to TestFlight, no external review submission
ASC_IPA_PATH="$PWD/.build/AppStoreExport/Revline.ipa" fastlane ios upload_testflight # reuse the signed IPA without rebuilding
```

`subscription.json` is the source for $39.00 USD/month in the USA, with Apple's recommended equalized price points in other storefronts and a one-week free introductory offer for eligible new subscribers. The script refuses a substitute base price or conflicting introductory offer. It reuses existing resources by product ID and logs successful writes to the ignored `.build/asc-subscription-changes.jsonl`. It never submits products or the app for review. App Store Connect may still require subscription review information, tax/banking details and agreements before products can be sold.

The app record and product IDs are distinct. A local bundle-ID override does not require changing the configured product ID. Set `ASC_APP_IDENTIFIER` to the identifier actually registered for the Release build.

App Review contact fields can be supplied through `ASC_REVIEW_FIRST_NAME`, `ASC_REVIEW_LAST_NAME`, `ASC_REVIEW_PHONE` and `ASC_REVIEW_EMAIL`. Do not commit personal contact details or demo-account credentials. The owner enters any reviewer login credentials securely in App Store Connect.

Fastlane's API-key precheck cannot inspect in-app purchases, so that lane checks the listing only. The subscription lane separately reads Apple's current product, price, availability and offer resources. Final sandbox purchase and restore checks still require the running app.

## Backend settings

Development functions target **majestic-alpaca-541 only**. Production Release is pinned to **different-gnu-398**, `https://tryrevline.com` and live Clerk. Do not point Release at dev. New functions must be reviewed and deployed to production through the normal approved release before relying on the new server policy, caption-free export or deletion flow there.

Convex environment settings:

- `CLERK_SECRET_KEY`: the matching Clerk instance's backend key, server only, for account deletion.
- `CLERK_WEBHOOK_SIGNING_SECRET`: verified Clerk lifecycle webhook, including `user.deleted` cleanup.
- `APPLE_SIGN_IN_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_PRIVATE_KEY`: server-only Sign in with Apple revocation credentials. These are separate from the App Store Connect upload API key. Apple-linked deletion exchanges a fresh native authorization code, verifies Apple's signed identity matches the Clerk account, and revokes the token before deleting the account.
- `APPLE_BUNDLE_ID`: actual Release identifier (`com.zurahq.revline` on this Mac).
- `APPLE_APP_ID`: numeric App Store app ID, once the owner creates the app record.
- `APPLE_ENVIRONMENT`: `Production` in production, `Sandbox` in development.
- `APPLE_MONTHLY_PRODUCT_ID`: `com.revline.app.monthly`; grants the existing Pro entitlement. Legacy `APPLE_PRO_PRODUCT_ID` / `APPLE_ULTRA_PRODUCT_ID` can remain for older subscribers, but the app offers only the monthly product.
- `APPLE_SANDBOX_REVIEW_USER_IDS`: explicit Clerk user IDs allowed to use Apple's sandbox transactions on the production backend for TestFlight/review. A sandbox purchase must not grant production access to arbitrary accounts.
- `SUPERWALL_WEBHOOK_SECRET`: signature secret for the subscription webhook. Existing Apple JWS verification remains authoritative and neither source can grant client-declared access.

App Store Server Notifications V2: `https://different-gnu-398.convex.site/app-store/notifications`.
Superwall subscription webhook: `https://different-gnu-398.convex.site/superwall/webhook`. Both update the same entitlement records. Do not send production events to dev.

To provision Apple revocation: Apple Developer → Certificates, Identifiers & Profiles → Keys → + → enable Sign in with Apple → Configure → select the primary `com.zurahq.revline` App ID → Register → Download. The owner keeps the downloaded private key outside the repo and sets the three `APPLE_SIGN_IN_*` Convex variables in each intended environment. This key is not embedded in iOS and is not the App Store Connect key `LRJSB8ZQWB`. Native sign-in itself works without this server key; Apple-linked account deletion requires it. Verify revocation with a dedicated disposable Apple-linked account. The app does not expose Clerk profile self-deletion, so deletion uses the versioned server action. That action stops existing web renewals before removing the Clerk user. Separate App Store subscriptions must be cancelled through Apple.

## Screenshots and review

Production screenshots belong in `Screenshots/6.9/` (1320×2868) and `Screenshots/6.5/` (1284×2778 where supported), with numbered names and `Screenshots/index.md`. Capture actual running production UI in the Simulator, with a dedicated demo account and project. Never fabricate a reply or progress state, resize another device's screenshot, or use the owner's real projects. Use `simctl status_bar override` for 9:41, full battery and full signal.

The listing lane copies these images byte-for-byte into an ignored language staging folder for fastlane. It refuses to upload screenshots when none have been captured. It does not submit for review. A final submission requires completing every unresolved item in [review-checklist.md](review-checklist.md), including legal review, a dedicated reviewer account and real production operation.

Sources: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Apple app records](https://developer.apple.com/documentation/appstoreconnectapi/apps), [Clerk native Apple setup](https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple), [fastlane API authentication](https://docs.fastlane.tools/app-store-connect-api/), [deliver](https://docs.fastlane.tools/actions/deliver/).
