import { z } from "zod";
import { sourceEndOf, sourceTimeAt, timelineTimeAtSource } from "../editor/playback-rate";
import { timelineNormalizationKey } from "../editor/audio-normalization";
import {
  dimensions,
  timelineDuration,
  type Timeline,
  type MediaAsset,
  type Clip,
} from "../editor/types";
import { calculateVisualRect } from "../editor/visual-source-geometry";
import { textStyle } from "../editor/text-style";
import { readHighlights, thoughtStart } from "./highlights";

export const clipCheckRequest = z.object({
  reviewMode: z.enum(["transcript", "visual", "data"]).optional(),
  qualityChecks: z.array(z.enum(["framing", "decode-health", "loudness"])).optional(),
  assetId: z.string(),
  start: z.number(),
  end: z.number(),
  payoffEnd: z.number(),
  reactionEnd: z.number(),
  criticalRegions: z
    .array(
      z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    )
    .max(12)
    .default([]),
});
export type ClipCheckRequest = z.infer<typeof clipCheckRequest>;
export const clipCheckResult = z.object({
  passed: z.boolean(),
  checks: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      reasons: z.array(z.string()),
    }),
  ),
  warnings: z.array(z.string()),
  sampleTimes: z.array(z.number()),
  healthBasis: z.enum(["source-ranges", "transcript-data", "timeline-data"]),
  skippedChecks: z.array(z.string()).optional(),
});
export type ClipCheckResult = z.infer<typeof clipCheckResult>;
export const timelineFingerprint = (timeline: Timeline) => {
  const value = JSON.stringify(timeline, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return `${value.length}:${a >>> 0}:${b >>> 0}`;
};

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function unionGaps(
  ranges: { start: number; end: number }[],
  end: number,
  tolerance: number,
) {
  let at = 0;
  const gaps: string[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.start > at + tolerance)
      gaps.push(`${at.toFixed(2)}-${range.start.toFixed(2)}s`);
    at = Math.max(at, range.end);
  }
  if (at < end - tolerance) gaps.push(`${at.toFixed(2)}-${end.toFixed(2)}s`);
  return gaps;
}

/**
 * The source footage of one asset a tab keeps: visible video clips merged into
 * source ranges (a split at a cut point or a stacked synchronized copy stays
 * one range) plus the delivered timeline duration. One range is a contiguous
 * short; several ranges are a montage cut from more than one stretch.
 */
export function retainedFootage(timeline: Timeline, assetId: string) {
  const epsilon = 1 / timeline.fps + 0.015;
  const videos = timeline.clips.filter(
    (c) =>
      c.kind === "video" &&
      c.assetId === assetId &&
      (c.transform?.opacity ?? 1) > 0,
  );
  const ranges: { start: number; end: number }[] = [];
  for (const range of videos
    .map((c) => ({ start: c.sourceStart, end: sourceEndOf(c) }))
    .sort((a, b) => a.start - b.start)) {
    const last = ranges.at(-1);
    if (last && range.start <= last.end + epsilon)
      last.end = Math.max(last.end, range.end);
    else ranges.push(range);
  }
  return { duration: timelineDuration(timeline), epsilon, ranges, videos };
}
export type RetainedFootage = ReturnType<typeof retainedFootage>;

/** All checks except source decode health use timeline, word, audio and geometry data. */
export function checkClipData(
  timeline: Timeline,
  assets: MediaAsset[],
  request: ClipCheckRequest,
): ClipCheckResult {
  const transcriptOnly = request.reviewMode === "transcript";
  const quality = request.qualityChecks ?? [];
  const framing = quality.includes('framing');
  const footage = retainedFootage(timeline, request.assetId),
    { duration, epsilon, videos } = footage,
    checks: ClipCheckResult["checks"] = [],
    warnings: string[] = [];
  const check = (name: string, reasons: string[]) =>
    checks.push({ name, passed: !reasons.length, reasons });
  const source = assets.find((a) => a._id === request.assetId),
    words = source?.analysis?.transcript?.words ?? [],
    tracks = readHighlights(source?.analysis?.highlights);
  // A montage keeps the payoff and reaction inside one of its retained ranges;
  // for a contiguous short that is the usual "ends after the payoff" rule.
  const retains = (at: number) =>
    footage.ranges.some(
      (r) => r.start <= at + epsilon && r.end >= at - epsilon,
    );
  check(
    "duration",
    duration >= 15 - epsilon && duration <= 60 + epsilon
      ? []
      : [`Duration ${duration.toFixed(3)}s must be 15-60s.`],
  );
  check(
    "coverage",
    videos.length
      ? unionGaps(
          videos.map((c) => ({ start: c.start, end: c.start + c.duration })),
          duration,
          epsilon,
        )
      : [
          "No populated source video; empty, title-only and unrelated tabs cannot count as a clip.",
        ],
  );
  const sourceStart = footage.ranges[0]?.start ?? NaN,
    sourceEnd = footage.ranges.at(-1)?.end ?? NaN;
  check(
    "accepted-range",
    Math.abs(sourceStart - request.start) <= epsilon &&
      Math.abs(sourceEnd - request.end) <= epsilon
      ? []
      : [
          videos.length
            ? `Source span ${sourceStart}-${sourceEnd}s does not match accepted ${request.start}-${request.end}s.`
            : "There is no retained source range.",
        ],
  );
  check("source-bounds", videos.length && source?.duration && videos.every(c =>
    c.sourceStart >= 0 && sourceTimeAt(c, c.start + c.duration) <= source.duration! + epsilon)
    ? [] : ["Retained footage must lie within the source duration."]);
  const boundary: string[] = [];

  if (transcriptOnly && !words.length) boundary.push("Saved word timings are required for transcript-first clipping.");
  if (words.length) {
    if (
      words.some(
        (w) => w.start < sourceStart - 0.025 && w.end > sourceStart + 0.025,
      )
    )
      boundary.push("The in point cuts through a word.");
    if (
      words.some(
        (w) => w.start < sourceEnd - 0.025 && w.end > sourceEnd + 0.025,
      )
    )
      boundary.push("The out point cuts through a word.");
    // A montage's inner cuts have no pause rule, but they must not split words.
    const inner = footage.ranges
      .flatMap((r) => [r.start, r.end])
      .filter((at) => at !== sourceStart && at !== sourceEnd);
    for (const at of inner)
      if (words.some((w) => w.start < at - 0.025 && w.end > at + 0.025))
        boundary.push(`The cut at source ${at.toFixed(2)}s splits a word.`);
    const first = words.findIndex(
      (w) => w.end > sourceStart + 0.025 && w.start < sourceEnd,
    );
    if (first >= 0 && !thoughtStart(words, first))
      boundary.push(
        "The clip begins mid-thought; include the sentence or a measured pause.",
      );
    const last = words
        .filter((w) => w.start < sourceEnd && w.end <= sourceEnd + 0.025)
        .at(-1),
      next = words.find((w) => w.start >= sourceEnd - 0.025);
    if (
      last &&
      next &&
      next.start - last.end < 0.25 &&
      sourceEnd < (source?.duration ?? 0) - 0.15
    )
      boundary.push("The out point has no word-timed pause.");
  } else
    warnings.push(
      "No spoken words; boundaries rely on measured audio and reviewed event context.",
    );
  if (videos.length && !retains(request.payoffEnd))
    boundary.push(`The payoff continues until ${request.payoffEnd}s.`);
  if (videos.length && !retains(request.reactionEnd))
    boundary.push(
      `The observed reaction continues until ${request.reactionEnd}s.`,
    );
  if (!words.length && tracks?.levels.length) {
    const index = Math.floor(sourceEnd / 0.5),
      level = (tracks.levels[index] ?? -1200) / 10,
      before = tracks.levels
        .slice(Math.max(0, index - 60), index)
        .sort((a, b) => a - b);
    const baseline = (before[Math.floor(before.length / 2)] ?? -1200) / 10;
    if (level > baseline - 6 && sourceEnd < (source?.duration ?? 0) - 0.25)
      boundary.push(
        "No measured quiet out point; extend through the reaction into an audio pause.",
      );
  }
  check("boundaries", boundary);
  const skippedChecks = ['framing', 'decode-health', 'loudness'].filter(c => !quality.includes(c as typeof quality[number]));
  warnings.push(`Checks skipped: ${skippedChecks.join(', ') || 'none'}.`);
  if (!framing) skippedChecks.push('caption-geometry');
  if (!framing && !quality.includes('loudness')) return {
    passed: checks.every(c => c.passed), checks, warnings,
    sampleTimes: [], healthBasis: transcriptOnly ? 'transcript-data' : 'timeline-data', skippedChecks,
  };
  const master = timeline.audioNormalization;
  if (quality.includes("loudness")) check(
    "loudness",
    master?.key === timelineNormalizationKey(timeline) &&
      master.outputLufs !== undefined &&
      Math.abs(master.outputLufs + 14) <= 0.7 &&
      master.measuredTruePeak !== undefined &&
      master.measuredTruePeak <= -1
      ? []
      : [
          "No current verified loudness measurement. Normalize only if the user requests audio improvement.",
        ],
  );
  const captionReasons: string[] = [];
  const size = dimensions(timeline.aspectRatio, 1080);
  if (
    timeline.clips.some((c) => c.kind === "caption" || c.kind === "graphic") &&
    tracks &&
    ["gaming", "sports"].includes(tracks.sourceType) &&
    !request.criticalRegions.length
  )
    captionReasons.push(
      "Record the critical HUD/score/action source rectangles in planClips before checking captions.",
    );
  for (const caption of (framing ? timeline.clips : []).filter(
    (c) => c.kind === "caption" || c.kind === "graphic",
  )) {
    const style = textStyle(caption),
      width = Math.min(
        size.width * 0.92,
        Math.max(
          style.fontSize,
          ...(caption.text ?? "")
            .split("\n")
            .map((line) => line.length * style.fontSize * 0.62),
        ) +
          style.paddingX * 2,
      ),
      lines = Math.max(
        1,
        Math.ceil(
          ((caption.text ?? "").length * style.fontSize * 0.62) /
            Math.max(1, width),
        ),
      );
    const height =
      lines * style.fontSize * style.lineHeight + style.paddingY * 2;
    const box = {
      x: style.x - width / (2 * size.width),
      y: style.y - height / (2 * size.height),
      w: width / size.width,
      h: height / size.height,
    };
    const localVideos = videos.filter(
      (c) =>
        c.start < caption.start + caption.duration &&
        c.start + c.duration > caption.start,
    );
    for (const video of localVideos) {
      if (!source?.width || !source.height) {
        captionReasons.push(
          `${caption.id}: source dimensions unavailable for collision checks.`,
        );
        continue;
      }
      const at = sourceTimeAt(video, Math.max(video.start, caption.start));
      const faces =
        source.analysis?.facecam?.samples
          .filter(
            (s) =>
              s.facecam &&
              s.time >= video.sourceStart - 30 &&
              s.time <= sourceTimeAt(video, video.start + video.duration) + 30,
          )
          .map((s) => s.facecam!) ?? [];
      const speakerFaces =
        source.analysis?.speakers?.turns
          .filter(
            (t) => t.face && t.start <= at + caption.duration && t.end >= at,
          )
          .map((t) => t.face!) ?? [];
      const regions = [...faces, ...speakerFaces, ...request.criticalRegions];
      const measuredNoFace = source.analysis?.facecam?.samples.some(
        (s) => Math.abs(s.time - at) <= 30 && s.kind === "gameplay-only",
      );
      if (!regions.length && !measuredNoFace)
        captionReasons.push(
          `${caption.id}: no measured face/facecam or critical region geometry; detect framing before checking captions.`,
        );
      for (const region of regions) {
        const projected = projectRegion(
          video,
          source,
          region,
          Math.max(video.start, caption.start),
          timeline.aspectRatio,
        );
        if (projected && overlaps(box, projected))
          captionReasons.push(
            `${caption.id}: conservative text bounds overlap a face, facecam or critical HUD region.`,
          );
      }
    }
  }
  if (timeline.clips.some((c) => c.kind === "caption" || c.kind === "graphic"))
    warnings.push(
      "Caption collision bounds are conservative text geometry; move flagged text or reduce it.",
    );
  if (framing) check("captions", [...new Set(captionReasons)]);
  return {
    passed: checks.every((c) => c.passed),
    checks,
    warnings,
    sampleTimes: framing ? clipContactTimes(timeline, source) : [],
    skippedChecks,
    healthBasis: quality.includes("decode-health") ? "source-ranges" : "timeline-data",
  };
}

function projectRegion(
  clip: Clip,
  source: MediaAsset,
  box: { x: number; y: number; w: number; h: number },
  time: number,
  aspectRatio: Timeline["aspectRatio"],
) {
  const frame = dimensions(aspectRatio, 1080),
    focus = [...(clip.focus ?? [])].reverse().find((p) => p.time <= time),
    r = calculateVisualRect(
      source.width!,
      source.height!,
      frame.width,
      frame.height,
      clip.crop,
      focus,
      clip.fit,
    ),
    t = clip.transform;
  const scale = t?.scale ?? 1;
  const left = Math.max(r.window.left, r.left + box.x * r.width),
    top = Math.max(r.window.top, r.top + box.y * r.height),
    right = Math.min(
      r.window.left + r.window.width,
      r.left + (box.x + box.w) * r.width,
    ),
    bottom = Math.min(
      r.window.top + r.window.height,
      r.top + (box.y + box.h) * r.height,
    );
  if (right <= left || bottom <= top) return null;
  const x =
      ((left - frame.width / 2) * scale + frame.width * (t?.x ?? 0.5)) /
      frame.width,
    y =
      ((top - frame.height / 2) * scale + frame.height * (t?.y ?? 0.5)) /
      frame.height;
  const x2 = x + ((right - left) * scale) / frame.width,
    y2 = y + ((bottom - top) * scale) / frame.height;
  return x2 > 0 && y2 > 0 && x < 1 && y < 1
    ? {
        x: Math.max(0, x),
        y: Math.max(0, y),
        w: Math.min(1, x2) - Math.max(0, x),
        h: Math.min(1, y2) - Math.max(0, y),
      }
    : null;
}
export function clipContactTimes(timeline: Timeline, source?: MediaAsset) {
  const duration = timelineDuration(timeline),
    frame = 1 / timeline.fps,
    cuts = new Set([0, Math.max(0, duration - frame)]);
  for (const clip of timeline.clips.filter((c) => c.kind === "video")) {
    cuts.add(clip.start);
    cuts.add(Math.max(clip.start, clip.start + clip.duration - frame));
    const sourceCuts =
      source?.analysis?.shots?.shots.map((s) => s.start) ??
      readHighlights(source?.analysis?.highlights)?.sceneCuts ??
      [];
    const speakers = source?.analysis?.speakers;
    const speakerCuts =
      speakers?.version === 2
        ? speakers.framing
            .filter(
              (s, i) =>
                !i ||
                s.shot !== speakers.framing[i - 1].shot ||
                s.faceId !== speakers.framing[i - 1].faceId,
            )
            .map((s) => s.start)
        : (speakers?.turns
            .filter((s, i) => !i || s.speaker !== speakers.turns[i - 1].speaker)
            .map((s) => s.start) ?? []);
    const layouts =
      source?.analysis?.facecam?.samples
        .filter(
          (s, i, all) =>
            !i ||
            s.kind !== all[i - 1].kind ||
            JSON.stringify(s.facecam) !== JSON.stringify(all[i - 1].facecam),
        )
        .map((s) => s.time) ?? [];
    const switches = [...sourceCuts, ...speakerCuts, ...layouts, ...(clip.framingCuts ?? [])];
    for (const at of switches) {
      const local = timelineTimeAtSource(clip, at);
      if (local > clip.start && local < clip.start + clip.duration)
        cuts.add(local);
    }
  }
  const ordered = [...cuts].sort((a, b) => a - b),
    samples = new Set<number>();
  for (let i = 0; i < ordered.length - 1; i++) {
    samples.add(ordered[i]);
    samples.add((ordered[i] + ordered[i + 1]) / 2);
    samples.add(Math.max(ordered[i], ordered[i + 1] - frame));
  }
  const times = [...samples]
    .filter((t) => t >= 0 && t < duration)
    .sort((a, b) => a - b);
  // Preserve every shot/switch. Typical clips have 6-12 samples; a cut-heavy
  // clip gets a taller single sheet rather than silently dropping coverage.
  return times;
}
