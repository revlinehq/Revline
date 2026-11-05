#!/bin/sh
set -eu
shell=$(ls -d /opt/chrome/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | sort | tail -1)
if [ -n "$shell" ]; then export PRODUCER_HEADLESS_SHELL_PATH="$shell"; fi
export TMPDIR=/tmp/revline
mkdir -p "$TMPDIR"
node infra/media-worker/railway-runtime.mjs
cpu_threads=$(node -e 'const [q,p]=require("node:fs").readFileSync("/sys/fs/cgroup/cpu.max","utf8").trim().split(/\s+/).map(Number); if(!Number.isFinite(q)||q<=0||!Number.isFinite(p)||p<=0) process.exit(1); console.log(Math.max(1,Math.min(64,Math.floor(q/p))));')
render_slots=$(node -e 'console.log(Math.min(2, Number(process.argv[1])))' "$cpu_threads")
export REVLINE_RENDER_WORKERS="$render_slots" REVLINE_RENDER_FFMPEG_SLOTS="$render_slots"
export REVLINE_RENDER_ENCODE_THREADS="$cpu_threads" MEDIA_PROCESSOR_THREADS="$cpu_threads" MEDIA_PREVIEW_CPUS="$cpu_threads"
export BEAT_TRACK_THREADS=$(node -e 'console.log(Math.min(8, Number(process.argv[1])))' "$cpu_threads")
export OMP_NUM_THREADS="$cpu_threads" MKL_NUM_THREADS="$cpu_threads" OMP_THREAD_LIMIT="$cpu_threads"
if [ "${REVLINE_RAILWAY_MODE:-worker}" = preflight ]; then exit 0; fi
if [ -n "${REVLINE_CHUNK_INDEX:-}" ]; then exec timeout --signal=TERM --kill-after=10s 35m node scripts/render-chunk.mjs; fi
exec node --import tsx infra/media-worker/consumer.ts
