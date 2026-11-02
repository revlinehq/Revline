#!/bin/sh
set -eu

# Adjust the bundled English copy without modifying the resolved Clerk package.
/usr/bin/python3 - <<'PY'
import os
import pathlib
import plistlib

relative = 'Clerk_ClerkKitUI.bundle/en.lproj/Localizable.strings'
paths = [pathlib.Path(os.environ['TARGET_BUILD_DIR']) / os.environ['UNLOCALIZED_RESOURCES_FOLDER_PATH'] / relative]
# Only brand the app's copied resource. The SwiftPM build product stays untouched.
for path in paths:
    if not path.exists():
        continue
    with path.open('rb') as source:
        strings = plistlib.load(source)
    strings['Welcome! Sign in to continue'] = 'Sign in to continue'
    strings['Welcome! Please fill in the details to get started.'] = 'Fill in your details to get started.'
    for key, value in strings.items():
        if isinstance(value, str):
            strings[key] = value.replace('!', '')
    with path.open('wb') as target:
        plistlib.dump(strings, target, fmt=plistlib.FMT_BINARY)
(pathlib.Path(os.environ['DERIVED_FILE_DIR']) / 'revline-auth-copy.stamp').write_text('Revline authentication copy applied\n')
PY
