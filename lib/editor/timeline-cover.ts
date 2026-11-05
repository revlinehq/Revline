import { scenePlaceholderCover } from './scene-placeholder';
import { trackOf, type Clip, type MediaAsset, type Timeline } from './types';

/** A timeline's preview: its first picture (earliest first, top layer first), either a video or image thumbnail or a motion scene's own rendered frame (from sceneThumbs). */
export function timelineCover(timeline: Pick<Timeline, 'clips'>, assets: readonly Pick<MediaAsset, '_id' | 'kind' | 'url' | 'thumbnailUrl'>[], sceneThumbs?: Record<string, { time: number; image: string }[]>) {
  const first = timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image' || (clip.kind === 'scene' && sceneThumbs?.[clip.id]?.length)).sort((a, b) => a.start - b.start || trackOf(b) - trackOf(a))[0];
  if (first?.kind === 'scene') { const frames = sceneThumbs![first.id]; const image = frames[Math.floor(frames.length / 2)].image; return image.startsWith('https://') ? image : `data:image/jpeg;base64,${image}`; }
  const asset = first && assets.find(item => item._id === first.assetId);
  if (asset) return asset.thumbnailUrl ?? (asset.kind === 'image' ? asset.url : null);
  // Motion clips whose frames are still coming get their placeholder, not a blank cover.
  if (first) return null;
  const scene = timeline.clips.filter(clip => clip.kind === 'scene').sort((a, b) => a.start - b.start)[0] as Clip | undefined;
  return scene ? scenePlaceholderCover(scene.scene?.title || 'Scene') : null;
}
