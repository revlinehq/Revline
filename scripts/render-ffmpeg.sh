#!/bin/bash
set -euo pipefail

# HyperFrames can start one decoder per timeline cut even with workers: 1.
# Admit at most REVLINE_RENDER_FFMPEG_SLOTS file decoders/encoders at a time
# (one per vCPU) so a many-cut timeline cannot multiply FFmpeg memory and CPU.
# Keep each managed child PID intact: queued flock and active FFmpeg are
# successively exec'd, so the renderer's cancellation reaches either state.
: "${REVLINE_RENDER_FFMPEG_BINARY:?Missing render FFmpeg binary}"
: "${REVLINE_RENDER_FFMPEG_LOCK:?Missing render FFmpeg lock}"
slots="${REVLINE_RENDER_FFMPEG_SLOTS:-1}"
encode_threads="${REVLINE_RENDER_ENCODE_THREADS:-1}"
[[ "$slots" =~ ^[1-4]$ ]] || slots=1
[[ "$encode_threads" =~ ^[1-9][0-9]?$ ]] || encode_threads=1
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
video_codec=''
for ((i=0;i<${#args[@]}-1;i++)); do
  if [[ "${args[i]}" == '-c:v' || "${args[i]}" == '-vcodec' ]]; then video_codec="${args[i+1]}"; fi
done
# Spend less CPU on compression searches at the same resolution and frame
# rate. REVLINE_RENDER_X264_PRESET maps the producer's preset (from=to) and
# REVLINE_RENDER_X264_CRF its CRF, for the H.264 output encoder only.
if [[ "$video_codec" == libx264 ]]; then
  preset_map="${REVLINE_RENDER_X264_PRESET:-}" crf_map="${REVLINE_RENDER_X264_CRF:-}"
  for ((i=0;i<${#args[@]}-1;i++)); do
    if [[ -n "$preset_map" && "${args[i]}" == '-preset' && "${args[i+1]}" == "${preset_map%%=*}" ]]; then args[i+1]="${preset_map#*=}"; fi
    if [[ -n "$crf_map" && "${args[i]}" == '-crf' && "${args[i+1]}" == "${crf_map%%=*}" ]]; then args[i+1]="${crf_map#*=}"; fi
  done
fi
# All rendering invocations with an input end in their output path. Bound
# output codec threads too, after the producer's encoder options. Decoders stay
# single-threaded; the final H.264 encoder may use the host's vCPUs.
if [[ "$has_input" == true ]]; then
  last=$((${#args[@]} - 1))
  output_threads=1
  if [[ "$video_codec" == libx264 ]]; then output_threads="$encode_threads"; fi
  args=("${args[@]:0:last}" -threads "$output_threads" "${args[last]}")
fi
# VFR normalization pipes a file decoder into a raw-frame consumer. Locking
# the consumer would stop it draining the decoder and deadlock both. It can
# run only when its upstream file decoder owns a job slot.
if [[ "$pipe_input" == true ]]; then
  exec "$REVLINE_RENDER_FFMPEG_BINARY" "${args[@]}"
fi
# Take any free slot. The lock belongs to the open descriptor, which FFmpeg
# inherits across exec and releases on exit.
for ((slot=0;slot<slots;slot++)); do
  exec {lock_fd}>>"$REVLINE_RENDER_FFMPEG_LOCK.$slot"
  if flock --exclusive --nonblock "$lock_fd"; then
    exec "$REVLINE_RENDER_FFMPEG_BINARY" "${args[@]}"
  fi
  exec {lock_fd}>&-
done
# Every slot is busy: queue on one, spreading waiters by PID.
exec flock --exclusive --no-fork "$REVLINE_RENDER_FFMPEG_LOCK.$(($$ % slots))" "$REVLINE_RENDER_FFMPEG_BINARY" "${args[@]}"
