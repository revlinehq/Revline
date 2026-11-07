import { processingThreads } from './processing-resources';
import { segmentVideoSubject, segmentVideoSubjectSam31 } from "./segment-video-subject";
import {
  foregroundMask,
  subjectPrompt,
  type SubjectSelection,
} from "./subject-segmentation";
import { download, requireFal, subscribe } from "./fal";
import { z } from "zod";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AnalysisError } from "@/lib/media-analysis/errors";

const run = promisify(execFile);
// Person matting keeps soft hair edges; BiRefNet extracts the salient foreground.
const PERSON_ENDPOINT = "veed/video-background-removal",
  FOREGROUND_ENDPOINT = "fal-ai/birefnet/v2/video";

/** Cut out the person (or salient foreground) of source seconds [start, end) with fal.ai; returns a VP9 WebM with alpha.
 * Only the window is sent, because fal bills every frame it receives. */
export async function removeBackground(
  source: string,
  directory: string,
  window: {
    start: number;
    end: number;
    fps?: number;
    mode?: "person" | "foreground";
    selection?: SubjectSelection;
  },
  signal: AbortSignal,
  onProgress: (value: number) => void,
) {
  // MCP subject selections run on SAM 3.1 (Meta) alone and do not need fal.
  const sam31 = window.selection?.segmenter === "sam-3.1";
  const fal = () =>
    requireFal("Background removal is not configured on the media worker.");
  if (!sam31) fal();
  const clip = join(directory, "cutout-source.mp4");
  // fal bills per frame: never send more frames than the project plays.
  const { stdout: rate } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=avg_frame_rate",
      "-of",
      "csv=p=0",
      source,
    ],
    { signal, timeout: 30_000 },
  );
  const [num, den] = rate.trim().split("/").map(Number),
    sourceFps = den ? num / den : num;
  // A constant rate gives every frame a known time, whatever timing fal returns.
  const fps = Math.max(
    1,
    Math.min(
      window.fps ?? 30,
      Number.isFinite(sourceFps) && sourceFps > 0 ? Math.round(sourceFps) : 30,
    ),
  );
  // Accurate seek from the prior keyframe; near-lossless H.264 so edges survive the hand-off.
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      String(processingThreads()),
      "-ss",
      window.start.toFixed(6),
      "-i",
      source,
      "-t",
      (window.end - window.start).toFixed(6),
      "-map",
      "0:v:0",
      "-an",
      "-vf",
      `fps=${fps}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "14",
      "-pix_fmt",
      "yuv420p",
      "-y",
      clip,
    ],
    { signal, timeout: 600_000, maxBuffer: 1024 * 1024 },
  );
  onProgress(30);
  let path = join(directory, "cutout.webm");
  // SAM 3.1 also reports the subject's box per frame of the window (Genesis layers keep them).
  let boxes: (number[] | null)[] | undefined;
  const segmented = async () => {
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        clip,
      ],
      { signal },
    );
    const { width, height } = z
      .object({
        streams: z
          .array(z.object({ width: z.number(), height: z.number() }))
          .min(1),
      })
      .parse(JSON.parse(stdout)).streams[0];
    let mask: string;
    if (window.selection) {
      const prompt = await subjectPrompt(
        source,
        directory,
        window.selection,
        width,
        height,
        signal,
      );
      const frame = Math.round((window.selection.time - window.start) * fps);
      mask =
        window.selection.segmenter === "sam-3.1"
          ? await segmentVideoSubjectSam31(clip, directory, prompt, frame, fps, signal, onProgress).then((result) => { boxes = result.boxes; return result.path; })
          : await segmentVideoSubject(
              fal(),
              clip,
              directory,
              { kind: "prompt", prompt, frame },
              fps,
              signal,
              onProgress,
            );
    } else {
      const frame = join(directory, "cutout-seed.png");
      await run(
        "ffmpeg",
        ["-v", "error", "-i", clip, "-frames:v", "1", "-y", frame],
        { signal },
      );
      const initial = await foregroundMask(fal(), frame, directory, signal);
      const url = await fal().storage.upload(
        new Blob([await readFile(initial)], { type: "image/png" }),
      );
      mask = await segmentVideoSubject(
        fal(),
        clip,
        directory,
        { kind: "mask", url },
        fps,
        signal,
        onProgress,
      );
    }
    // The model supplies only alpha. RGB always comes from the synchronized original.
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-filter_complex_threads",
        "1",
        "-i",
        clip,
        "-i",
        mask,
        "-filter_complex",
        `[0:v]setpts=N/(${fps}*TB),format=rgb24[src];[1:v]setpts=N/(${fps}*TB),scale=${width}:${height},format=gray[mask];[src][mask]alphamerge[out]`,
        "-map",
        "[out]",
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-metadata:s:v:0",
        "alpha_mode=1",
        "-b:v",
        "0",
        "-crf",
        "18",
        "-deadline",
        "realtime",
        "-an",
        "-y",
        path,
      ],
      { signal, maxBuffer: 1024 * 1024 },
    );
  };
  if (window.selection) await segmented();
  else {
    const url = await fal().storage.upload(
      new Blob([await readFile(clip)], { type: "video/mp4" }),
    );
    signal.throwIfAborted();
    const endpoint =
      window.mode === "foreground" ? FOREGROUND_ENDPOINT : PERSON_ENDPOINT;
    const input =
      window.mode === "foreground"
        ? {
            video_url: url,
            model: "General Use (Light)",
            refine_foreground: true,
            video_output_type: "VP9 (.webm)",
          }
        : {
            video_url: url,
            output_codec: "vp9",
            refine_foreground_edges: true,
            subject_is_person: true,
          };
    const result = z
      .object({
        video: z.union([
          z.object({ url: z.string().url() }),
          z.array(z.object({ url: z.string().url() })).min(1),
        ]),
      })
      .parse(await subscribe(fal(), endpoint, input, signal));
    await download(
      Array.isArray(result.video) ? result.video[0].url : result.video.url,
      path,
      signal,
    );
    if (window.mode === "foreground" && !(await anyOpaque(path, signal)))
      await segmented();
  }
  onProgress(84);
  if (!(await anyOpaque(path, signal)))
    throw new AnalysisError(
      "No foreground was found. Choose a source point or box around the visible subject.",
      422,
    );
  // fal may return different timestamps (or frame count) than it was sent. Output frame i
  // is input frame i, so retime frames onto the input's clock; if the count differs,
  // stretch to the input's exact duration. Then lead with transparent frames so second N
  // of the cut-out is second N of the source: the clip keeps its sourceStart and stays in
  // sync with its linked original audio.
  const sent = await frameCount(clip, signal),
    returned = await frameCount(path, signal);
  const retime =
    sent === returned
      ? `setpts=N/(${fps}*TB)`
      : `setpts=N*${sent / returned}/(${fps}*TB)`;
  const aligned = join(directory, "cutout-aligned.webm");
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-c:v",
      "libvpx-vp9",
      "-i",
      path,
      "-vf",
      `${retime},fps=${fps},format=yuva420p${window.start > 0 ? `,tpad=start_duration=${window.start}:start_mode=add:color=0x00000000` : ""}`,
      "-c:v",
      "libvpx-vp9",
      "-pix_fmt",
      "yuva420p",
      "-auto-alt-ref",
      "0",
      "-metadata:s:v:0",
      "alpha_mode=1",
      "-b:v",
      "0",
      "-crf",
      "18",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
      "-row-mt",
      "1",
      "-an",
      "-y",
      aligned,
    ],
    { signal, timeout: 1_800_000, maxBuffer: 1024 * 1024 },
  );
  path = aligned;
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height",
      "-of",
      "json",
      path,
    ],
    { signal, timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const probe = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
    }[];
  };
  const stream = probe.streams?.find((item) => item.codec_type === "video"),
    duration = Number(probe.format?.duration);
  if (
    !stream?.width ||
    !stream.height ||
    stream.codec_name !== "vp9" ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new AnalysisError("The background-removed video is unreadable.", 502);
  onProgress(90);
  return { path, duration, width: stream.width, height: stream.height, ...(boxes ? { subjectMask: { fps, boxes } } : {}) };
}

async function frameCount(path: string, signal: AbortSignal) {
  // Packets equal frames for these single-stream H.264/VP9 files; counting them skips decoding.
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
      path,
    ],
    { signal, timeout: 60_000 },
  );
  const count = Number(stdout.trim());
  if (!Number.isInteger(count) || count < 1)
    throw new AnalysisError("The background-removed video has no frames.", 502);
  return count;
}

async function anyOpaque(path: string, signal: AbortSignal) {
  // A tiny alpha thumbnail per frame catches empty mattes before placing the result.
  const { stdout } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-c:v",
      "libvpx-vp9",
      "-i",
      path,
      "-vf",
      "alphaextract,scale=32:32,format=gray",
      "-f",
      "rawvideo",
      "-",
    ],
    {
      signal,
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "buffer",
    },
  );
  return stdout.some((value) => value > 128);
}
