import { layerGroup, normalizeTimeline, timelineDuration, trackOf, type Timeline } from "../../lib/editor/types";

/** Visual coverage gaps and same-layer collisions; stacked layers are intentional. */
export function summarizeTimeline(timeline: Timeline, assets: { _id: string; kind: string }[]) {
  timeline = normalizeTimeline(timeline);
  const duration = timelineDuration(timeline);
  const gaps: { start: number; end: number }[] = [];
  let coveredUntil = 0;
  for (const clip of timeline.clips.filter(clip => clip.kind === "video" || clip.kind === "image").sort((a, b) => a.start - b.start)) {
    if (clip.start > coveredUntil + 0.000001) gaps.push({ start: coveredUntil, end: clip.start });
    coveredUntil = Math.max(coveredUntil, clip.start + clip.duration);
  }
  if (duration > coveredUntil + 0.000001) gaps.push({ start: coveredUntil, end: duration });

  const overlaps: { group: "visual" | "overlay" | "audio"; track: number; clipIds: string[]; start: number; end: number }[] = [];
  let overlapCount = 0;
  for (let first = 0; first < timeline.clips.length; first++) {
    const a = timeline.clips[first];
    for (let second = first + 1; second < timeline.clips.length; second++) {
      const b = timeline.clips[second];
      if (layerGroup(a.kind) !== layerGroup(b.kind) || trackOf(a) !== trackOf(b)) continue;
      const start = Math.max(a.start, b.start); const end = Math.min(a.start + a.duration, b.start + b.duration);
      if (end <= start + 0.000001) continue;
      overlapCount++;
      if (overlaps.length < 100) overlaps.push({ group: layerGroup(a.kind), track: trackOf(a), clipIds: [a.id, b.id], start, end });
    }
  }
  const assetById = new Map(assets.map(asset => [asset._id, asset]));
  const missingAssetRefs = timeline.clips.filter(clip => ["video", "image", "audio"].includes(clip.kind) && (!clip.assetId || assetById.get(clip.assetId)?.kind !== clip.kind)).map(clip => ({ clipId: clip.id, assetId: clip.assetId ?? null }));
  return { duration, clipCount: timeline.clips.length, gaps, gapScope: "visual coverage" as const, overlaps, overlapScope: "same group and track" as const, overlapCount, overlapsTruncated: overlapCount > overlaps.length, missingAssetRefs };
}
