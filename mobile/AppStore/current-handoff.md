# Current store handoff

November 2, 2026. This pass follows the instruction to stop all Simulator and UI testing. The Simulator was shut down and was not reopened. No new screenshots were taken, no production backend was deployed, and no app or subscription was submitted for review.

## App Store Connect

The existing API key authenticates, but Apple still returns no app record for `com.zurahq.revline`. The subscriptions plan and metadata upload were attempted and stopped at this blocker. Apple has no public app-record creation endpoint. The owner must create the record in **App Store Connect → Apps → + → New App**: iOS, Revline, English (U.S.), bundle `com.zurahq.revline`, SKU `revline-ios`.

The listing, Photo & Video / Productivity categories, age-rating answers and review notes are prepared under `mobile/fastlane` and `mobile/AppStore`. Review contact requires the owner's real first/last name, phone and email in `ASC_REVIEW_FIRST_NAME`, `ASC_REVIEW_LAST_NAME`, `ASC_REVIEW_PHONE`, `ASC_REVIEW_EMAIL`. None were invented. Legal operator/contact details and a dedicated reviewer account also remain owner work.

`app-privacy.json` contains the prepared fastlane-format nutrition answers corresponding to the app manifest: account name/email/user ID, purchase history, photos/videos/audio/other content, device ID, product interaction and diagnostics. All are linked for functionality; the last three are also used for SDK analytics. No tracking or advertising purpose is declared. Review against the final enabled SDK configuration. Fastlane's privacy action uses Apple's browser-session API and does not accept the existing API-key auth; no Apple login or password was attempted. Enter these answers in App Store Connect → App Privacy, or run the documented fastlane action yourself with your authenticated Apple session after the app record exists.

All existing `pr-assets` PNG dimensions were inspected without rendering a UI. The iPhone captures are 1206×2622; none match the requested 1320×2868 or 1284×2778 sets. No resizing, synthetic screenshot or screenshot upload was performed.

## Superwall

See [paywall configuration and owner steps](../superwall/README.md). The project/app, product, paywall and paused campaign exist. The public SDK key is saved only in ignored `mobile/Config/Secrets.xcconfig`. Superwall rejected snapshot publishing twice with a server-side 500/renderer 404; there is no published version. Its campaign audience remains paused and the app exposes native StoreKit purchase and Restore controls if the hosted placement skips or fails.

App Store purchases remain blocked until the Apple app/product and server configuration are ready. Access stays authoritative in Convex; no local or unverified purchase unlock was added. Both signed App Store transaction ingestion and signed Superwall V2 webhooks already feed the same entitlement rows. No billing deployment or environment secret change was performed in this pass.

## iPhone Duo

Apple's [Prepare your app for iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111461/) guidance was read. The code uses size classes and local available geometry, preserves safe areas and native navigation, and changes the editor from a bottom drawer to a preview/conversation split when space permits. Composer controls reflow for narrow widths and accessibility text. The target remains iPhone-only.

This Mac has only Xcode 26.1.1 / iOS 26.1 SDK. The owner must install Xcode 27.1 to build with the full-screen Duo opt-in and validate folding, reserved regions and its asymmetric safe areas. No claim of tested Duo support is made. The 2007×2853 inner-display screenshot set remains pending the SDK and real capture; no new simulator was installed or opened.
