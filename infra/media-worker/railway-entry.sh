#!/bin/sh
set -eu
shell=$(ls -d /opt/chrome/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | sort | tail -1)
if [ -n "$shell" ]; then export PRODUCER_HEADLESS_SHELL_PATH="$shell"; fi
export TMPDIR=/tmp/revline
mkdir -p "$TMPDIR"
node infra/media-worker/railway-runtime.mjs
if [ "${REVLINE_RAILWAY_MODE:-worker}" = preflight ]; then exit 0; fi
if [ -n "${REVLINE_CHUNK_INDEX:-}" ]; then exec timeout --signal=TERM --kill-after=10s 35m node scripts/render-chunk.mjs; fi
exec node --import tsx infra/media-worker/consumer.ts
