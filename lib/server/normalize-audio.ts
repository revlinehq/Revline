import { resolvedAudioTimeline } from "../editor/audio-normalization";
import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { z } from "zod";
import type { MediaWorkItem } from "../../convex/lib/media_task_contract";
import { timelineDuration } from "../editor/types";
import { prepareComposition } from "./prepare-composition";
import { decodeTimelineSound } from "./sound-check";
import { AnalysisError } from "../media-analysis/errors";

const run = promisify(execFile),
  RATE = 48000;
const measured = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
  target_offset: z.string(),
});
async function measure(
  path: string,
  targetLufs: number,
  truePeak: number,
  signal: AbortSignal,
  allowSilence = false,
) {
  const { stderr } = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-i",
      path,
      "-vn",
      "-af",
      `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=11:print_format=json`,
      "-f",
      "null",
      "-",
    ],
    { signal, maxBuffer: 1024 * 1024 },
  );
  const block = stderr.slice(
      stderr.lastIndexOf("{"),
      stderr.lastIndexOf("}") + 1,
    ),
    result = measured.parse(JSON.parse(block));
  if (allowSilence && result.input_i === "-inf" && result.input_tp === "-inf")
    return result;
  if (!Object.values(result).every((s) => Number.isFinite(Number(s))))
    throw new AnalysisError(
      "This range is silent or too quiet for reliable loudness normalization.",
      422,
    );
  return result;
}

/** Two-pass EBU R128 normalization, with a measurement of the actual stored PCM output. */
async function normalizeAudioFile(
  input: string,
  output: string,
  targetLufs: number,
  truePeak: number,
  signal: AbortSignal,
) {
  // Leave codec headroom below the requested ceiling, then verify the PCM actually stored.
  const ceiling = Math.max(-6, truePeak - 0.5);
  const stats = await measure(input, targetLufs, ceiling, signal);
  let offset = Number(stats.target_offset),
    outputLufs = 0,
    peak = 0;
  // Short, peaky speech can miss the first pass's offset after limiting. Correct against the measured output.
  for (let attempt = 0; attempt < 4; attempt++) {
    const filter = `loudnorm=I=${targetLufs}:TP=${ceiling}:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${offset}:linear=true`;
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        input,
        "-vn",
        "-af",
        filter,
        "-ar",
        String(RATE),
        "-ac",
        "2",
        "-c:a",
        "pcm_s24le",
        "-y",
        output,
      ],
      { signal, maxBuffer: 1024 * 1024 },
    );
    const actual = await measure(output, targetLufs, truePeak, signal);
    outputLufs = Number(actual.input_i);
    peak = Number(actual.input_tp);
    if (Math.abs(outputLufs - targetLufs) <= 0.3 && peak <= truePeak) break;
    offset = Math.max(-99, Math.min(99, offset + targetLufs - outputLufs));
  }
  if (Math.abs(outputLufs - targetLufs) > 0.7 || peak > truePeak)
    throw new AnalysisError(
      "The processed audio did not reach its loudness and true-peak targets.",
      422,
    );
  return { inputLufs: Number(stats.input_i), outputLufs, truePeak: peak };
}

export async function normalizeTimelineAudio(
  snapshot: NonNullable<MediaWorkItem["snapshot"]>,
  directory: string,
  convexUrl: string,
  signal: AbortSignal,
) {
  const request = snapshot.normalization;
  if (!request)
    throw new AnalysisError("The normalization request is missing.", 400);
  const selected = request.clipId
    ? snapshot.timeline.clips.find((c) => c.id === request.clipId)
    : undefined;
  const target =
    selected?.kind === "video" && selected.linkedClipId
      ? snapshot.timeline.clips.find(
          (c) =>
            c.id === selected.linkedClipId && c.linkedClipId === selected.id,
        )
      : selected;
  if (request.clipId && (!target || !["video", "audio"].includes(target.kind)))
    throw new AnalysisError("The selected sound is unavailable.", 400);
  const start = target?.start ?? 0,
    end = target
      ? target.start + target.duration
      : timelineDuration(snapshot.timeline),
    duration = end - start;
  if (duration < 0.3 || duration > 600)
    throw new AnalysisError(
      "Normalize between 0.3 seconds and ten minutes.",
      400,
    );
  const timeline = resolvedAudioTimeline(
    target
      ? { ...snapshot.timeline, audioNormalization: undefined }
      : snapshot.timeline,
  );
  // Keep original voice coverage for ducking, but prepare only the selected sound's bytes.
  const assets = snapshot.assets.filter((a) =>
    timeline.clips.some(
      (c) =>
        (!target || c.id === target.id) &&
        c.assetId === a._id &&
        (c.kind === "audio" || c.kind === "video") &&
        (c.volume ?? 1) > 0,
    ),
  );
  const { assetUrls, audioSourceOffsets } = await prepareComposition(
    directory,
    timeline,
    assets,
    convexUrl,
    signal,
    [],
    [{start,end}],
  );
  const n = Math.round(duration * RATE),
    left = new Float32Array(n),
    right = new Float32Array(n);
  let tracks = 0;
  await decodeTimelineSound(
    { ...snapshot, timeline },
    directory,
    assetUrls,
    audioSourceOffsets,
    { start, end },
    signal,
    (track) => {
      tracks++;
      for (let i = 0; i < track.left.length && i + track.offset < n; i++) {
        const at = i + track.offset;
        if (at >= 0) {
          left[at] += track.left[i];
          right[at] += track.right[i];
        }
      }
    },
    target?.id,
  );
  if (!tracks)
    throw new AnalysisError("There is no audible sound to normalize.", 400);
  // Float PCM preserves overloaded mixes for loudnorm instead of clipping before measurement.
  const mix = join(directory, "mix.wav"),
    file = await open(mix, "w");
  try {
    const header = Buffer.alloc(44);
    header.write("RIFF");
    header.writeUInt32LE(36 + n * 8, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(3, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 8, 28);
    header.writeUInt16LE(8, 32);
    header.writeUInt16LE(32, 34);
    header.write("data", 36);
    header.writeUInt32LE(n * 8, 40);
    await file.write(header);
    for (let first = 0; first < n; first += 8192) {
      signal.throwIfAborted();
      const count = Math.min(8192, n - first),
        chunk = Buffer.allocUnsafe(count * 8);
      for (let i = 0; i < count; i++) {
        chunk.writeFloatLE(left[first + i], i * 8);
        chunk.writeFloatLE(right[first + i], i * 8 + 4);
      }
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  const path = join(directory, "normalized.wav"),
    measurements = await normalizeAudioFile(
      mix,
      path,
      request.targetLufs,
      request.truePeak,
      signal,
    );
  return { path, start, duration, ...measurements };
}

/** AAC can overshoot PCM peaks. Verify the encoded export and attenuate only if its ceiling was exceeded. */
export async function enforceNormalizedExportPeak(
  path: string,
  directory: string,
  ceiling: number,
  signal: AbortSignal,
) {
  const { rename, rm } = await import("node:fs/promises");
  for (let attempt = 0; attempt < 3; attempt++) {
    const stats = await measure(path, -14, ceiling, signal, true);
    if (stats.input_tp === "-inf") return;
    const peak = Number(stats.input_tp);
    if (peak <= ceiling) return;
    const corrected = join(directory, "peak-safe.mp4"),
      gain = ceiling - peak - 0.15;
    try {
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-i",
          path,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-c:v",
          "copy",
          "-af",
          `volume=${gain}dB`,
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          "-y",
          corrected,
        ],
        { signal, maxBuffer: 1024 * 1024 },
      );
      await rename(corrected, path);
    } finally {
      await rm(corrected, { force: true });
    }
  }
  if (Number((await measure(path, -14, ceiling, signal)).input_tp) > ceiling)
    throw new AnalysisError(
      "The encoded export exceeded its normalized true-peak ceiling.",
      422,
    );
}
