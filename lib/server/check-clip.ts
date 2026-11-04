import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import sharp from "sharp";
import type { MediaWorkItem, MediaTaskResult } from "../../convex/mediaTasks";
import {
  checkClipData,
  clipCheckRequest,
  type ClipCheckResult,
} from "../media-analysis/clip-check";
import { sourceEndOf } from "../editor/playback-rate";
import type { FrameCache } from './frame-cache';
import { captureTimelineFrames } from "./review-composition";
import { ownedMediaUrl } from "./owned-media";
import { mediaSourceCacheIdentity, reuseCachedMediaFile } from "./media-file-cache";
const run = promisify(execFile);

/** Source health is one FFmpeg decode per distinct retained range, never an
 * export. The only rendered pictures are this one small framing contact sheet. */
export async function checkClipSnapshot(
  snapshot: NonNullable<MediaWorkItem["snapshot"]>,
  directory: string,
  convexUrl: string,
  signal: AbortSignal,
  progress: (n: number) => void,
  cache?: FrameCache,
): Promise<NonNullable<MediaTaskResult["snapshot"]>> {
  const request = clipCheckRequest.parse(snapshot.clipCheck),
    result = checkClipData(snapshot.timeline, snapshot.assets, request);
  const health: string[] = [],
    overrides = snapshot.clipCheck?.acceptedFindings ?? [];
  const quality = snapshot.clipCheck?.qualityChecks ?? [];
  const seen = new Set<string>();
  for (const clip of (quality.includes("decode-health") ? snapshot.timeline.clips : []).filter(
    (c) => c.kind === "video" && c.assetId,
  )) {
    const asset = snapshot.assets.find((a) => a._id === clip.assetId),
      key = `${clip.assetId}:${clip.sourceStart}:${sourceEndOf(clip)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!asset?.url) {
      health.push(`Source ${clip.assetId} is unavailable for decode health.`);
      continue;
    }
    try {
      const localSource=join(directory,`health-source-${seen.size}`);
      const cached=await reuseCachedMediaFile({identity:mediaSourceCacheIdentity(convexUrl,asset.projectId,asset),variant:'source-v1',target:localSource,expectedBytes:asset.size,signal});
      const { stderr } = await run(
        "ffmpeg",
        [
          "-hide_banner",
          "-nostdin",
          "-ss",
          String(clip.sourceStart),
          "-i",
          cached?localSource:ownedMediaUrl(asset.url, new URL(convexUrl).origin),
          "-t",
          String(sourceEndOf(clip) - clip.sourceStart),
          "-map",
          "0:v:0",
          "-an",
          "-vf",
          "blackdetect=d=0.12:pix_th=0.10,freezedetect=n=-50dB:d=1.5",
          "-f",
          "null",
          "-",
        ],
        { signal, maxBuffer: 2 * 1024 * 1024 },
      );
      for (const [kind, pattern] of [
        ["black", /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g],
        ["freeze", /freeze_start:\s*([\d.]+)/g],
      ] as const) {
        for (const match of stderr.matchAll(pattern)) {
          const reason = `${kind} detected at source ${(clip.sourceStart + Number(match[1])).toFixed(2)}s${match[2] ? `-${(clip.sourceStart + Number(match[2])).toFixed(2)}s` : ""}`;
          const override = overrides.find(
            (o) => o.kind === kind && o.reason.trim().length >= 15,
          );
          if (override)
            result.warnings.push(
              `${reason}; reviewed intentional: ${override.reason}`,
            );
          else
            health.push(
              `${reason}. Review whether intentional, fix it or record a specific acceptedFindings reason.`,
            );
        }
      }
      if (
        /corrupt|error while decoding|invalid nal|concealing \d+/i.test(stderr)
      )
        health.push(
          `Decode corruption in source range ${clip.sourceStart}-${sourceEndOf(clip)}s.`,
        );
    } catch (error) {
      signal.throwIfAborted();
      health.push(
        `Source health decode failed: ${error instanceof Error ? error.message.slice(0, 180) : "ffmpeg error"}`,
      );
    }
  }
  if (quality.includes("decode-health")) result.checks.push({
    name: "decode-health",
    passed: !health.length,
    reasons: health,
  });
  result.passed = result.checks.every((c) => c.passed);
  if (result.sampleTimes.length > 12)
    result.warnings.push(
      `This cut-heavy clip needs ${result.sampleTimes.length} shot/switch samples on its one sheet.`,
    );
  if (!quality.includes('framing')) return { frames: [], clipCheck: JSON.stringify(result) };
  const captured = await captureTimelineFrames(
    { ...snapshot, clipCheck: undefined, times: result.sampleTimes },
    directory,
    convexUrl,
    signal,
    (n) => progress(30 + n * 0.65),
    cache,
    true,
  );
  const sheet = await contactSheet(captured.frames, result);
  return {
    frames: [{ time: 0, image: sheet.toString("base64") }],
    clipCheck: JSON.stringify(result),
  };
}

async function contactSheet(
  frames: { time: number; image: string }[],
  result: ClipCheckResult,
) {
  const width = 200,
    height = 380,
    label = 24,
    columns = Math.min(6, frames.length),
    rows = Math.ceil(frames.length / columns);
  const tiles = await Promise.all(
    frames.map(async (frame, index) => {
      const picture = await sharp(Buffer.from(frame.image, "base64"))
        .resize(width, height - label, {
          fit: "contain",
          background: "#222222",
        })
        .jpeg()
        .toBuffer();
      const text = Buffer.from(
        `<svg width="${width}" height="${label}"><rect width="100%" height="100%" fill="#222"/><text x="8" y="17" fill="white" font-size="13">${frame.time.toFixed(2)}s</text></svg>`,
      );
      return [
        {
          input: picture,
          left: (index % columns) * width,
          top: Math.floor(index / columns) * height,
        },
        {
          input: text,
          left: (index % columns) * width,
          top: Math.floor(index / columns) * height + height - label,
        },
      ];
    }),
  );
  if (!frames.length) throw new Error("No framing samples were rendered.");
  result.warnings.push(
    "This contact sheet covers sampled edited framing only; it does not certify every rendered frame or unrequested source-health checks.",
  );
  return sharp({
    create: {
      width: columns * width,
      height: rows * height,
      channels: 3,
      background: "#222222",
    },
  })
    .composite(tiles.flat())
    .jpeg({ quality: 75 })
    .toBuffer();
}
