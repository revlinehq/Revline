#!/bin/sh
# Release production from the build PC (x86 Ubuntu, reached as `ssh pc` over Tailscale) instead of this Mac:
# the processor image builds natively there in minutes instead of under emulation here.
#   scripts/release-on-pc.sh processor | frontend | convex
# The PC keeps its own checkout at ~/Developer/revline with .env.local and .env.processor-release.local.
set -eu
target="${1:-}"
case "$target" in
  processor) step='mv .env.processor-release.local .env.production.local && trap "mv .env.production.local .env.processor-release.local" EXIT && npm run deploy:production -- --processor-only' ;;
  frontend) step='npm run deploy:frontend:ci' ;;
  convex) step='npx convex deploy --yes --typecheck enable --message "release from pc $(git rev-parse --short HEAD)"' ;;
  *) echo "usage: $0 processor|frontend|convex" >&2; exit 2 ;;
esac
echo "Target: PRODUCTION $target, built on the PC from origin/main"
ssh -o ConnectTimeout=30 pc "set -eu; cd ~/Developer/revline; . ~/.nvm/nvm.sh >/dev/null; git fetch -q origin && git checkout -q main && git merge -q --ff-only origin/main; echo \"PC at \$(git log --oneline -1)\"; npm ci --no-audit --no-fund --silent; $step"
