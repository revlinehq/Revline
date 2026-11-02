# Revline for iOS

Native SwiftUI client, iOS 17+, iPhone only. Bundle identifier placeholder: `com.revline.app`.

The app uses the official ConvexMobile client and the existing Clerk instance. Project management, agent turns, message streams, uploads, media tasks, and exports call the same Convex functions as the web editor. No Next `/api` route is used. The only embedded web surface is the existing renderer, exposed at `/mobile/player/[projectId]`.

## Run

Requirements: Xcode 26.1+, Swift 6.2, XcodeGen (`brew install xcodegen`), Node 22 for the web player.

1. Copy `Config/Local.example.xcconfig` to `Config/Debug.local.xcconfig`. Fill in the existing development Clerk publishable key and Frontend API hostname. This file is ignored by Git. Clerk secrets never belong in the app.
2. Copy `Config/Secrets.example.xcconfig` to `Config/Secrets.xcconfig`. Fill in the Superwall public API key and the two App Store product identifiers when provisioned. Both Debug and Release read this ignored file.
3. In the repository root, provision the existing development `.env.local`, then run `npm ci` and `PORT=3002 npm run dev`. Wait for both `[web]` and `[worker]` readiness. Do not start or replace the main checkout's server on port 3001.
4. Run `xcodegen generate --spec mobile/project.yml` from the repository root. The generated `mobile/Revline.xcodeproj` and package resolution are checked in, so XcodeGen is only needed after changing the specification or adding files.
5. Connect the iPhone, enable Developer Mode, and select it as the Revline run destination in Xcode. In Signing & Capabilities, select the existing development team with automatic signing. The user completes any device trust prompts and signs in in the app.

Find the connected phone with `xcrun devicectl list devices`. Build for its device UDID using the existing signing team:

```sh
xcodebuild -project mobile/Revline.xcodeproj -scheme Revline \
  -configuration Debug -destination "id=$REVLINE_IPHONE_UDID" \
  -derivedDataPath mobile/.build/DerivedData \
  -clonedSourcePackagesDirPath mobile/.build/SourcePackages \
  -jobs 1 -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$REVLINE_SIGNING_TEAM" build
xcrun devicectl device install app --device "$REVLINE_IPHONE_UDID" \
  mobile/.build/DerivedData/Build/Products/Debug-iphoneos/Revline.app
xcrun devicectl device process launch --device "$REVLINE_IPHONE_UDID" com.revline.app
```

There are no test targets, test files, mock services, or sample backend records. Verify using `npm run typecheck`, `npm run build`, `xcodebuild`, and the running app. Build products, downloaded packages, local configuration, and screenshots are ignored. Remove only `mobile/.build/DerivedData` when finished to reclaim build space. Keep the watched Simulator running while verifying the interface.

Clerk is pinned to **1.5.8** because 1.5.9 through 1.6.2 use `weak let` in `ClerkRuntime`, which does not compile with this Mac's Swift 6.2.1. Convex 0.8.2 documents its Rust client as thread-safe but has no Sendable declaration; `ConvexConcurrency.swift` supplies that compatibility conformance. Reassess both when upgrading the packages. SDK source is not patched. A build phase adjusts the bundled English authentication copy to Revline’s punctuation style.

## Environments

| Build | Convex | Web renderer | Clerk |
| --- | --- | --- | --- |
| Debug | `https://majestic-alpaca-541.convex.cloud` | `http://localhost:3002` | Existing dev instance via `Debug.local.xcconfig` |
| Release | `https://different-gnu-398.convex.cloud` | `https://tryrevline.com` | Existing production instance via `Release.local.xcconfig`, `pk_live_` only |

URLs come from xcconfig and Info.plist. Release validates the exact production backend and website and refuses a test Clerk key. A missing configuration produces a setup screen instead of silently using development. Local networking is allowed for the development renderer; remote services use HTTPS. On a physical phone, localhost refers to the phone itself. Override the Debug web URL with a development address reachable from the phone; the configured server must accept those connections. Do not point a production build at the development backend.

The `/mobile/player` route must be present on the configured web server. Use this worktree on port 3002 or reuse the existing port 3001 server when its checkout includes that route. The hosted production site receives changes through the normal release process. No deployment is required to use the new native screens against the existing development API. New Apple billing functions require a later authorized Convex deployment.

If the main checkout already includes this route and its development server is running on port 3001, reuse it by adding `REVLINE_WEB_URL = http:/$()/localhost:3001` to the ignored `Debug.local.xcconfig`. This avoids an extra frontend and media worker when making native-only changes on a memory-constrained Mac. Do not edit or restart the main checkout's server. Release configuration is unaffected.

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

## Native interface

The interface uses native system controls in dark appearance, including launch and presented sheets. Projects use an inset grouped List with thumbnails, native navigation rows, search, pull to refresh, swipe actions and context menus. Project creation, renaming, media import, exports and account settings use system Form or List sections. The chat composer uses a native multiline TextField, menu Pickers and system button styles. Focusing the composer reduces the preview height so the conversation and keyboard remain usable.

Primary actions use `borderedProminent`; secondary actions use native bordered, borderless or row buttons. NavigationStack, toolbars, sheets, confirmation dialogs, Photos, Files and share sheets retain system behaviour. Typography uses Dynamic Type text styles, targets are at least 44 points, and the send action uses native sensory feedback. Empty states use ContentUnavailableView and loading uses ProgressView. No custom button style, palette, shadow, gradient, press animation or sheet animation remains. New project lives in the separate trailing tab on iOS 26; iOS 17 and 18 use a standard third tab. Opening and cancelling creation preserves the previous tab. Clerk uses its default adaptive interface. The WKWebView renderer and Superwall paywall presentation are unchanged.

Before/after captures for this change are local in `Screenshots/native-after`, excluded from Git. `before-` images record the previous custom styling; `after-` images record the native interface. Account/profile captures may contain private information and should not be used as public marketing images.

## Verification

The physical iPhone signing path currently requires the paid team's account holder to accept Apple's updated Program License Agreement. Use the existing Revline iPhone Simulator for the current UI pass; do not shut it down while the user is watching. The project targets device family 1 only. Keep one build job on this 8 GB Mac. Debug and Release Simulator builds passed during the native interface work, before the switch to the physical iPhone. Device signing, installation and launch are verified separately using the connected phone; a Simulator build does not verify device provisioning.

The development renderer can reuse the existing port 3001 server through the ignored Debug local configuration. Do not edit or restart that server. Debug uses the development Convex deployment; Release retains the exact production deployment and website. The existing App Store setup and sandbox billing checks above remain required.

### Unsigned Simulator builds

Build with `CODE_SIGNING_ALLOWED=NO` into `mobile/.build/DerivedData`, then install and launch using `xcrun simctl`. Simulator build settings embed `Config/Simulator.entitlements` in the executable's `__TEXT,__entitlements` section and keep the executable unsplit. This gives Clerk its normal Simulator Keychain identity without Apple provisioning or alternate credential storage. Device signing and entitlements remain unchanged. If the placeholder bundle identifier changes, update this Simulator identity and Keychain group to match.

The old unsigned build lacked that section, so Clerk returned OSStatus -34018 and never finished loading its client. Startup now also presents a native retry state when Clerk refresh fails. No SDK source or authentication backend was changed.

On this Mac, the local Debug config points `REVLINE_SIMULATOR_ENTITLEMENTS` at an ignored plist containing the earlier Simulator app's Keychain group. This restores the existing Clerk session through the SDK rather than creating another local identity. The checked-in default has no personal team identifier. Keep the local override and its plist together when cleaning build artifacts.

Current validation: unsigned Debug and optimized Release Simulator builds, `npm run typecheck`, `npm run build`, and `git diff --check` pass. The real development Clerk session restores, Convex projects/media/membership load, and the trailing plus opens the dark create sheet from both tabs. Cancelling returns to the previous tab. Onboarding, native pickers, media and export confirmation were inspected in dark appearance. The development preview showed its existing server-unavailable state, so playback was not verified. No export, purchase, agent turn or account deletion was performed. The watched Revline iPhone Simulator remains running.
