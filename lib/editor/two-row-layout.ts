import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type MediaAsset, type Timeline } from './types';
import { cropToAspect } from './visual-transforms';
import { validateVisualTransform } from './visual-inputs';

export type TwoRowPosition = 'top' | 'bottom';
type LayoutSource = Pick<MediaAsset, '_id' | 'kind' | 'width' | 'height'>;

/** Fill an exact half-canvas aperture using the existing undistorted source crop. */
export function twoRowLayoutPatch(clip: Clip, asset: LayoutSource, aspectRatio: AspectRatio, row: TwoRowPosition): Pick<Clip, 'crop' | 'fit' | 'transform'> {
  if ((clip.kind !== 'video' && clip.kind !== 'image') || asset.kind !== clip.kind || asset._id !== clip.assetId) throw new Error('Choose a video or image source for the row layout.');
  if (row !== 'top' && row !== 'bottom') throw new Error('Choose the top or bottom row.');
  if (!asset.width || !asset.height || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) throw new Error('Wait for the source dimensions before applying a row layout.');
  if (clip.motion?.length || clip.focus?.length) throw new Error('Remove existing custom motion or subject-follow crop before applying a row layout.');
  const { width, height } = dimensions(aspectRatio);
  const contain = Math.min(width / asset.width, height / asset.height);
  const coverRow = Math.max(width / asset.width, height / 2 / asset.height);
  const transform = { ...DEFAULT_TRANSFORM, opacity: clip.transform?.opacity ?? 1, x: .5, y: row === 'top' ? .25 : .75, scale: coverRow / contain };
  validateVisualTransform(transform);
  return { fit: 'contain', crop: cropToAspect(asset.width, asset.height, width / (height / 2)), transform };
}

/** Assign inspected supporting/narrator clips without altering timing, sound or other clips. */
export function applyTwoRowLayout(timeline: Timeline, assets: readonly LayoutSource[], selection: { topClipIds: readonly string[]; bottomClipIds: readonly string[] }): Timeline {
  const rows = new Map<string, TwoRowPosition>();
  for (const [row, ids] of [['top', selection.topClipIds], ['bottom', selection.bottomClipIds]] as const) for (const id of ids) {
    if (rows.has(id)) throw new Error('Choose each row clip only once.');
    rows.set(id, row);
  }
  if (!rows.size) throw new Error('Choose footage for the row layout.');
  const known = new Set(timeline.clips.map(clip => clip.id));
  if ([...rows.keys()].some(id => !known.has(id))) throw new Error('A selected row clip is no longer on the timeline.');
  const sources = new Map(assets.map(asset => [asset._id, asset]));
  return { ...timeline, clips: timeline.clips.map(clip => {
    const row = rows.get(clip.id);
    if (!row) return clip;
    const asset = sources.get(clip.assetId ?? '');
    if (!asset) throw new Error('A selected row clip needs an available source.');
    return { ...clip, ...twoRowLayoutPatch(clip, asset, timeline.aspectRatio, row) };
  }) };
}
