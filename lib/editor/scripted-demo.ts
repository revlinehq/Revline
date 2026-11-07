import type { MediaAsset, Timeline } from './types';

export const EMPTY_SCRIPTED_DEMO: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1, effects: 2 }, clips: [] };

/** Local audio reuses the video container; it never uploads or duplicates the file. */
export function scriptedDemoMedia(originals: readonly MediaAsset[]) {
  const assets = [...originals], audioByVideo = new Map<string, string>(), ids = new Set(assets.map(asset => asset._id));
  for (const video of originals.filter(asset => asset.kind === 'video')) {
    let id = `${video._id}-demo-audio`; while (ids.has(id)) id += '-'; ids.add(id);
    assets.push({ ...video, _id: id, kind: 'audio', thumbnailUrl: undefined, fileName: `${video.fileName} · audio` });
    audioByVideo.set(video._id, id);
  }
  return { assets, audioByVideo };
}

