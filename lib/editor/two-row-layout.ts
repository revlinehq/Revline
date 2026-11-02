import { normalizedRect, type FacecamAnalysis } from '../media-analysis/clipping';
import { sourceEndOf } from './playback-rate';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type MediaAsset, type Timeline } from './types';
import { cropToAspect } from './visual-transforms';
import { validateVisualTransform } from './visual-inputs';

export type TwoRowPosition = 'top' | 'bottom';
type LayoutSource = Pick<MediaAsset, '_id' | 'kind' | 'width' | 'height' | 'analysis'>;

/** Fill an exact half-canvas aperture using the existing undistorted source crop. */
export function twoRowLayoutPatch(clip: Clip, asset: LayoutSource, aspectRatio: AspectRatio, row: TwoRowPosition, region?: {x:number;y:number;w:number;h:number}): Pick<Clip, 'crop' | 'fit' | 'transform'> {
  if ((clip.kind !== 'video' && clip.kind !== 'image') || asset.kind !== clip.kind || asset._id !== clip.assetId) throw new Error('Choose a video or image source for the row layout.');
  if (row !== 'top' && row !== 'bottom') throw new Error('Choose the top or bottom row.');
  if (!asset.width || !asset.height || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) throw new Error('Wait for the source dimensions before applying a row layout.');
  if (clip.motion?.length || clip.focus?.length) throw new Error('Remove existing custom motion or subject-follow crop before applying a row layout.');
  const { width, height } = dimensions(aspectRatio);
  const contain = Math.min(width / asset.width, height / asset.height);
  const box=normalizedRect.parse(region??{x:0,y:0,w:1,h:1});
  const coverRow = Math.max(width / (asset.width*box.w), height / 2 / (asset.height*box.h));
  const visibleWidth=width/coverRow/asset.width,visibleHeight=height/2/coverRow/asset.height;
  const center={x:box.x+box.w/2,y:box.y+box.h/2};
  const crop={left:Math.max(0,center.x-visibleWidth/2),right:Math.max(0,1-center.x-visibleWidth/2),top:Math.max(0,center.y-visibleHeight/2),bottom:Math.max(0,1-center.y-visibleHeight/2)};
  if(visibleWidth<=.05||visibleHeight<=.05)throw new Error('The detected panel is too small for a supported crop.');
  const transform = { ...DEFAULT_TRANSFORM, opacity: clip.transform?.opacity ?? 1, x: .5+(.5-center.x)*asset.width*coverRow/width, y: (row === 'top' ? .25 : .75)+(.5-center.y)*asset.height*coverRow/height, scale: coverRow / contain };
  validateVisualTransform(transform);
  return { fit: 'contain', crop: region ? crop : cropToAspect(asset.width, asset.height, width / (height / 2)), transform };
}

/** Assign inspected supporting/narrator clips without altering timing, sound or other clips. */
export function applyTwoRowLayout(timeline: Timeline, assets: readonly LayoutSource[], selection: { topClipIds: readonly string[]; bottomClipIds: readonly string[]; detectedRegions?:boolean }): Timeline {
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
    return { ...clip, ...twoRowLayoutPatch(clip, asset, timeline.aspectRatio, row, selection.detectedRegions ? detectedRegionForClip(asset.analysis?.facecam,clip,row) : undefined) };
  }) };
}

/** Refuse a changing or unverified layout instead of stretching a guessed box across the clip. */
export function detectedRegionForClip(analysis:FacecamAnalysis|undefined,clip:Clip,row:TwoRowPosition){
  const samples=analysis?.samples;
  if(!samples?.length)throw new Error('Run detectFacecam on this source first.');
  const before=samples.filter(s=>s.time<=clip.sourceStart).at(-1);
  const relevant=[...(before?[before]:[]),...samples.filter(s=>s.time>clip.sourceStart&&s.time<sourceEndOf(clip))];
  if(!relevant.length)throw new Error('No facecam observation covers this source range.');
  const first=relevant[0],box=row==='top'?first.facecam:first.gameplay;
  if(first.kind!=='overlay'||first.confidence<.7||!box)throw new Error('No confident facecam overlay here. Use a single full-frame layout or inspect this range.');
  if(relevant.some(s=>{const r=row==='top'?s.facecam:s.gameplay;return s.kind!=='overlay'||s.confidence<.7||!r||Math.max(Math.abs(r.x-box.x),Math.abs(r.y-box.y),Math.abs(r.w-box.w),Math.abs(r.h-box.h))>.03;}))throw new Error('The stream layout changes in this clip. Split at the layout change and inspect each section.');
  return box;
}
