import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AnalysisError } from "../media-analysis/errors";
import type { HighlightSignal } from "../media-analysis/highlights";
const run = promisify(execFile);

/** One audio decode, half-second RMS. Helpers locate peaks and pauses; they never score a clip. */
export async function highlightAudio(
  source: string,
  duration: number,
  directory: string,
  signal: AbortSignal,
) {
  const metadata = join(directory, "loudness.txt");
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=duration,start_time",
      "-of",
      "json",
      source,
    ],
    { signal, timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream)
    return {
      levels: [] as number[],
      signals: [] as HighlightSignal[],
      audioSeconds: 0,
    };
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      "aresample=8000:async=1:first_pts=0,asetnsamples=n=4000:p=1,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=" +
        metadata,
      "-f",
      "null",
      "-",
    ],
    { signal, maxBuffer: 2 * 1024 * 1024 },
  );
  const levels = [
    ...(await readFile(metadata, "utf8")).matchAll(
      /lavfi\.astats\.Overall\.RMS_level=([^\r\n]+)/g,
    ),
  ].map((m) =>
    m[1].toLowerCase() === "-inf"
      ? -1200
      : Math.round(Math.max(-120, Number(m[1])) * 10),
  );
  const audioSeconds = levels.length * 0.5,
    expected = Math.min(
      duration,
      Number(stream.start_time ?? 0) + Number(stream.duration ?? duration),
    );
  if (
    !levels.length ||
    levels.some((n) => !Number.isFinite(n)) ||
    audioSeconds < expected - 2
  )
    throw new AnalysisError(
      "Whole-source audio helper decode is incomplete. Fetch the complete source and retry.",
      422,
      false,
    );
  const signals: HighlightSignal[] = [];
  for (let i = 10; i < levels.length; i++) {
    const prior = levels.slice(Math.max(0, i - 120), i).sort((a, b) => a - b),
      baseline = prior[Math.floor(prior.length / 2)],
      level = levels[i];
    const kind =
      level > baseline + 70 && level > -450
        ? "spike"
        : level < baseline - 120 && baseline > -550
          ? "silence"
          : null;
    if (!kind) continue;
    const strength = Math.min(1, Math.abs(level - baseline) / 200),
      previous = signals.at(-1),
      start = i * 0.5,
      end = Math.min(duration, start + 0.5);
    if (previous?.kind === kind && Math.abs(previous.end - start) < 0.01) {
      previous.end = end;
      previous.strength = Math.max(previous.strength, strength);
    } else
      signals.push({
        start,
        end,
        kind,
        strength,
        detail:
          "RMS " +
          (level / 10).toFixed(1) +
          " dB; rolling baseline " +
          (baseline / 10).toFixed(1) +
          " dB. Cut helper only.",
      });
  }
  return { levels, signals, audioSeconds };
}
