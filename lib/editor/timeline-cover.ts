import { trackOf, type MediaAsset, type Timeline } from './types';

/** A timeline's preview: its first picture (earliest first, top layer first), a video or image thumbnail. */
export function timelineCover(timeline: Pick<Timeline, 'clips'>, assets: readonly Pick<MediaAsset, '_id' | 'kind' | 'url' | 'thumbnailUrl'>[]) {
  const first = timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image').sort((a, b) => a.start - b.start || trackOf(b) - trackOf(a))[0];
  const asset = first && assets.find(item => item._id === first.assetId);
  return asset ? asset.thumbnailUrl ?? (asset.kind === 'image' ? asset.url : null) : null;
}
