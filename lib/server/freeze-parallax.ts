import { processingThreads } from './processing-resources';
import {
  foregroundMask,
  subjectPrompt,
  type SubjectSelection,
} from "./subject-segmentation";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AnalysisError } from "../media-analysis/errors";
import { download, requireFal, subscribe } from "./fal";
import { freezeStill, type DerivedFile } from "./freeze-still";

const run = promisify(execFile);
const PARALLAX_MODELS = {
  depth: "fal-ai/image-preprocessors/depth-anything/v2",
  matte: "fal-ai/birefnet/v2",
  inpaint: "fal-ai/fast-sdxl/inpainting",
} as const;
const imageResult = z.object({ image: z.object({ url: z.string().url() }) });
const inpaintResult = z.object({
  images: z.array(z.object({ url: z.string().url() })).min(1),
});
const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .min(1),
});

/** Worker-only model inference. A single bounded atlas retains all layers for the shared WebGL renderer. */
export async function freezeParallax(
  source: string,
  kind: "video" | "image",
  directory: string,
  time: number,
  backgroundPrompt: string | undefined,
  signal: AbortSignal,
  onProgress: (value: number) => void,
  selection?: SubjectSelection,
): Promise<DerivedFile> {
  const fal = requireFal("Parallax needs FAL_KEY on the media worker.");
  const still =
    kind === "video"
      ? (await freezeStill(source, directory, time, signal)).path
      : source;
  const frame = join(directory, "parallax-frame.png");
  // Preserve the frame aspect ratio and cap the atlas to 3840 pixels per side.
  await ffmpeg(
    [
      "-i",
      still,
      "-vf",
      "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=8",
      "-frames:v",
      "1",
      frame,
    ],
    signal,
  );
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
      frame,
    ],
    { signal, timeout: 30_000 },
  );
  const { width, height } = probeSchema.parse(JSON.parse(stdout)).streams[0];
  const url = await fal.storage.upload(
    new Blob([await readFile(frame)], { type: "image/png" }),
  );
  signal.throwIfAborted();
  onProgress(12);
  const depth = imageResult.parse(
    await subscribe(fal, PARALLAX_MODELS.depth, { image_url: url }, signal),
  );
  const depthPath = join(directory, "parallax-depth.png");
  await download(depth.image.url, depthPath, signal, 32 * 1024 * 1024);
  onProgress(30);
  const prompt = selection
    ? await subjectPrompt(source, directory, selection, width, height, signal)
    : undefined;
  const mask = await foregroundMask(fal, frame, directory, signal, prompt),
    expanded = join(directory, "parallax-hole.png");
  // Extend the hole beyond soft matte edges so moving the foreground exposes no halo.
  await ffmpeg(
    [
      "-i",
      mask,
      "-vf",
      "dilation,dilation,dilation,dilation,gblur=sigma=2",
      "-frames:v",
      "1",
      expanded,
    ],
    signal,
  );
  const maskUrl = await fal.storage.upload(
    new Blob([await readFile(expanded)], { type: "image/png" }),
  );
  onProgress(48);
  const fill = inpaintResult.parse(
    await subscribe(
      fal,
      PARALLAX_MODELS.inpaint,
      {
        image_url: url,
        mask_url: maskUrl,
        prompt:
          backgroundPrompt ??
          "Empty environment, seamless continuation of the surrounding background, consistent perspective, lighting and textures, no foreground subject.",
        negative_prompt:
          "person, character, weapon, text, watermark, duplicate foreground object",
        image_size: { width, height },
        num_inference_steps: 25,
        strength: 0.99,
        seed: 17,
        num_images: 1,
        format: "png",
      },
      signal,
    ),
  );
  const fillPath = join(directory, "parallax-fill.png");
  await download(fill.images[0].url, fillPath, signal, 32 * 1024 * 1024);
  onProgress(78);
  const atlas = join(directory, "parallax-atlas.png");
  // Preserve original pixels outside the inpaint mask. Top: background/source. Bottom: matte/depth.
  const filter = `[0:v]format=rgb24,split=2[original][front];[1:v]scale=${width}:${height},format=rgb24[fill];[2:v]format=gray[hole];[original][fill][hole]maskedmerge[back];[3:v]format=rgb24[mask];[4:v]scale=${width}:${height},format=rgb24[depth];[back][front][mask][depth]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,format=rgb24[out]`;
  await ffmpeg(
    [
      "-i",
      frame,
      "-i",
      fillPath,
      "-i",
      expanded,
      "-i",
      mask,
      "-i",
      depthPath,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "-pred",
      "mixed",
      "-compression_level",
      "9",
      atlas,
    ],
    signal,
  );
  if ((await stat(atlas)).size > 24 * 1024 * 1024)
    throw new AnalysisError(
      "The parallax atlas is too large. Use a smaller source frame.",
      400,
    );
  onProgress(94);
  return {
    path: atlas,
    kind: "image",
    contentType: "image/png",
    width: width * 2,
    height: height * 2,
  };
}

async function ffmpeg(args: string[], signal: AbortSignal) {
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      String(processingThreads()),
      "-filter_complex_threads",
      "1",
      ...args,
      "-y",
    ],
    { signal, timeout: 180_000, maxBuffer: 1024 * 1024 },
  );
}
