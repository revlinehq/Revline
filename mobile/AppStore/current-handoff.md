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

## Build and export result

Debug built successfully with `CODE_SIGNING_ALLOWED=NO` for generic iPhoneOS. The root web typecheck and production build passed after merging current main. The Superwall framework typecheck and self-contained snapshot build also passed. The Release archive succeeded at `mobile/.build/Revline.xcarchive`; strict code-signature verification passed. Its Info.plist confirms `com.zurahq.revline`, device family `[1]`, production Convex `different-gnu-398`, `https://tryrevline.com`, live Clerk and the configured public Superwall key.

The single distribution-export attempt failed with exit 70: `exportArchive codesign command failed` / `errSecInternalComponent`. The installed Apple Distribution certificate/profile were selected, and codesign returned `errSecInternalComponent`. The owner should check access to the distribution private key in the login keychain. No retry or current-source IPA/TestFlight upload followed. The old `mobile/.build/AppStoreExport/Revline.ipa` predates this pass and must not be mistaken for the new build.

Owner action: unlock the login keychain in **Keychain Access → login**, locate **My Certificates → Apple Distribution: Ivan Kolos**, expand its private key and allow `/usr/bin/codesign` to use it when macOS asks. The owner enters the Mac password directly, never in chat. For a cloud-managed alternative, grant **App Store Connect → Users and Access → the signing user → Additional Resources → Access to Cloud Managed Distribution Certificate**. Then export the saved archive after the Apple app record exists. The agent does not change keychain permissions or retry the failed export.

To avoid rebuilding, after resolving signing, the owner can run from `mobile/`:

```sh
xcodebuild -exportArchive -archivePath .build/Revline.xcarchive -exportPath .build/AppStoreExport-current -exportOptionsPlist .build/ExportOptions.plist
```

The export-options file is prepared locally, ignored by git, and contains only the signing team/profile selection. This command was not retried by the agent. Upload only the newly exported IPA after the app record exists.
