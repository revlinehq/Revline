# App Store review checklist

Draft for owner review. This is an implementation audit, not an approval guarantee. Runtime evidence and unresolved external setup must be checked before submission.

| Rule | App behavior / implementation | Required review or proof |
| --- | --- | --- |
| 2.1, complete app | Release requires prod Convex, live Clerk and tryrevline.com. Missing settings show a recoverable state. | Confirm full editing, preview, import, export, restore and deletion against the deployed production functions. Never submit while backend setup is incomplete. |
| 2.3, accurate metadata | Listing describes native prompt editing, clipping, motion, Fast/Precise and cloud exports. | Owner approves every claim and screenshots; include no fabricated replies, progress or inaccessible features. |
| 2.5.1, native APIs | SwiftUI UI, official Clerk/Convex/Superwall SDKs, PhotosPicker, Files importer and native sharing. WKWebView is only the scene renderer. | Check signed physical-device behavior once signing agreements are accepted. |
| 3.1.1, in-app purchase | Single App Store product; no Stripe checkout or web prices in iPhone UI. Existing Stripe and complimentary access bypasses purchase. | Configure App Store product and Superwall placement, verify active-web bypass and server entitlements. |
| 3.1.2, subscriptions | One monthly plan, $39.00 USA, one-week free trial for eligible new subscribers. Apple purchase confirmation controls local price and eligibility. Restore, Privacy, Terms and standard EULA are linked. | Confirm actual product price/trial in sandbox. Complete subscription review screenshot, localization, availability and tax/banking agreements. |
| 4.8, login services | Native Sign in with Apple is alongside sign-in providers. Same Clerk users as web. | Production Clerk native registration/Native API/Apple, Apple capability and associated domain must be verified. Test Apple sign-in on a physical device before release. |
| 5.1.1(i), privacy policy | Settings, Welcome and membership entry link to /privacy. Draft page explains collection, processors, retention and deletion. | Owner/legal reviewer approves operator identity, contact, provider contracts, retention and geographic rights. Publish the final policy before submission. |
| 5.1.1(ii–iii), permission and minimization | PhotosPicker is scoped; Files access is security-scoped. Export asks for Photos add-only permission. No camera or microphone recording is implemented. | Test denied Photos-add permission and Files sharing. Do not add camera/mic purpose strings for unused permissions. |
| 5.1.1(v), deletion | Settings and membership entry → Delete account, typed DELETE and a native final confirmation. The versioned Convex action stops web renewals, deletes the matching Clerk user and queues owned workspace/media cleanup. Separate App Store cancellation warning and management link. | Test using a dedicated disposable account only. Verify queued cleanup, R2 removal/retries, shared-object preservation and invalidated sessions. Never delete the owner's account for verification. |
| Sign in with Apple revocation | Apple-linked deletion asks for fresh native Apple confirmation. The server exchanges the code, verifies the signed Apple subject against Clerk and revokes its token before deleting. No refresh token is retained. | Provision the separate Sign in with Apple server key. Verify the native deletion flow revokes Apple access; Clerk profile self-deletion is not exposed in the app. Audit any separate web deletion path too. Do not mark this complete from a successful Clerk deletion alone. |
| 5.1.2(i), AI sharing | Explicit permission before first edit/import names OpenAI, Gemini, Anthropic, Deepgram, fal and ElevenLabs and describes prompts/context/frames/audio/transcripts/media links. Permission can be withdrawn in Account. | Verify denial prevents transmission and withdrawal stops future requests. Review provider retention and use terms. |
| 5.1.2, tracking | No IDFA or ATT tracking request. SDK subscription and app-scoped diagnostics are disclosed. | Confirm Superwall settings and any future analytics SDK match these declarations. No advertising tracking may be added silently. |
| Privacy manifest | App manifest declares collected data and UserDefaults reason CA92.1; SPM bundles Clerk and Superwall manifests (Superwall FileTimestamp C617.1). | Inspect the signed archive's privacy report and update App Store nutrition labels to match actual SDK configuration. |
| Export compliance | ITSAppUsesNonExemptEncryption=NO; app uses standard HTTPS/platform cryptography. | Owner answers export-compliance questions consistently; reassess if custom encryption is added. |
| 5.2, media rights | Import requires authorized media; no TikTok SDK or unauthorized downloading integration was added. | Owner confirms rights to demo footage, music, trademarks and App Store imagery. |
| Accessibility | Dynamic Type, SF Symbols, labelled controls, native sheets, 44-point targets and keyboard avoidance. | Check VoiceOver, large text, Reduce Motion and keyboard-open/closed states on supported iPhones. |

## App Store Connect fields the owner must approve

- App name Revline; subtitle, promotional text, description, keywords, categories Photo & Video and Productivity; copyright and marketing URL.
- Support URL `https://tryrevline.com`, Privacy `https://tryrevline.com/privacy`, Terms `https://tryrevline.com/terms`; a monitored support/legal address and the legal operator's identity.
- App Privacy: account name/email and user ID, purchase history, user photos/videos/audio/other content, app-scoped device identifiers, product interaction and diagnostics where collected by SDKs. Linked to the user for functionality; SDK usage/diagnostics also for analytics. No tracking. Validate the exact configuration rather than selecting “Data Not Collected.”
- Age rating: private user-created media, no public feed or user-to-user messaging, no unrestricted browser, ads, gambling, medical or curated mature content. Draft uses an owner-reviewable 13+ override because the service is not directed to children under 13.
- Review contact: real first/last name, phone and monitored email. Dedicated demo account with access and login instructions provided securely by the owner; no personal account credentials in git.
- Review notes: explain cloud editing, renderer bridge, permission disclosure, subscription behavior, Restore and deletion. Confirm reviewers can reach functioning production services.
- Subscription group/localized product name, $39 monthly USA base, Apple-equalized storefronts and one-week free introductory offer. Confirm eligibility, cancellation, restore, sandbox mapping, expiry and refund/revocation handling.
- App Store screenshots: actual production demo account/project at required iPhone sizes. No iPad set because UIDeviceFamily is 1.
- Pricing/availability, tax/banking, agreements, content-rights declaration, final legal approval and production environment settings.

No lane submits the app for review. The owner controls the final review submission after these items are complete.
