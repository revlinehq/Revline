import type { MediaAsset, Timeline } from './types';

/** Content edits reconcile on the live clock; only the output format needs a new player. */
export function previewContentKey(timeline: Timeline, _assets: MediaAsset[]): string {
  return JSON.stringify({fps:timeline.fps,aspectRatio:timeline.aspectRatio});
}
