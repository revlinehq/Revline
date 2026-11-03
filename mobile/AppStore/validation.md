# iPhone follow-up evidence

November 2, 2026. This is a draft implementation, not an App Store readiness sign-off. A build is not proof of an editing, purchase or deletion flow.

## Verified so far

- Final Debug and optimized Release Simulator builds passed with signing disabled. After the final rebase onto origin/main, npm run typecheck and npm run build passed with a 2 GiB Node heap. The first 1.5 GiB attempt exhausted V8 heap; increasing it resolved that resource failure. No test-only files were added.
- Installed and launched the Release build on the watched Revline iPhone Simulator. Inspected the real onboarding, welcome and live Clerk sign-in screens, including Apple and Google providers, Privacy and Terms, and no development-instance badge. No credentials were entered. The built Info.plist contains `com.zurahq.revline`, device family `[1]`, production Convex `different-gnu-398`, `https://tryrevline.com` and a live Clerk publishable key. No production endpoint was replaced with dev.
- Production Clerk has the exact paid-team App ID Prefix and bundle registered. Native API reports enabled, the native callback is registered, and the public associated-domain file includes `Z42PHGH527.com.zurahq.revline`.
- Created one empty disposable dev project through the native app: `Recline iOS validation dev` (`j97cg5w7vkw1pqsk2194kqr8jh8henc7`). The title was autocorrected before autocorrection was disabled. Other projects were not edited or exported.
- Captured the old editor and keyboard, and the new projects screen. All six supplied design PNGs and both HTML references were inspected before implementation. Real collapsed/expanded/keyboard, export, projects, create, account and deletion-entry states were inspected. Empty-timeline captures are layout evidence, not proof of agent edits or renders.
- Headless Chromium confirmed production `/privacy` and `/terms` return 404 before this change, and the local draft routes return 200 with the correct titles and footer links. The drafts explicitly require legal review.
- Persistent drawer checks passed on the disposable empty project: collapsed and expanded states, multiline input above the software keyboard, outside-tap dismissal, native Fast/Precise selection, no model picker or clip strip, hidden editor tab bar and restored home bar. No prompt was submitted.
- The trailing corner plus opens New project; cancellation returns to Projects. Export opens its real destination/captions controls and correctly disables rendering on an empty timeline.
- The iPhoneOS Release archive passed strict codesign verification with the paid team’s existing Apple Development identity. Cloud export failed with signing-permission/profile errors. A local distribution identity and App Store profile were created; manual export then succeeded and the IPA passed strict codesign verification under Apple Distribution and the production configuration. The existing-IPA upload stopped because the App Store app record is absent; TestFlight was not uploaded.
- App icon is 1024×1024 without alpha. Privacy manifest and Info.plist pass `plutil`; fastlane Ruby files pass syntax checks.
- The App Store Connect key authenticates. The single-product plan was checked again and stops because the app record does not exist. No subscription, listing, screenshot or binary upload has occurred. See [actual external changes](asc-changes.md).

## Dev deployment incident

After rebasing onto the merged 3D work, the mobile functions deployed to **majestic-alpaca-541 only** at 13:24:53 local time. This push also removed unmerged shared-dev indexes `toolWriteReceipts.by_run_stage`, `.by_expires`, `.by_write`, and `incidents.by_delivery_priority`, `.by_fingerprint`. The owner was notified immediately and asked to have those agents restore their deployment or merge a combined version. No further dev push will be made over their work. Do not assume the shared deployment still matches this branch after another agent restores it.

Production Convex and the hosted website were not deployed.

## Required runtime proof still pending

Simulator automation recovered and the watched Simulator remains open. Production login requires the owner; the agent never enters credentials. Account-level permission for disposable AI-processing checks was requested and remains pending.

| Check | Required evidence before marking complete |
| --- | --- |
| Native drawer | Collapsed, expanded and keyboard-open checks passed with an empty timeline. Dragging and real streamed conversation still need proof; the persistent drawer cannot be dismissed away. |
| Home controls | Projects plus/cancel, return from editor and search keyboard-open/closed verified. Corner plus from Account remains to verify. |
| Fast dev edit | On the disposable project, send a real request; verify pinned Terra medium, streamed reply, tool activity and changed preview |
| Precise dev edit | A separate real request in Precise; same model/effort, stronger workflow, changed preview and successful Undo |
| Production editing | Owner signs into a dedicated demo account; create a disposable project and repeat both modes against production, without changing personal projects |
| Export | Use an approximately eight-second disposable demo clip; explicit confirmation, one short render, real progress/error, Photos add-only and Files/TikTok sharing |
| Consent | Denial prevents new import/edit requests, explicit permission permits them, withdrawal prevents future requests |
| Deletion | A dedicated disposable account with projects, media, exports, chat and brand assets; verify cleanup and R2 retries, preservation of shared objects and invalidated sessions |
| Apple deletion | Separate Sign in with Apple key configured; fresh native authorization, matching Apple subject and token revocation. The app does not expose Clerk profile self-deletion; also audit any independent web deletion path |
| Purchases | Actual sandbox product/trial, web/complimentary bypass, restore and transaction mapping; notification renewal, expiry, refund and revocation |
| App Store captures | Five to eight real signed-in production screens at each requested resolution, clean status bar, reviewed rights to demo media |

No successful edit prompt, Undo, short render, purchase, restore or destructive deletion is claimed here. No production demo project or signed-in App Store screenshot set has been created yet. Backend changes need a reviewed production release before the new fixed-policy marker, caption-free renders and account-deletion endpoint can be relied on there. Narrow compatibility retries preserve Terra medium on older endpoints; they never fall back to another model.

## Owner and external setup

1. Create the App Store Connect app record for `com.zurahq.revline`, iOS, Revline, English (U.S.), SKU `revline-ios`. Apple's API cannot create this record. Then the prepared lanes can upload draft metadata, the single subscription and TestFlight build. Never submit for review automatically.
2. Sign into the watched Release app with a dedicated production demo account. The agent must not enter credentials or use personal projects for proof or marketing.
3. Supply the legal operator, monitored support address and App Review contact details. Approve the draft legal text and publish it through the normal reviewed web release.
4. Configure the separate server-only Sign in with Apple revocation key, single-product Superwall placement and billing environment values listed in [README](README.md). The App Store Connect upload key cannot sign Apple login client secrets.
5. The distribution-signed IPA is ready locally. Create the App Store app record, then use the existing-IPA upload command in [README](README.md). Future Keychain prompts require the owner’s direct system authorization.
6. Complete the [review checklist](review-checklist.md), including component/provider retention and real verification that web renewals stop during account deletion. Do not interpret owned application-row cleanup as a promise that legally retained Stripe or provider records are erased.

PR screenshots belong on `pr-assets/mobile-brand-bg/`. App Store production captures belong in `Screenshots/6.9/` and `Screenshots/6.5/`; the empty folders are intentional pending real capture. Designs, errors, old builds and screenshots at other dimensions are not substitutes.

## Final capture index

Actual Simulator captures are stored on the PR assets branch under `mobile-brand-bg/after/editor-v2/`: `projects.png`, `projects-keyboard.png`, `collapsed.png`, `expanded.png`, `keyboard.png`, `multiline-keyboard.png`, `precise-keyboard.png`, `export.png`, `create.png`, `account.png`, `delete-account.png`, `ai-consent.png`, `release-welcome.png` and `release-sign-in.png`. The earlier baseline is under `before/editor-v2/`; supplied Pencil designs are explicitly labelled references under `references/`.

The typed caption text in keyboard captures is an unsent local draft. No streaming response, edit result, duration change, Undo or render is represented as tested. Native format controls correctly show `1080p · 30 fps`; the empty project’s Save button is disabled. Final legal-route screenshots include the footer at desktop and phone widths and were taken in headless Chrome, with no visible browser.

The watched Simulator remains booted and the production Release app is left at live Clerk sign-in for the owner. This worktree’s development frontend and one-slot media worker run on port 3002; both readiness logs were checked. Shared port 3001 was not edited or restarted.

## Later native/payment preparation pass

Zura's priority override stopped all further Simulator and UI work. All devices and Simulator were shut down. This pass used build and source verification only; no new screenshots, sandbox purchase or restore result is claimed. See [current handoff](current-handoff.md) for the actual Debug/Release archive results, the single failed distribution-export attempt, Superwall's snapshot-service error and Apple app-record blocker.

Before that override, the disposable development project `j97cg5w7vkw1pqsk2194kqr8jh8henc7` received an eight-second demo import and a real Fast request: “Use the attached demo clip as the video, keep all 8 seconds, and add clean readable captions.” Streaming and three saved edits were observed; the preview displayed the clip with captions. Eleven recorded calls used GPT-6.1 Terra at medium reasoning. Final frame verification failed with “No video stream found,” so this is not a clean successful turn. A real Precise request to make a 7.5-second 9:16 version with larger captions was sent before stopping; its result was not checked afterward. Undo, a short export, production editing, purchases, restores and account deletion remain unproven. No user-owned project was used for these requests.
