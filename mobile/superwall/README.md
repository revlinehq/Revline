# Revline membership paywall

This is the Superwall framework source, separate from the Next app. It uses the official framework build API rather than a hand-written purchase bridge. The screen is hosted by Superwall; StoreKit 2 and the native purchase controller own purchases and restores. Native SwiftUI remains the fallback if a hosted placement is unavailable.

```sh
cd mobile/superwall
npm ci --ignore-scripts
npm run typecheck
npm run build
```

The build creates `.superwall/push.json`, containing the self-contained HTML and product/settings manifest for Superwall's documented `POST /v2/paywalls/288100/versions` endpoint. Building never publishes. Once a version can be pushed, promote that exact version with `POST /v2/paywalls/288100/promote`, then enable audience `198843` of campaign `116338`. Do not enable the audience before a published paywall and the real Apple product are ready.

The public app key belongs only in ignored `../Config/Secrets.xcconfig`. The paywall reads the localized price and introductory-offer eligibility from the host. No Stripe checkout, invented price or forced trial eligibility is used. The intended US offer is 7 days free, then $39/month, cancel anytime. Ineligible subscribers see the monthly price without a trial claim. Close, Restore, Terms and Privacy use the official host actions.

## Account configuration on November 2, 2026

- Superwall project `44005`, iOS app `59270`, bundle `com.zurahq.revline`, team `Z42PHGH527`.
- Product `687838`, identifier `com.revline.app.monthly`, USD 3900 cents/month, seven trial days, `pro` entitlement `63344`.
- Headless paywall `288100`, identifier `revline-membership`, gated fullscreen presentation.
- Campaign `116338`, placement `onboarding_paywall` (`151759`), 100% treatment variant `687815`. Its audience `198843` is intentionally paused.
- Both attempts to push the built snapshot returned Superwall HTTP 500: `Failed to resolve headless snapshot URL: runtime renderer returned 404 (no redirect)`. The versions list remains empty. No version was promoted. Resolve this in Superwall before enabling the audience.
- No Apple keys are connected to this new Superwall app. The existing App Store Connect upload key does not replace the separate In-App Purchase key.

## Owner connection steps

In your Superwall project's settings, open **Revenue Tracking**. On the Required card, either use **Set up with Apple** as an Apple Admin/Account Holder, or enter the existing App Store Connect key privately and add a separate **In-App Purchase** key from App Store Connect → Users and Access → Integrations → In-App Purchase. Never place either private key in this repo or in the iOS app.

Keep Apple's V2 notification URL pointed at the Convex `/app-store/notifications` endpoint when that backend is deployed. Use Superwall's **Through your server** path and put its token-bearing forwarding URL in the matching Convex environment as `SUPERWALL_APPLE_NOTIFICATIONS_URL`. Do not publish that URL. Connect a Superwall V2 webhook to `/superwall/webhook`, using its signing secret as `SUPERWALL_WEBHOOK_SECRET` and the matching `SUPERWALL_PROJECT_ID`. Production and dev credentials remain separate; do not route production events to dev. See [App Store setup](../AppStore/README.md) for the remaining server variables.
