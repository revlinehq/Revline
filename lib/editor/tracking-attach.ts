import { objectMotionPatch } from '../ai/object-motion';
import { solidColorSettings } from './clip-effects';
import { bakeMaskAnchors, type ClipMask, type MaskShape } from './masks';
import { sourceTimeAt, timelineTimeAtSource } from './playback-rate';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type MediaAsset } from './types';
import { calculateVisualRect } from './visual-source-geometry';

/** A tracked point: source seconds of the footage, and its position as fractions of the source frame. */
export type TrackSample = { time: number; x: number; y: number };
const MAX_KEYS = 110;

/** Footage must hold still on the canvas for its pixels to map to fixed canvas positions. */
function assertStillFraming(footage: Clip) {
  if (footage.kind !== 'video' && footage.kind !== 'image') throw new Error('Track a video or image clip.');
  if (footage.cameraMotion || footage.smoothZoom || footage.focus?.length || footage.motion?.length) throw new Error('This footage is reframed by camera motion, subject-follow or keyframes. Attach to footage with fixed framing.');
}

/** A source-frame point to canvas fractions, through fit, crop and the footage's static transform. */
function footageToCanvas(footage: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, aspectRatio: AspectRatio, x: number, y: number) {
  const { width, height } = dimensions(aspectRatio);
  if (!(asset.width! > 0 && asset.height! > 0)) throw new Error('The footage has no recorded dimensions. Re-import it.');
  const rect = calculateVisualRect(asset.width!, asset.height!, width, height, footage.crop, undefined, footage.fit === 'contain' ? 'contain' : 'cover');
  const frameX = rect.left + x * rect.width, frameY = rect.top + y * rect.height;
  const transform = { ...DEFAULT_TRANSFORM, ...footage.transform }, angle = transform.rotation * Math.PI / 180;
  // The frame is canvas-sized, offset to transform.x/y and scaled/rotated about its center.
  const dx = (frameX - width / 2) * transform.scale, dy = (frameY - height / 2) * transform.scale;
  return { frame: { x: frameX / width, y: frameY / height }, canvas: { x: transform.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) / width, y: transform.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) / height } };
}

/** Samples within [start, end) timeline seconds, smoothed and thinned to the key budget. */
function timelineSamples(footage: Clip, samples: TrackSample[], start: number, end: number) {
  const mapped = samples.map(sample => ({ ...sample, at: timelineTimeAtSource(footage, sample.time) })).filter(sample => sample.at >= Math.max(start, footage.start) - 1e-6 && sample.at <= Math.min(end, footage.start + footage.duration) + 1e-6).sort((a, b) => a.at - b.at);
  if (mapped.length < 2) throw new Error('The tracked path does not cover this clip. Track the subject over the clip\'s time first.');
  // Light 3-tap smoothing removes tracker jitter without lagging the path.
  const smooth = mapped.map((sample, index) => { const window = mapped.slice(Math.max(0, index - 1), index + 2); return { at: sample.at, x: window.reduce((sum, item) => sum + item.x, 0) / window.length, y: window.reduce((sum, item) => sum + item.y, 0) / window.length }; });
  const stride = Math.max(1, Math.ceil(smooth.length / MAX_KEYS));
  const thinned = smooth.filter((_, index) => index % stride === 0);
  if (thinned.at(-1) !== smooth.at(-1)) thinned.push(smooth.at(-1)!);
  return thinned;
}

/** Interpolate AI-provided points ({time: timeline seconds, x, y in source fractions}) into source-time samples. */
export function pointsToSamples(footage: Clip, points: { time: number; x: number; y: number }[]): TrackSample[] {
  if (points.length < 2 || points.length > 120) throw new Error('Give 2 to 120 tracked points.');
  if (points.some((point, index) => !Number.isFinite(point.time) || index > 0 && point.time <= points[index - 1].time || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) throw new Error('Tracked points need increasing timeline times and x/y within 0..1 of the source frame.');
  return points.map(point => ({ time: sourceTimeAt(footage, point.time), x: point.x, y: point.y }));
}

/** Center of an overlay's static placement, in canvas fractions. */
function overlayCenter(overlay: Clip) {
  if (overlay.kind === 'image' || overlay.kind === 'video') { const transform = { ...DEFAULT_TRANSFORM, ...overlay.transform }; return { x: transform.x, y: transform.y }; }
  if (overlay.kind === 'solid') { const solid = solidColorSettings(overlay); return { x: solid.x, y: solid.y }; }
  if (overlay.kind === 'caption' || overlay.kind === 'graphic') return { x: overlay.x ?? .5, y: overlay.y ?? (overlay.kind === 'caption' ? .82 : .5) };
  throw new Error('Attach a text, image, video or solid-color clip.');
}

/** Move an overlay so its center follows the tracked point (plus a canvas-fraction offset). */
export function attachOverlayPatch(overlay: Clip, footage: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, aspectRatio: AspectRatio, samples: TrackSample[], offset = { x: 0, y: 0 }) {
  assertStillFraming(footage);
  const center = overlayCenter(overlay), path = timelineSamples(footage, samples, overlay.start, overlay.start + overlay.duration);
  const keyframes = path.map(sample => {
    const { canvas } = footageToCanvas(footage, asset, aspectRatio, sample.x, sample.y);
    const x = canvas.x + offset.x - center.x, y = canvas.y + offset.y - center.y;
    return { time: Math.min(overlay.duration, Math.max(0, sample.at - overlay.start)), x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), scale: 1, rotation: 0, opacity: 1, brightness: 1 };
  }).filter((key, index, keys) => index === 0 || key.time > keys[index - 1].time);
  return objectMotionPatch(overlay, keyframes, { replaceMotion: true, aspectRatio });
}

/** A mask on `target` (the footage, or a styled copy of it) whose center follows the tracked point. */
export function attachMaskPatch(target: Clip, footage: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, aspectRatio: AspectRatio, samples: TrackSample[], shape: { shape: MaskShape; width: number; height: number; feather?: number; invert?: boolean; radius?: number; text?: string }): { mask: ClipMask } {
  assertStillFraming(footage);
  if (target.kind !== 'video' && target.kind !== 'image') throw new Error('Mask a video or image clip.');
  // Mask geometry lives in the masked clip's own frame, before its transform: a copy of the footage shares the footage's frame.
  const path = timelineSamples(footage, samples, target.start, target.start + target.duration), offset = target.motionOffset ?? 0;
  const keys = path.map(sample => {
    const { frame } = footageToCanvas(footage, asset, aspectRatio, sample.x, sample.y);
    return { time: Math.max(0, sample.at - target.start) + offset, x: frame.x, y: frame.y, width: shape.width, height: shape.height, rotation: 0, feather: shape.feather ?? 12 };
  }).filter((key, index, list) => index === 0 || key.time > list[index - 1].time);
  return { mask: { shape: shape.shape, ...(shape.invert ? { invert: true } : {}), ...(shape.radius !== undefined ? { radius: shape.radius } : {}), ...(shape.text ? { text: shape.text } : {}), keys } };
}

export { bakeMaskAnchors };
