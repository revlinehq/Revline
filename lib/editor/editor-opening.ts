import type { MediaAsset, Timeline } from './types';
import { MAX_PREVIEW_BYTES } from './preview-source-cache';

/** Do not advertise a large original's first frame as a prepared editing source. */
export function createPlaybackOpeningGate() {
  let opened = false;
  return (timeline: Timeline, assets: MediaAsset[] | undefined) => {
    if (!assets) return []; // An unresolved asset query must not open the latch.
    if (opened) return [];
    const used = new Set(timeline.clips.filter(clip => clip.kind === 'video').map(clip => clip.assetId));
    const pending = assets.filter(asset => asset.kind === 'video' && used.has(asset._id) && (asset.size ?? 0) > MAX_PREVIEW_BYTES && !asset.previewUrl);
    if (!pending.length) opened = true;
    return pending;
  };
}

/** Audio extraction and its linked waveform are part of opening the edit. */
export function editorAudioPrepared(timeline: Timeline, assets: MediaAsset[]) {
  const sources = new Map(assets.map(asset => [asset._id, asset]));
  return timeline.clips.every(clip => {
    if (clip.kind === 'audio') return !!sources.get(clip.assetId!)?.waveform;
    if (clip.kind !== 'video') return true;
    const video = sources.get(clip.assetId!);
    if (!video) return false;
    // Unlinked or deleted audio is a valid intentional edit. Existing separated
    // clips must not be trapped behind a preparation job that cannot change it.
    if (clip.audioSeparated) return true;
    if (!video.audioExtracted && !video.audioAssetId) return false;
    if (!video.audioAssetId) return true;
    return false;
  });
}

export const MAX_THUMBNAIL_OPENING_WAIT_MS = 12_000;

/** Loaded fallback stills and terminal thumbnail failures must not block playback. */
export function timelineThumbnailsPrepared(root: HTMLElement, onProgress?:(ready:number,total:number)=>void) {
  const rail = root.querySelector('.timeline-scroll');
  if (!rail) return false;
  if (root.querySelector('.timeline-collapsed')) return true;
  const bounds = rail.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const frames = Array.from(root.querySelectorAll<HTMLElement>('.media-filmstrip .filmstrip-frame')).filter(frame => {
    const box = frame.getBoundingClientRect();
    return box.width > 0 && box.right > bounds.left && box.left < bounds.right && box.bottom > bounds.top && box.top < bounds.bottom;
  });
  if (!frames.length) return !Array.from(root.querySelectorAll('.media-filmstrip')).some(strip => {
    const box = strip.getBoundingClientRect();
    return box.width > 0 && box.right > bounds.left && box.left < bounds.right && box.bottom > bounds.top && box.top < bounds.bottom;
  });
  const ready=frames.filter(frame => {
    if (frame.closest<HTMLElement>('.media-filmstrip')?.dataset.thumbnailState === 'failed') return true;
    const image = frame.querySelector('img');
    return !!image?.complete && image.naturalWidth > 0;
  }).length;
  onProgress?.(ready,frames.length);
  return ready===frames.length;
}
