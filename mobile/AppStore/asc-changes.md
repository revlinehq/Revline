# App Store Connect changes

## November 2, 2026

- Confirmed API-key access without printing or copying the private key.
- Found no app record for the original placeholder bundle identifier.
- Apple rejected registration of `com.revline.app` because it is unavailable.
- Registered `com.zurahq.revline` as Revline under paid team `Z42PHGH527`, bundle resource `ZXPYCAMZYV`. The Release override is local and ignored.
- Enabled Sign in with Apple (primary app) and Associated Domains capabilities on the new bundle identifier.
- Registered the exact bundle and prefix in production Clerk, and enabled the native Apple provider. Verified Native API enabled, the native callback registered, and the production associated-domain file includes the exact team/bundle. Real sign-in still requires the owner.
- App record creation is waiting for the owner because Apple’s API cannot create app records.
- Built and verified an Apple Development-signed Release archive for `com.zurahq.revline` under `Z42PHGH527`. Initial cloud export failed with Apple signing-permission/profile errors; local distribution signing then succeeded.
- Created an Apple Distribution certificate (`4HWV3WW76L`) and matching “Revline App Store” iOS App Store profile (`44PDS32RZ6`) through the authorized API key. Imported the generated signing identity into this Mac’s login keychain and installed the profile. Private signing material remains outside git. No existing certificate was revoked.
- Manual distribution export completed. Strict signature verification confirms the 18,781,674-byte `Revline.ipa` uses Apple Distribution under `Z42PHGH527` and the production configuration. The TestFlight upload was attempted and stopped at the missing App Store app record; no binary was uploaded.
- No subscription group/product, listing metadata or screenshot upload has occurred because the app record is still absent.
- No App Review submission or deployment to production was performed.

Append successful capability, subscription, metadata, screenshot and TestFlight changes here after verifying the API or upload response. Planned changes are not completed changes.

## Priority pass after merged PR #36

See [current store handoff](current-handoff.md) and [Superwall resource IDs](../superwall/README.md).

- Created Superwall Revline project `44005` and iOS app `59270` for the actual signed bundle `com.zurahq.revline`; saved Apple team `Z42PHGH527`. App creation also created default entitlement `pro` (`63344`). No other app was changed.
- Created product `687838` for `com.revline.app.monthly`, USD 3900 cents per month, seven trial days, granting `pro`. This is Superwall configuration only, not an App Store Connect product creation.
- Created draft headless paywall `288100`, with the monthly product attached, gated fullscreen presentation and source committed under `mobile/superwall`.
- Created campaign `116338`, enabled placement `onboarding_paywall` (`151759`), paused audience `198843` and 100% treatment variant `687815` pointing to the draft paywall. Nothing was promoted or enabled for delivery.
- Generated this Superwall app's forwarding notification URL to confirm its host/path match the existing Convex forwarding allowlist. Its token was not printed, committed or installed into any Convex environment.
- Saved the app's public SDK key only to ignored `mobile/Config/Secrets.xcconfig`. No private Apple or Superwall credential was copied, printed or uploaded.
- Snapshot version pushes failed twice with Superwall HTTP 500 / runtime renderer 404. The versions list is empty; publishing and campaign activation remain pending. Unsupported iOS support-URL/icon updates were rejected and made no change.
- Rechecked the App Store Connect app record with the existing authorized key, and attempted metadata upload. Apple still reports the app record absent, so no listing, category, age-rating, privacy, screenshot, subscription or TestFlight update was made by those operations.
- No production backend deployment, purchase, App Review submission or advertising change was performed.
- The new Release archive succeeded and its production settings/signature were verified. The one distribution export failed with codesign `errSecInternalComponent` (exit 70). No current-source IPA or TestFlight upload was produced; no signing retry or new certificate/profile was attempted.
