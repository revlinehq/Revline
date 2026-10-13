import type { MediaAsset, Timeline } from './types';

/** Only changes to rendered content require a new decoded player. */
export function previewContentKey(timeline: Timeline, assets: MediaAsset[]): string {
  const used = new Set(timeline.clips.flatMap(clip => clip.assetId ? [clip.assetId] : []));
  return JSON.stringify({
    timeline: { ...timeline, tracks: undefined, clips: timeline.clips.map(({ track, volume, ...clip }) => clip) },
    assets: assets.filter(asset => used.has(asset._id)).map(({ _id, kind, width, height, url }) => ({ _id, kind, width, height, url: url?.split('?token=')[0] ?? null })),
  });
}
