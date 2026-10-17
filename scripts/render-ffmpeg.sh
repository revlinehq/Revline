#!/bin/bash
set -euo pipefail

# HyperFrames can start one decoder per timeline cut even with workers: 1.
# Keep each managed child PID intact: queued flock and active FFmpeg are
# successively exec'd, so the renderer's cancellation reaches either state.
: "${REVLINE_RENDER_FFMPEG_BINARY:?Missing render FFmpeg binary}"
: "${REVLINE_RENDER_FFMPEG_LOCK:?Missing render FFmpeg lock}"
args=(-filter_threads 1 -filter_complex_threads 1)
pipe_input=false
has_input=false
previous=''
for arg in "$@"; do
  if [[ "$previous" == '-i' && ( "$arg" == 'pipe:0' || "$arg" == '-' ) ]]; then pipe_input=true; fi
  if [[ "$arg" == '-i' ]]; then args+=(-threads 1); has_input=true; fi
  args+=("$arg")
  previous="$arg"
done
# All rendering invocations with an input end in their output path. Bound
# output codec threads too, after the producer's encoder options.
if [[ "$has_input" == true ]]; then
  last=$((${#args[@]} - 1))
  args=("${args[@]:0:last}" -threads 1 "${args[last]}")
fi
# VFR normalization pipes a file decoder into a raw-frame consumer. Locking
# the consumer would stop it draining the decoder and deadlock both. It can
# run only when its upstream file decoder owns the job's lock.
if [[ "$pipe_input" == true ]]; then
  exec "$REVLINE_RENDER_FFMPEG_BINARY" "${args[@]}"
fi
exec flock --exclusive --no-fork "$REVLINE_RENDER_FFMPEG_LOCK" "$REVLINE_RENDER_FFMPEG_BINARY" "${args[@]}"
