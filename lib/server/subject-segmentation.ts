import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { type PixelTrackRequest } from "../media-analysis/pixel-track";
import { AnalysisError } from "../media-analysis/errors";
import { localizeTrackingObject } from "./localize-tracking-object";
import { download, subscribe, type FalClient } from "./fal";
import { paintMasks, requireMetaSam, segmentImage } from "./meta-sam";

export type SubjectSelection = Pick<PixelTrackRequest, "time" | "seed" | "segmenter">;
const imageResult = z.object({ image: z.object({ url: z.string().url() }) });
/** fal SAM2 serves Revline's in-app agent; MCP selections with segmenter 'sam-3.1' use meta-sam.ts instead. */
export const SUBJECT_MODELS = {
  image: "fal-ai/sam2/image",
  video: "fal-ai/sam2/video",
  automatic: "fal-ai/sam2/auto-segment",
};
/** A selected subject in source pixels; box right/bottom are exclusive. */
export type SubjectPrompt =
  | { kind: "point"; x: number; y: number }
  | { kind: "box"; left: number; top: number; right: number; bottom: number };

export async function subjectPrompt(
  source: string,
  directory: string,
  selection: SubjectSelection,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<SubjectPrompt> {
  let seed = selection.seed;
  if (seed.kind === "object")
    seed = {
      kind: "box",
      box: (
        await localizeTrackingObject(
          source,
          directory,
          selection.time,
          seed.noun,
          signal,
          selection.segmenter,
        )
      ).box,
    };
  return seed.kind === "point"
    ? {
        kind: "point",
        x: Math.min(width - 1, Math.round(seed.x * width)),
        y: Math.min(height - 1, Math.round(seed.y * height)),
      }
    : {
        kind: "box",
        left: Math.floor(seed.box.left * width),
        top: Math.floor(seed.box.top * height),
        right: Math.ceil(seed.box.right * width),
        bottom: Math.ceil(seed.box.bottom * height),
      };
}

/** The SAM2 prompt fields fal expects. */
export function falSubjectPrompt(prompt: SubjectPrompt, frame_index?: number) {
  const frame = frame_index === undefined ? {} : { frame_index };
  return prompt.kind === "point"
    ? { prompts: [{ x: prompt.x, y: prompt.y, label: 1, ...frame }] }
    : { box_prompts: [{ x_min: prompt.left, y_min: prompt.top, x_max: prompt.right, y_max: prompt.bottom, ...frame }] };
}

/** The SAM 3.1 object prompt for the same subject. */
export const samSubjectPrompt = (prompt: SubjectPrompt, frame = 0) =>
  prompt.kind === "point"
    ? { kind: "object" as const, frame, point: { x: prompt.x, y: prompt.y } }
    : { kind: "object" as const, frame, box: prompt };

/** Return a grayscale alpha mask, retaining native subject pixels for compositing. */
export async function foregroundMask(
  fal: FalClient,
  frame: string,
  directory: string,
  signal: AbortSignal,
  prompt?: SubjectPrompt,
  segmenter?: SubjectSelection["segmenter"],
) {
  const raw = join(directory, "subject-mask-raw.png"),
    output = join(directory, "subject-mask.png");
  const { width, height } = await sharp(frame).metadata();
  if (!width || !height)
    throw new AnalysisError("The subject frame has no dimensions.", 422);
  const save = async (url: string) => {
    await download(url, raw, signal, 32 * 1024 * 1024);
    await sharp(raw)
      .resize(width, height)
      .removeAlpha()
      .grayscale()
      .png()
      .toFile(output);
    return check();
  };
  const check = async () => {
    const { data } = await sharp(output)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (const value of data) if (value > 128) opaque++;
    return opaque >= 8 && opaque < width * height * 0.9;
  };
  if (prompt && segmenter === "sam-3.1") {
    // MCP selections: SAM 3.1 on Meta only, never SAM2.
    const masks = await segmentImage(
      requireMetaSam(),
      { data: await readFile(frame), mime: "image/png" },
      samSubjectPrompt(prompt),
      { width, height },
      signal,
    );
    await sharp(Buffer.from(paintMasks(masks, { width, height })), {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toFile(output);
    if (masks.length && (await check())) return output;
    throw new AnalysisError(
      "SAM 3.1 found no usable mask for this selection. Choose another source point or a box around the visible subject.",
      422,
      false,
    );
  }
  const url = await fal.storage.upload(
    new Blob([await readFile(frame)], { type: "image/png" }),
  );
  if (prompt) {
    const result = imageResult.parse(
      await subscribe(
        fal,
        SUBJECT_MODELS.image,
        {
          image_url: url,
          ...falSubjectPrompt(prompt),
          apply_mask: false,
          output_format: "png",
        },
        signal,
      ),
    );
    if (await save(result.image.url)) return output;
  } else {
    try {
      const result = imageResult.parse(
        await subscribe(
          fal,
          "fal-ai/birefnet/v2",
          {
            image_url: url,
            model: "General Use (Light)",
            mask_only: true,
            output_format: "png",
          },
          signal,
        ),
      );
      if (await save(result.image.url)) return output;
    } catch {
      signal.throwIfAborted();
    }
    const result = z
      .object({
        individual_masks: z.array(z.object({ url: z.string().url() })),
      })
      .parse(
        await subscribe(
          fal,
          SUBJECT_MODELS.automatic,
          { image_url: url, output_format: "png" },
          signal,
        ),
      );
    // Reject full-frame/background regions and select the strongest central object.
    let best: { data: Buffer; score: number } | undefined;
    for (const mask of result.individual_masks) {
      await download(mask.url, raw, signal, 32 * 1024 * 1024);
      const data = await readFile(raw),
        { data: pixels } = await sharp(data)
          .resize(64, 64)
          .removeAlpha()
          .grayscale()
          .raw()
          .toBuffer({ resolveWithObject: true });
      let area = 0,
        x = 0,
        y = 0;
      for (let i = 0; i < pixels.length; i++)
        if (pixels[i] > 128) {
          area++;
          x += i % 64;
          y += Math.floor(i / 64);
        }
      if (area < 8 || area > 4096 * 0.6) continue;
      const score =
        Math.sqrt(area) / (1 + Math.hypot(x / area - 32, y / area - 32));
      if (!best || score > best.score) best = { data, score };
    }
    if (best) {
      await sharp(best.data)
        .resize(width, height)
        .removeAlpha()
        .grayscale()
        .png()
        .toFile(output);
      return output;
    }
  }
  throw new AnalysisError(
    "No usable subject mask was found. Choose a source point or a box around the visible subject.",
    422,
  );
}
