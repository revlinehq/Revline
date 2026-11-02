# App Store Connect changes

## November 2, 2026

- Confirmed API-key access without printing or copying the private key.
- Found no app record for the original placeholder bundle identifier.
- Apple rejected registration of `com.revline.app` because it is unavailable.
- Registered `com.zurahq.revline` as Revline under paid team `Z42PHGH527`, bundle resource `ZXPYCAMZYV`. The Release override is local and ignored.
- Enabled Sign in with Apple (primary app) and Associated Domains capabilities on the new bundle identifier.
- Registered the exact bundle and prefix in production Clerk, and enabled the native Apple provider. Verified Native API enabled, the native callback registered, and the production associated-domain file includes the exact team/bundle. Real sign-in still requires the owner.
- App record creation is waiting for the owner because Apple’s API cannot create app records.
- Built and verified an Apple Development-signed Release archive for `com.zurahq.revline` under `Z42PHGH527`. Export for App Store Connect failed with Apple cloud-signing permission and missing distribution-profile errors. No IPA or TestFlight upload was produced.
- No subscription group/product, listing metadata or screenshot upload has occurred because the app record is still absent.
- No App Review submission or deployment to production was performed.

Append successful capability, subscription, metadata, screenshot and TestFlight changes here after verifying the API or upload response. Planned changes are not completed changes.
