import type { MediaAsset, Timeline } from './types';

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

/** Loaded fallback stills can open the editor while exact frames refine in place. */
export function timelineThumbnailsPrepared(root: HTMLElement) {
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
  return frames.every(frame => {
    const image = frame.querySelector('img');
    return !!image?.complete && image.naturalWidth > 0;
  });
}
