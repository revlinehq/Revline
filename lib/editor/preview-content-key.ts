import type { MediaAsset, Timeline } from './types';

/** Streamed attachments own async clock state; recreate it when their clips or node order change. */
export function previewContentKey(timeline: Timeline, _assets: MediaAsset[]): string {
  const tracking = timeline.clips.some(clip => clip.pixelTracking) ? timeline.clips.map(clip => clip.pixelTracking ? clip : { id: clip.id }) : undefined;
  return JSON.stringify({fps:timeline.fps,aspectRatio:timeline.aspectRatio,tracking});
}
