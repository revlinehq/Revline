import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AnalysisError } from "../media-analysis/errors";
import { download, subscribe, type FalClient } from "./fal";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { paintMasks, requireMetaSam, segmentVideo } from "./meta-sam";
import {
  SUBJECT_MODELS,
  falSubjectPrompt,
  samSubjectPrompt,
  type SubjectPrompt,
} from "./subject-segmentation";

const run = promisify(execFile);
const resultSchema = z.object({ video: z.object({ url: z.string().url() }) });
type Seed =
  | {
      kind: "prompt";
      prompt: SubjectPrompt;
      frame: number;
    }
  | { kind: "mask"; url: string };

/** Propagate from the selected frame in both directions. Each model call starts
 * with its conditioning frame, and reverse decoding buffers at most four seconds. */
export async function segmentVideoSubject(
  fal: FalClient,
  clip: string,
  directory: string,
  seed: Seed,
  fps: number,
  signal: AbortSignal,
  onProgress: (value: number) => void,
) {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "csv=p=0",
      clip,
    ],
    { signal },
  );
  const total = Number(stdout.trim());
  if (!Number.isInteger(total) || total < 1)
    throw new AnalysisError("The subject video has no frames.", 422);
  const frame =
    seed.kind === "prompt" ? Math.max(0, Math.min(total - 1, seed.frame)) : 0;
  const pieces: string[] = [],
    batch = Math.max(2, Math.round(4 * fps));
  let written = 0,
    sequence = 0;
  for (const direction of frame > 0 ? [-1, 1] : [1]) {
    let cursor = frame,
      initial = true,
      maskUrl = seed.kind === "mask" ? seed.url : undefined;
    const ordered: string[] = [];
    while (true) {
      const start = direction === 1 ? cursor : Math.max(0, cursor - batch + 1),
        end = direction === 1 ? Math.min(total, cursor + batch) : cursor + 1,
        count = end - start;
      const source = join(directory, `subject-${sequence}-source.mp4`),
        raw = join(directory, `subject-${sequence}-raw.mp4`),
        piece = join(directory, `subject-${sequence++}-mask.mp4`),
        last = join(directory, "subject-last.png");
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(start / fps),
          "-i",
          clip,
          "-frames:v",
          String(count),
          "-an",
          "-vf",
          `${direction === -1 ? "reverse," : ""}setpts=N/(${fps}*TB)`,
          "-c:v",
          "libx264",
          "-threads",
          "2",
          "-preset",
          "veryfast",
          "-crf",
          "14",
          "-pix_fmt",
          "yuv420p",
          "-y",
          source,
        ],
        { signal, maxBuffer: 1024 * 1024 },
      );
      const video_url = await fal.storage.upload(
        new Blob([await readFile(source)], { type: "video/mp4" }),
      );
      const prompt =
        initial && seed.kind === "prompt" ? seed.prompt : undefined;
      const input = prompt
        ? falSubjectPrompt(prompt, 0)
        : { mask_url: maskUrl };
      const result = resultSchema.parse(
        await subscribe(
          fal,
          SUBJECT_MODELS.video,
          { video_url, ...input, apply_mask: false },
          signal,
        ),
      );
      await download(result.video.url, raw, signal);
      const measured = await run(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-count_packets",
          "-show_entries",
          "stream=nb_read_packets",
          "-of",
          "csv=p=0",
          raw,
        ],
        { signal },
      );
      if (Number(measured.stdout.trim()) !== count)
        throw new AnalysisError(
          "The subject model returned an incomplete frame sequence.",
          422,
        );
      const continuing = direction === 1 ? end < total : start > 0;
      if (continuing) {
        await run(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            raw,
            "-vf",
            `select='eq(n,${count - 1})',format=gray`,
            "-frames:v",
            "1",
            "-y",
            last,
          ],
          { signal, maxBuffer: 1024 * 1024 },
        );
        maskUrl = await fal.storage.upload(
          new Blob([await readFile(last)], { type: "image/png" }),
        );
      }
      // Shared conditioning frames are retained once on the original CFR clock.
      const skip = direction === 1 && !initial ? 1 : 0,
        kept = direction === -1 ? count - 1 : count - skip;
      if (kept > 0) {
        await run(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            raw,
            "-vf",
            `${direction === -1 ? "reverse," : ""}trim=start_frame=${skip}:end_frame=${direction === -1 ? count - 1 : count},settb=1/${fps},setpts=N,fps=${fps},format=yuv420p`,
            "-frames:v",
            String(kept),
            "-an",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-preset",
            "veryfast",
            "-crf",
            "0",
            "-y",
            piece,
          ],
          { signal, maxBuffer: 1024 * 1024 },
        );
        if (direction === -1) ordered.unshift(piece);
        else ordered.push(piece);
        written += kept;
        onProgress(30 + Math.round((45 * written) / total));
      }
      await Promise.all(
        [source, raw, last].map((path) => rm(path, { force: true })),
      );
      if (!continuing) break;
      cursor = direction === 1 ? end - 1 : start;
      initial = false;
    }
    pieces.push(...ordered);
  }
  if (written !== total)
    throw new AnalysisError(
      "The subject mask does not cover the requested frame sequence.",
      422,
    );
  const list = join(directory, "subject-masks.txt"),
    path = join(directory, "subject-mask.mp4");
  await writeFile(
    list,
    pieces
      .map((piece) => `file '${piece.replaceAll("'", "'\\''")}'`)
      .join("\n"),
  );
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-y",
      path,
    ],
    { signal, maxBuffer: 1024 * 1024 },
  );
  await Promise.all(pieces.map((piece) => rm(piece, { force: true })));
  return path;
}

/** MCP selections: SAM 3.1 on Meta tracks the subject through the whole clip in
 * one request, both directions from the selected frame. Frames where the
 * subject is not visible are empty. Returns a lossless grayscale mask video and,
 * per frame, the subject's normalized [left, top, right, bottom] box (null where hidden). */
export async function segmentVideoSubjectSam31(
  clip: string,
  directory: string,
  prompt: SubjectPrompt,
  frame: number,
  fps: number,
  signal: AbortSignal,
  onProgress: (value: number) => void,
) {
  const key = requireMetaSam();
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets", "-of", "json", clip],
    { signal },
  );
  const stream = z
    .object({ streams: z.array(z.object({ width: z.number().int().positive(), height: z.number().int().positive(), nb_read_packets: z.coerce.number().int().positive() })).min(1) })
    .parse(JSON.parse(stdout)).streams[0];
  const size = { width: stream.width, height: stream.height }, total = stream.nb_read_packets;
  if (total > 15_000) throw new AnalysisError("SAM 3.1 tracks up to 15,000 frames per request. Shorten the clip.", 422, false);
  const masks = await segmentVideo(key, clip, samSubjectPrompt(prompt, Math.max(0, Math.min(total - 1, frame))), size, signal);
  if (!masks.length) throw new AnalysisError("SAM 3.1 did not find the selected subject. Choose another source point or a box around the visible subject.", 422, false);
  onProgress(60);
  const byFrame = new Map<number, typeof masks[number][]>();
  for (const mask of masks) {
    const index = mask.frame?.frameIndex ?? 0;
    byFrame.set(index, [...(byFrame.get(index) ?? []), mask]);
  }
  const path = join(directory, "subject-mask.mp4");
  const encoder = spawn("ffmpeg", ["-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${size.width}x${size.height}`, "-framerate", String(fps), "-i", "-", "-an", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "0", "-pix_fmt", "yuv420p", "-y", path], { signal, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  encoder.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-1000); });
  const closed = new Promise<number | null>((resolve, reject) => { encoder.once("error", reject); encoder.once("close", resolve); });
  const empty = new Uint8Array(size.width * size.height);
  function* frames() {
    for (let index = 0; index < total; index++) {
      const records = byFrame.get(index);
      yield records ? paintMasks(records, size) : empty;
    }
  }
  // pipeline handles backpressure, an early ffmpeg exit (EPIPE) and abort without leaking listeners.
  const [written, code] = await Promise.allSettled([pipeline(Readable.from(frames()), encoder.stdin), closed]);
  signal.throwIfAborted();
  if (code.status === "rejected" || code.value !== 0 || written.status === "rejected")
    throw new AnalysisError(`Could not encode the SAM 3.1 mask video${stderr ? `: ${stderr.trim().slice(0, 300)}` : "."}`, 502);
  onProgress(75);
  const round = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1e4) / 1e4;
  const boxes = Array.from({ length: total }, (_, index) => {
    const records = byFrame.get(index);
    if (!records?.length) return null;
    const left = Math.min(...records.map(record => record.bounds.left)), top = Math.min(...records.map(record => record.bounds.top));
    const right = Math.max(...records.map(record => record.bounds.right)), bottom = Math.max(...records.map(record => record.bounds.bottom));
    return right > left && bottom > top ? [round(left / size.width), round(top / size.height), round(right / size.width), round(bottom / size.height)] : null;
  });
  return { path, boxes };
}
