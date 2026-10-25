#!/bin/sh
# Fly.io export machine entry. The root filesystem is small (~8 GB, mostly the
# image) and slow, so temporary export files go to the attached scratch volume
# at /scratch when present. Volumes mount root-owned: prepare as root, then run
# the consumer as the unprivileged node user.
set -e
# BeginFrame capture needs chrome-headless-shell. HyperFrames' distributed path only
# looks in ~/.cache, but the image installs browsers under PUPPETEER_CACHE_DIR.
shell=$(ls -d /opt/chrome/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | sort | tail -1)
if [ -n "$shell" ]; then export PRODUCER_HEADLESS_SHELL_PATH="$shell"; fi
# Chunk machines (no volume) render one slice of a distributed export, then exit.
if [ -n "$REVLINE_CHUNK_INDEX" ]; then
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups node scripts/render-chunk.mjs
fi
if [ -d /scratch ]; then
  # A crashed export can leave files behind; this machine runs one export at a time.
  rm -rf /scratch/tmp
  mkdir -p /scratch/tmp
  chown node:node /scratch/tmp
  export TMPDIR=/scratch/tmp
fi
export HOME=/home/node
exec setpriv --reuid=node --regid=node --init-groups node --import tsx infra/media-worker/consumer.ts
