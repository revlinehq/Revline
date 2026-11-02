# Revline for iOS

Native SwiftUI client, iOS 17+, iPhone and iPad. Bundle identifier placeholder: `com.revline.app`.

The app uses the official ConvexMobile client and the existing Clerk instance. Project management, agent turns, message streams, uploads, media tasks, and exports call the same Convex functions as the web editor. No Next `/api` route is used. The only embedded web surface is the existing renderer, exposed at `/mobile/player/[projectId]`.

## Run

Requirements: Xcode 26.1+, Swift 6.2, XcodeGen (`brew install xcodegen`), Node 22 for the web player.

1. Copy `Config/Local.example.xcconfig` to `Config/Debug.local.xcconfig`. Fill in the existing development Clerk publishable key and Frontend API hostname. This file is ignored by Git. Clerk secrets never belong in the app.
2. Copy `Config/Secrets.example.xcconfig` to `Config/Secrets.xcconfig`. Fill in the Superwall public API key and the two App Store product identifiers when provisioned. Both Debug and Release read this ignored file.
3. In the repository root, provision the existing development `.env.local`, then run `npm ci` and `PORT=3002 npm run dev`. Wait for both `[web]` and `[worker]` readiness. Do not start or replace the main checkout's server on port 3001.
4. Run `xcodegen generate --spec mobile/project.yml` from the repository root. The generated `mobile/Revline.xcodeproj` and package resolution are checked in, so XcodeGen is only needed after changing the specification or adding files.
5. Open `mobile/Revline.xcodeproj`, choose Revline and an iOS Simulator, and Run. The user completes sign-in in the app.

Command-line Simulator build with ad hoc signing for Clerk Keychain access from the repository root:

```sh
xcodebuild -project mobile/Revline.xcodeproj -scheme Revline \
  -configuration Debug -destination 'platform=iOS Simulator,name=Revline iPhone' \
  -derivedDataPath mobile/.build/DerivedData \
  -clonedSourcePackagesDirPath mobile/.build/SourcePackages \
  -jobs 1 \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO \
  ONLY_ACTIVE_ARCH=YES build
```

There are no test targets, test files, mock services, or sample backend records. Verify using `npm run typecheck`, `npm run build`, `xcodebuild`, and the running app. Build products, downloaded packages, local configuration, and screenshots are ignored. Remove only `mobile/.build/DerivedData` when finished to reclaim build space. The installed Simulator app continues to work.

Clerk is pinned to **1.5.8** because 1.5.9 through 1.6.2 use `weak let` in `ClerkRuntime`, which does not compile with this Mac's Swift 6.2.1. Convex 0.8.2 documents its Rust client as thread-safe but has no Sendable declaration; `ConvexConcurrency.swift` supplies that compatibility conformance. Reassess both when upgrading the packages. SDK source is not patched. A build phase adjusts the bundled English authentication copy to Revline’s punctuation style.

## Environments

| Build | Convex | Web renderer | Clerk |
| --- | --- | --- | --- |
| Debug | `https://majestic-alpaca-541.convex.cloud` | `http://localhost:3002` | Existing dev instance via `Debug.local.xcconfig` |
| Release | `https://different-gnu-398.convex.cloud` | `https://tryrevline.com` | Existing production instance via `Release.local.xcconfig`, `pk_live_` only |

URLs come from xcconfig and Info.plist. Release validates the exact production backend and website and refuses a test Clerk key. A missing configuration produces a setup screen instead of silently using development. Local networking is allowed for the Simulator renderer; remote services use HTTPS. Override the Debug web URL with this Mac's LAN address for a physical device. Do not point a production build at the development backend.

The `/mobile/player` route must be present on the configured web server. It is available in this worktree on port 3002. The untouched 3001 checkout and the hosted production site will not gain this route until their source is updated through the normal release process. No deployment is required to use the new native screens against the existing development API. New Apple billing functions require a later authorized Convex deployment.

## Authentication and account deletion

ClerkKitUI presents the instance's enabled providers and recovery flows. The welcome screen also invokes Clerk's native `signInWithApple`. Convex receives `session.getToken(template: "convex")`, matching the web provider, and short-lived tokens refresh in memory. The player receives a token through a main-frame-only WKWebView bridge. Tokens are never put in URLs, cookies, local storage, analytics, or committed files. Main-frame navigation is restricted to the configured player URL.

In Clerk Dashboard for each instance:

- Keep Native API enabled and register the iOS application with the final App ID Prefix and bundle identifier.
- Enable Apple alongside Google and email, configure the Apple provider, and register the native app. The current development instance has Native API, Google, email codes, and self-deletion enabled, but Apple is not enabled.
- Keep self-service account deletion enabled. Account > Manage account opens Clerk's native profile, including the Delete account flow and any required re-verification. It deletes the same Clerk user used by web. The existing web profile has no separate application-level account-deletion API; audit retention and cleanup of owned Convex/media records before submission.
- Configure the Associated Domains entitlement as `webcredentials:<Clerk Frontend API hostname>`. Sign in with Apple capability and the `com.revline.app` OAuth callback scheme are included.

## App Store subscriptions

Convex `billing.status` is authoritative. Active Stripe subscribers and complimentary members bypass the paywall and are marked active in Superwall. Apple subscriptions grant the same access and Ultra limits on both platforms. Native UI contains no Stripe prices or checkout links. Purchase, restore, and transaction-update handling use StoreKit 2 and send Apple's original signed transaction to Convex. Transactions finish only after server verification succeeds.

Clerk subjects are strings such as `user_...`, while Apple's `appAccountToken` must be a UUID. The authenticated `appleBilling.accountToken` mutation creates a stable UUID-to-Clerk-user mapping. Superwall is identified by the actual Clerk subject; the custom purchase controller supplies the mapped UUID to StoreKit. Restoring a purchase cannot transfer it between Revline accounts.

In App Store Connect, create one auto-renewable subscription group with:

| Product | Suggested identifier | Level |
| --- | --- | --- |
| Revline Pro monthly | `com.revline.app.pro.monthly` | Pro |
| Revline Ultra monthly | `com.revline.app.ultra.monthly` | Higher tier than Pro |

Match the web plans' features and intended monthly pricing in App Store Connect, with localized prices supplied by StoreKit. Configure upgrades and downgrades within this group. Add both products to Superwall, map the `pro` and `ultra` entitlements, and publish a campaign for the **`onboarding_paywall`** placement. Include restore, subscription terms, privacy policy, and Terms of Use in that paywall. Use a calm dark design with neutral surfaces and small brand accents. The paywall design is remotely configured in Superwall and cannot be inspected until a public API key and campaign exist.

## Backend setup, after an authorized deployment

These changes were prepared for the development deployment first. Do not deploy this branch or modify production credentials without explicit authorization. Set each environment independently.

| Convex environment variable | Value |
| --- | --- |
| `APPLE_BUNDLE_ID` | Final bundle identifier, initially `com.revline.app` |
| `APPLE_ENVIRONMENT` | `Sandbox` in dev; `Production` in production |
| `APPLE_SANDBOX_REVIEW_USER_IDS` | Optional comma-separated Clerk subjects allowed Sandbox entitlements on the production backend for TestFlight/App Review only |
| `APPLE_APP_ID` | Numeric App Store Connect application ID, required for Production |
| `APPLE_PRO_PRODUCT_ID` | Pro product identifier above |
| `APPLE_ULTRA_PRODUCT_ID` | Ultra product identifier above |
| `SUPERWALL_WEBHOOK_SECRET` | Svix `whsec_...` signing secret from the Superwall webhook |
| `SUPERWALL_PROJECT_ID` | Superwall V2 webhook `project_id` |
| `SUPERWALL_APPLE_NOTIFICATIONS_URL` | Secret per-app forwarding URL from Superwall Settings > Revenue Tracking > Through your server |

StoreKit 2 JWS verification does not require an App Store shared secret, private API key, issuer ID, or key ID. No such credentials are embedded in this client. Verification uses Apple's official server library, bundled public Apple Root CA G2/G3 trust anchors, online certificate revocation checks, bundle identifier, environment, and the production App Store app ID.

Webhook URLs, using the deployment's **`.convex.site`** domain:

| Environment | App Store Server Notifications V2 | Superwall Webhooks V2 |
| --- | --- | --- |
| Development | `https://majestic-alpaca-541.convex.site/app-store/notifications` | `https://majestic-alpaca-541.convex.site/superwall/webhook` |
| Production | `https://different-gnu-398.convex.site/app-store/notifications` | `https://different-gnu-398.convex.site/superwall/webhook` |

Configure Apple V2 notifications in App Store Connect, pointing at Convex. Apple supports one destination per environment, so configure `SUPERWALL_APPLE_NOTIFICATIONS_URL` to forward the unmodified, verified payload to Superwall. Forwarding is queued atomically with the entitlement write and retried separately, so a Superwall outage cannot block Apple's entitlement update. In Superwall, configure the App Store Connect and In-App Purchase keys in its dashboard to enable revenue tracking. Those keys stay with Superwall and are not needed by the Convex JWS verifier. Superwall must use **Webhooks V2** and send initial purchase, renewal, cancellation, uncancellation, expiration, billing issue, refund, product change, and subscription extension events. The endpoint verifies raw-body Svix signatures and timestamps before parsing, validates project, store, bundle, environment and account ownership, and ignores non-App-Store payments. Stripe's existing webhook path is unchanged.

Both sources upsert the same `appleEntitlements` row by transaction ID and record event receipts. Notification timestamps and Superwall sequence numbers reject stale state. Cancellation retains paid access until expiry, refunds revoke access, and a replayed active receipt cannot undo a refund. Only a verified Apple refund reversal can clear revocation. A newer transaction caps the older transaction's access at its purchase time, and Apple's `isUpgraded` flag also retires the old purchase. Delayed receipts cannot revive a superseded plan after an upgrade or refund. Expiry is checked when querying access; no client clock grants entitlement. Failed processing returns a retryable response rather than acknowledging a lost update. Web billing shows **Manage in App Store** and blocks new Stripe checkout and upgrade actions for active Apple subscriptions. `needsPayment` now describes lack of access, while `paymentIssue` preserves existing Stripe recovery behavior in the web UI.

## App Store submission and remaining manual work

- Select a development team, replace the placeholder bundle ID consistently in Xcode, Clerk, Convex and App Store Connect, and configure distribution signing and provisioning.
- Supply a final App Store icon and launch branding. Product onboarding uses the repository's actual racing edit, clipping workspace, and Revline motion-film frames. Audit rights for demo footage and creator likenesses before distributing those visuals publicly.
- Enable and validate Sign in with Apple in Clerk, including credential revocation behavior when deleting an account.
- Add production local configuration, Superwall key, products and a published paywall campaign. Use StoreKit sandbox accounts for real purchase and restore verification. Sandbox transactions on a Production-configured backend are accepted only for the Clerk subjects explicitly listed in `APPLE_SANDBOX_REVIEW_USER_IDS`. Configure dedicated review/TestFlight accounts there or grant them complimentary access. Never switch the production backend to development for review.
- Deploy the renderer route and the prepared Convex billing code through the normal authorized workflow. Verify both webhook deliveries with real sandbox transactions, including renewal, cancellation, refund, expiry and restore. No real purchase or destructive account deletion should be performed by an agent.
- Complete privacy policy, Terms of Use, support URLs, age rating, export compliance, App Store privacy labels and SDK data-collection audit. The app supplies a UserDefaults required-reason manifest, and the SDKs include their own manifests. PhotosPicker uses system-selected access; saving an export requests add-only access with the supplied purpose string. No camera or microphone access is requested.
- Add App Review notes covering native editing, existing web memberships, Apple subscriptions, in-app account deletion, the web-only renderer, and a review account with entitlement access.

## Verification from this session

On 2026-11-01, `npm run typecheck`, `npm run build`, signed Debug and optimized Release Simulator builds passed with Xcode 26.1.1 and Swift 6.2.1. The app ran on the iPhone 17 and iPad Pro 11-inch Simulators with iOS 26.1. Onboarding, welcome, and the live Clerk sign-in screen were visually inspected. iPad onboarding and welcome were inspected in landscape, and onboarding in portrait. The onboarding column is capped at 600 points. The Release bundle's URLs were checked for the production deployment and website, and the app was launched on iPad to verify it safely displays Setup required without production Clerk configuration. Use `-jobs 1` on this 8 GB Mac to avoid parallel SDK compilation exhausting memory.

The initial unsigned Keychain failure was fixed by adding the application/keychain entitlements and using Simulator ad hoc signing. The native sign-in screen is connected to the existing development Clerk instance and is waiting for the user to sign in. In Simulator, select **Revline iPhone**, then complete the email or Google flow in the open Revline sign-in sheet using your existing account. No credentials were entered by the agent.

Local screenshots, excluded from Git:

- `Screenshots/01-onboarding-edit.png`
- `Screenshots/02-onboarding-clipping.png`
- `Screenshots/03-onboarding-motion.png`
- `Screenshots/04-welcome.png`
- `Screenshots/05-clerk-sign-in.png`
- `Screenshots/06-ipad-onboarding.png`
- `Screenshots/07-release-setup.png`
- `Screenshots/08-ipad-landscape.png`
- `Screenshots/09-ipad-welcome.png`

The authenticated project, chat, media, timeline, export, and account flows still need runtime inspection after the user completes sign-in. New Apple/Superwall billing functions have not been deployed, and purchase/restore/webhook verification requires the App Store products, dashboard configuration, backend environment variables, and a real Sandbox transaction. No account was deleted and no purchase was made. The renderer and development worker remain running on port 3002; the main checkout's port 3001 server was not changed or restarted.
