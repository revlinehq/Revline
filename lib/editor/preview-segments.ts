import { sourceEndOf } from './playback-rate';
import type { MediaAsset, Timeline } from './types';

export type SourceRange = { start: number; end: number };
export type PreviewSegment = SourceRange & { url: string; size: number };
const PREVIEW_CHUNK_SECONDS = 30;
const PADDING_SECONDS = 2;

export function previewChunks(duration: number, ranges: SourceRange[], boundaries?: number[]) {
  const chunks: SourceRange[] = [];
  const starts =
    boundaries ??
    Array.from({ length: Math.ceil(duration / PREVIEW_CHUNK_SECONDS) }, (_, index) => index * PREVIEW_CHUNK_SECONDS);
  for (const [index, start] of starts.entries()) chunks.push({ start, end: starts[index + 1] ?? duration });
  const used = paddedPreviewRanges(duration, ranges);
  const priority = chunks.filter((chunk) =>
    used.some((range) =>
      boundaries
        ? (chunk.start + chunk.end) / 2 >= range.start && (chunk.start + chunk.end) / 2 < range.end
        : chunk.end > range.start && chunk.start < range.end,
    ),
  );
  const selected = new Set(priority);
  return {
    priority,
    background: chunks.filter((chunk) => !selected.has(chunk)),
  };
}

export function paddedPreviewRanges(duration: number, ranges: SourceRange[]) {
  const used = (ranges.length ? ranges : [{ start: 0, end: Math.min(duration, 1) }])
    .map((range) => ({
      start: Math.max(0, range.start - PADDING_SECONDS),
      end: Math.min(duration, range.end + PADDING_SECONDS),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: SourceRange[] = [];
  for (const range of used) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function timelineSourceRanges(timelines: Timeline[], assetId: string): SourceRange[] {
  return timelines.flatMap((timeline) =>
    timeline.clips
      .filter((clip) => clip.kind === 'video' && clip.assetId === assetId)
      .map((clip) => ({ start: clip.sourceStart, end: sourceEndOf(clip) })),
  );
}

export function previewRangeReady(asset: MediaAsset, range: SourceRange) {
  if (asset.previewUrl || asset.previewOriginalPlayable || asset.cutoutOf || asset.derivedOf) return true;
  let covered = range.start;
  for (const segment of [...(asset.previewSegments ?? [])].sort((a, b) => a.start - b.start)) {
    if (segment.start > covered + 1e-6) return false;
    if (segment.end > covered) covered = segment.end;
    if (covered >= range.end - 1e-6) return true;
  }
  return false;
}

/** Segment files use source PTS minus their range start, without resetting the first frame's fractional PTS. */
export function previewSourceAt(
  asset: MediaAsset,
  sourceTime: number,
): { url: string | null; offset: number; end?: number; pending: boolean } {
  if (asset.previewUrl)
    return {
      url: asset.url?.startsWith('blob:') ? asset.url : asset.previewUrl,
      offset: 0,
      pending: false,
    };
  const segment = asset.previewSegments?.find((segment) => sourceTime >= segment.start && sourceTime < segment.end);
  if (segment)
    return {
      url: segment.url,
      offset: segment.start,
      end: segment.end,
      pending: false,
    };
  return {
    url: asset.url,
    offset: 0,
    pending: asset.kind === 'video' && !asset.previewOriginalPlayable && !asset.cutoutOf && !asset.derivedOf,
  };
}
