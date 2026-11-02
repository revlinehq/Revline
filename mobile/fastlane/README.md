fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios precheck

```sh
[bundle exec] fastlane ios precheck
```

Validate the listing without submitting it

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Upload draft metadata only, without submitting

### ios listing

```sh
[bundle exec] fastlane ios listing
```

Upload draft metadata and reviewed screenshots, without submitting

### ios subscriptions

```sh
[bundle exec] fastlane ios subscriptions
```

Plan the single subscription; pass apply:true to change App Store Connect

### ios archive

```sh
[bundle exec] fastlane ios archive
```

Create a signed Release archive without uploading

### ios testflight

```sh
[bundle exec] fastlane ios testflight
```

Build Release and upload to TestFlight, without submitting for App Review

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
