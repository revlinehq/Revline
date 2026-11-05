# App Store release setup

Use your own Apple Developer team, registered bundle identifier and App Store Connect app record. The repository does not include signing identities, administrative API keys or reviewer credentials.

## Configuration

1. Register your bundle identifier and create an app record in App Store Connect.
2. Configure Clerk native authentication and associated domains for that bundle.
3. Review the legal documents, app privacy answers and SDK configuration.
4. Configure the subscription product and matching backend verification settings.
5. Provision signing credentials outside Git and configure fastlane using [its setup guide](../fastlane/README.md).

Keep administrative keys and signing material outside the repository. Public SDK configuration is distinct from administrative credentials. Use separate development and production backend configuration. Never point a release app at another operator's backend.

## Verification and submission

Follow [review-checklist.md](review-checklist.md). Validate sign-in, editing, media processing, purchase, restore and account deletion with dedicated accounts. A successful archive alone does not prove these flows work.

Capture actual running UI at the App Store's required device dimensions. Screenshot requirements and indexing are documented in [Screenshots/index.md](Screenshots/index.md). Do not fabricate activity, resize unrelated captures or include private projects.

The scripts in this directory prepare metadata and subscription resources. Review their plan and the selected account before applying changes. Uploading a binary and submitting an app for review are separate actions.

See [Apple's App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) and [App Store Connect help](https://developer.apple.com/help/app-store-connect/) for current requirements.
