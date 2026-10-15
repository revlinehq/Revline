import { dimensions, normalizeTimeline, type Clip, type Timeline, type MediaAsset, type VisualTransform } from './types';
import { calculateVisualRect, layerZIndex } from './composition';
import { visualBounds, visualCornerPosition, visualTransform, type VisualCorner, type VisualRect } from './visual-transforms';
import { motionAt, NEUTRAL_MOTION, solidColorSettings, visibleMotion } from './clip-effects';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
const order = ['nw', 'ne', 'se', 'sw'] as const;

/**
 * OpenCut's preview-coords convention: media and handles share composition
 * coordinates and one canvas-to-screen scale. Intersect the content polygon
 * with our composition mask before drawing its visible selection.
 */
export function visibleVisualBounds(transform: VisualTransform, content: VisualRect, canvas: Size) {
  const bounds = visualBounds(transform, content, canvas.width, canvas.height);
  const original = order.map(corner => visualCornerPosition(bounds, corner));
  let points = original;
  for (const [axis, edge, keepGreater] of [['x', 0, true], ['x', canvas.width, false], ['y', 0, true], ['y', canvas.height, false]] as const) {
    const inside = (point: Point) => keepGreater ? point[axis] >= edge : point[axis] <= edge;
    const result: Point[] = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index], b = points[(index + 1) % points.length];
      if (inside(a)) result.push(a);
      if (inside(a) !== inside(b)) {
        const amount = (edge - a[axis]) / (b[axis] - a[axis]);
        result.push({ x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount });
      }
    }
    points = result;
  }
  if (points.length < 3) return null;
  const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x)), bottom = Math.max(...points.map(point => point.y));
  if (right - left < .001 || bottom - top < .001) return null;
  const rect = { left, top, width: right - left, height: bottom - top };
  const clipped = original.some(point => point.x < -.001 || point.y < -.001 || point.x > canvas.width + .001 || point.y > canvas.height + .001);
  // Expose every resize target beside the visible region. Gesture anchoring
  // still uses the original content rectangle, never this display rectangle.
  const corners: Record<VisualCorner, Point> = clipped
    ? { nw: { x: left, y: top }, ne: { x: right, y: top }, sw: { x: left, y: bottom }, se: { x: right, y: bottom } }
    : Object.fromEntries(order.map((corner, index) => [corner, original[index]])) as Record<VisualCorner, Point>;
  return { points, rect, clipped, corners };
}

export type PreviewTextBounds = { id: string; rect: VisualRect };
export type PreviewHitOptions = { mediaOpacities?: ReadonlyMap<string, number>; cycleAfter?: string | null };

/** Read scene opacity, including live motion, without sampling or reloading media. */
export function previewMediaOpacities(document: Document) {
  const result = new Map<string, number>(), view = document.defaultView;
  if (!view) return result;
  for (const frame of document.querySelectorAll<HTMLElement>('[data-visual-clip]')) {
    let opacity = 1;
    for (let node: HTMLElement | null = frame.querySelector('[data-visual-fade]') ?? frame.querySelector('.motion-frame') ?? frame; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') { opacity = 0; break; }
      opacity *= Number(style.opacity);
      // A common adjustment wrapper fades the composite, not each layer independently.
      if (node === frame) break;
    }
    result.set(frame.dataset.visualClip!, opacity);
  }
  for(const frame of document.querySelectorAll<HTMLElement>('[data-solid-color-clip]')){
    const rectangle=frame.firstElementChild;
    result.set(frame.dataset.solidColorClip!,view.getComputedStyle(frame).visibility==='hidden'?0:Number(rectangle?view.getComputedStyle(rectangle).opacity:1));
  }
  return result;
}

function pointInPolygon(point: Point, points: Point[]) {
  let positive = false, negative = false;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    const side = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (side > .001) positive = true;
    if (side < -.001) negative = true;
  }
  return !(positive && negative);
}

function mediaBounds(clip: Clip, asset: MediaAsset | undefined, canvas: Size, time=clip.start) {
  if(clip.kind==='solid'){
    const settings=solidColorSettings(clip),keys=visibleMotion(clip),motion=keys.length?motionAt(keys,time-clip.start):NEUTRAL_MOTION;
    return visibleVisualBounds({x:settings.x+motion.x,y:settings.y+motion.y,scale:motion.scale,rotation:motion.rotation,opacity:settings.opacity*motion.opacity},{left:(1-settings.width)*canvas.width/2,top:(1-settings.height)*canvas.height/2,width:settings.width*canvas.width,height:settings.height*canvas.height},canvas);
  }
  if (!asset?.url) return null;
  const rect = asset.width && asset.height
    ? calculateVisualRect(asset.width, asset.height, canvas.width, canvas.height, clip.crop, undefined, clip.fit).window
    : {left:0,top:0,...canvas};
  return visibleVisualBounds(visualTransform(clip.transform), rect, canvas);
}
function solidOpacity(clip:Clip,time:number){
  const keys=visibleMotion(clip);
  return solidColorSettings(clip).opacity*(keys.length?motionAt(keys,time-clip.start).opacity:1);
}

/** Hit-test text and the retained media pixels in their shared visual-track order. */
export function previewClipAtPoint(timeline: Timeline, assets: MediaAsset[], time: number, point: Point, textBounds: PreviewTextBounds[] = [], options: PreviewHitOptions = {}) {
  timeline = normalizeTimeline(timeline);
  const canvas = dimensions(timeline.aspectRatio);
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  const textMap = new Map(textBounds.map(value => [value.id, value.rect]));
  const active = timeline.clips.map((clip, index) => ({clip, z: layerZIndex(clip, index), opacity: options.mediaOpacities?.get(clip.id) ?? (clip.kind==='solid'?solidOpacity(clip,time):clip.transform?.opacity??1)}))
    .filter(({clip, opacity}) => clip.kind !== 'audio' && clip.kind !== 'effect' && time >= clip.start && time < clip.start + clip.duration && (clip.kind === 'caption' || clip.kind === 'graphic' || opacity > 0))
    .sort((a, b) => b.z - a.z);
  const hits: typeof active = [];
  for (const hit of active) {
    const {clip} = hit;
    if (clip.kind === 'caption' || clip.kind === 'graphic') {
      const rect = textMap.get(clip.id);
      if (rect && point.x >= rect.left && point.y >= rect.top && point.x <= rect.left + rect.width && point.y <= rect.top + rect.height) {
        // Keep text's existing top-hit behavior and prevent cycling through its ink.
        if (!hits.length) return clip;
        break;
      }
      continue;
    }
    const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined;
    const visible = mediaBounds(clip, asset, canvas, time);
    if (!visible) continue;
    if (pointInPolygon(point, visible.points)) hits.push(hit);
  }
  if (!hits.length) return undefined;
  if (options.cycleAfter !== undefined) {
    const index = hits.findIndex(({clip}) => clip.id === options.cycleAfter);
    return hits[(index + 1) % hits.length]?.clip;
  }
  let remaining = 1, contribution = -1, selected: Clip | undefined;
  for (const {clip, opacity} of hits) {
    const visible = remaining * opacity;
    // Strictly greater preserves top z-order for equal contributions.
    if (visible > contribution) { selected = clip; contribution = visible; }
    remaining *= 1 - opacity;
  }
  return selected;
}

/** Media-only selection, using the same retained, transformed pixels as its outline. */
export function visualClipAtPoint(timeline: Timeline, assets: MediaAsset[], time: number, point: Point) {
  return previewClipAtPoint(timeline, assets, time, point);
}

/** Hidden text must not leave an invisible hit target over higher footage. */
export function isPreviewTextOccluded(timeline: Timeline, assets: MediaAsset[], time: number, id: string, rect: VisualRect) {
  timeline = normalizeTimeline(timeline);
  const textIndex = timeline.clips.findIndex(clip => clip.id === id);
  if (textIndex < 0) return false;
  const z = layerZIndex(timeline.clips[textIndex], textIndex), canvas = dimensions(timeline.aspectRatio);
  const points = [{x:rect.left,y:rect.top},{x:rect.left+rect.width,y:rect.top},{x:rect.left,y:rect.top+rect.height},{x:rect.left+rect.width,y:rect.top+rect.height}];
  const assetMap = new Map(assets.map(asset => [asset._id, asset]));
  return timeline.clips.some((clip,index) => {
    if ((clip.kind !== 'image' && clip.kind !== 'video' && clip.kind !== 'solid') || time < clip.start || time >= clip.start+clip.duration || (clip.kind==='solid'?solidOpacity(clip,time):clip.transform?.opacity??1) < 1 || layerZIndex(clip,index) <= z) return false;
    const visible = mediaBounds(clip, assetMap.get(clip.assetId ?? ''), canvas,time);
    return !!visible && points.every(point => pointInPolygon(point, visible.points));
  });
}
