import type { PixelTrackBinding, PixelTrackReference, TrackGeometry, TrackMaskSettings } from './types';
import { boundedCameraMotion } from './camera-framing';
import { focusAt } from './focus-path';
import { motionAt, NEUTRAL_MOTION } from './motion-path';
import { objectMotionPatch } from './object-motion';
import { solidColorSettings, visibleMotion } from './clip-effects';
import type { ClipMask, MaskShape } from './masks';
import { sourceTimeAt, timelineTimeAtSource } from './playback-rate';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type MediaAsset } from './types';
import { calculateVisualRect } from './visual-source-geometry';

/** A tracked point: source seconds of the footage, and its position as fractions of the source frame. */
export type TrackSample = { time: number; x: number; y: number; confidence?: number; scale?: number; rotation?: number };
export type TrackAttachmentOptions = { smoothing?: number; followTransform?: boolean; fps?: number; seedTime?: number; visibleUntil?: number };

/** Tracking geometry applies to visual source clips. */
function assertFootage(footage: Clip) {
  if (footage.kind !== 'video' && footage.kind !== 'image') throw new Error('Track a video or image clip.');
}

/** Source pixels through the same aperture, focus, motion and static placement as composition.ts. */
function footageMapper(footage: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, aspectRatio: AspectRatio) {
  const { width, height } = dimensions(aspectRatio);
  if (!(asset.width! > 0 && asset.height! > 0)) throw new Error('The footage has no recorded dimensions. Re-import it.');
  const fit = footage.fit === 'contain' ? 'contain' : 'cover';
  const aperture = calculateVisualRect(asset.width!, asset.height!, width, height, footage.crop, focusAt(footage.focus ?? [], footage.sourceStart), fit).window;
  const keys = boundedCameraMotion(footage, asset, aspectRatio, visibleMotion(footage));
  const transform = { ...DEFAULT_TRANSFORM, ...footage.transform }, angle = transform.rotation * Math.PI / 180;
  return (x: number, y: number, time: number) => {
    const rect = calculateVisualRect(asset.width!, asset.height!, width, height, footage.crop, focusAt(footage.focus ?? [], time), fit);
    const motion = keys.length ? motionAt(keys, timelineTimeAtSource(footage, time) - footage.start) : NEUTRAL_MOTION;
    const localX = aperture.left + rect.left - rect.window.left + x * rect.width - width / 2, localY = aperture.top + rect.top - rect.window.top + y * rect.height - height / 2, radians = motion.rotation * Math.PI / 180;
    const frameX = width / 2 + motion.x * width + motion.scale * (localX * Math.cos(radians) - localY * Math.sin(radians));
    const frameY = height / 2 + motion.y * height + motion.scale * (localX * Math.sin(radians) + localY * Math.cos(radians));
    // The frame is canvas-sized, offset to transform.x/y and scaled/rotated about its center.
    const dx = (frameX - width / 2) * transform.scale, dy = (frameY - height / 2) * transform.scale;
    return { scale: motion.scale, rotation: motion.rotation, frame: { x: frameX / width, y: frameY / height }, canvas: { x: transform.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) / width, y: transform.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) / height } };
  };
}

/** Samples within the timeline interval, with symmetric jitter smoothing. */
function timelineSamples(footage: Clip, samples: TrackSample[], start: number, end: number, smoothing = .35) {
  const mapped = samples.map(sample => ({ ...sample, at: timelineTimeAtSource(footage, sample.time) })).filter(sample => sample.at >= Math.max(start, footage.start) - 1e-6 && sample.at <= Math.min(end, footage.start + footage.duration) + 1e-6).sort((a, b) => a.at - b.at);
  if (mapped.length < 1) throw new Error('The tracked path does not cover this clip. Track the subject over the clip\'s time first.');
  // A symmetric filter reduces subpixel jitter without adding temporal lag.
  const smooth = mapped.map((sample, index) => {
    if (index === 0 || index === mapped.length - 1 || sample.confidence === 0 || mapped[index-1].confidence === 0 || mapped[index+1].confidence === 0) return sample;
    const before = mapped[index - 1], after = mapped[index + 1];
    return { ...sample, x: sample.x * (1 - smoothing) + (before.x + after.x) * smoothing / 2, y: sample.y * (1 - smoothing) + (before.y + after.y) * smoothing / 2,
      scale: (sample.scale ?? 1) * (1 - smoothing) + ((before.scale ?? 1) + (after.scale ?? 1)) * smoothing / 2,
      rotation: (sample.rotation ?? 0) * (1 - smoothing) + ((before.rotation ?? 0) + (after.rotation ?? 0)) * smoothing / 2 };
  });
  return smooth;
}

/** Interpolate AI-provided points ({time: timeline seconds, x, y in source fractions}) into source-time samples. */
export function pointsToSamples(footage: Clip, points: { time: number; x: number; y: number }[]): TrackSample[] {
  if (points.length < 2) throw new Error('Give at least two tracked points.');
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
export function attachOverlayPatch(overlay: Clip, footage: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, aspectRatio: AspectRatio, samples: TrackSample[], offset = { x: 0, y: 0 }, options: TrackAttachmentOptions = {}) {
  assertFootage(footage);
  const center = overlayCenter(overlay), path = timelineSamples(footage, samples, overlay.start, overlay.start + overlay.duration, options.smoothing);
  const map = footageMapper(footage, asset, aspectRatio), seed = map(path[0].x, path[0].y, options.seedTime ?? path[0].time);
  const keyframes = path.map(sample => {
    const { canvas, scale, rotation } = map(sample.x, sample.y, sample.time);
    const x = canvas.x + offset.x - center.x, y = canvas.y + offset.y - center.y;
    return { time: Math.min(overlay.duration, Math.max(0, sample.at - overlay.start)), x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), scale: options.followTransform === false ? 1 : Math.max(.1, Math.min(10, (sample.scale ?? 1) * scale / seed.scale)), rotation: options.followTransform === false ? 0 : Math.max(-360, Math.min(360, (sample.rotation ?? 0) + rotation - seed.rotation)), opacity: sample.confidence === 0 ? 0 : 1, brightness: 1 };
  }).filter((key, index, keys) => index === 0 || key.time > keys[index - 1].time);
  const dense = samples.some(sample => sample.confidence !== undefined);
  if (dense) {
    const first = keyframes[0], last = keyframes[keyframes.length - 1];
    const until = options.visibleUntil === undefined ? last.time + 1 / (options.fps ?? 60) : timelineTimeAtSource(footage, options.visibleUntil) - overlay.start;
    if (first.time > 1e-6) keyframes.unshift({ ...first, time: Math.max(0, first.time - 1e-6), opacity: 0 });
    if (until > last.time && until < overlay.duration) {
      if (until - last.time > 2e-6) keyframes.push({ ...last, time: until - 1e-6 });
      keyframes.push({ ...last, time: until, opacity: 0 });
    }
  }
  return objectMotionPatch(overlay, keyframes, { replaceMotion: true, aspectRatio });
}

/** A mask on `target` (the footage, or a styled copy of it) whose center follows the tracked point. */
export function attachMaskPatch(target: Clip, footage: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, aspectRatio: AspectRatio, samples: TrackSample[], shape: { shape: MaskShape; width: number; height: number; feather?: number; invert?: boolean; radius?: number; text?: string }, options: TrackAttachmentOptions = {}): { mask: ClipMask; pixelTracking: undefined } {
  assertFootage(footage);
  if (target.kind !== 'video' && target.kind !== 'image') throw new Error('Mask a video or image clip.');
  if (target.assetId !== footage.assetId) throw new Error('A tracked mask needs the footage itself or a synchronized copy of its source.');
  // Mask geometry lives in the masked clip's own frame, before its transform: a copy of the footage shares the footage's frame.
  const path = timelineSamples(footage, samples, target.start, target.start + target.duration, options.smoothing), offset = target.motionOffset ?? 0;
  const map = footageMapper(target, asset, aspectRatio), seed = map(path[0].x, path[0].y, options.seedTime ?? path[0].time);
  const keys = path.map(sample => {
    if (Math.abs(sourceTimeAt(target, sample.at) - sample.time) > 1e-4) throw new Error('Keep the masked copy synchronized with the tracked footage.');
    const { frame, scale, rotation } = map(sample.x, sample.y, sample.time);
    return { time: Math.max(0, sample.at - target.start) + offset, x: frame.x, y: frame.y, width: Math.max(.005, Math.min(4, shape.width * (options.followTransform === false ? 1 : (sample.scale ?? 1) * scale / seed.scale))), height: Math.max(.005, Math.min(4, shape.height * (options.followTransform === false ? 1 : (sample.scale ?? 1) * scale / seed.scale))), rotation: options.followTransform === false ? 0 : Math.max(-360, Math.min(360, (sample.rotation ?? 0) + rotation - seed.rotation)), feather: shape.feather ?? 12 };
  }).filter((key, index, list) => index === 0 || key.time > list[index - 1].time);
  return { pixelTracking: undefined, mask: { ...(samples.some(sample => sample.confidence !== undefined) ? { active: { start: keys[0].time, end: options.visibleUntil === undefined ? keys[keys.length - 1].time + 1 / (options.fps ?? 60) : timelineTimeAtSource(footage, options.visibleUntil) - target.start + offset } } : {}), shape: shape.shape, ...(shape.invert ? { invert: true } : {}), ...(shape.radius !== undefined ? { radius: shape.radius } : {}), ...(shape.text ? { text: shape.text } : {}), keys } };
}

function geometry(clip: Clip): TrackGeometry {
  const { id, kind, assetId, start, duration, sourceStart, playbackRate, speedRamp, focus, transform, crop, fit, motion, motionOffset, cameraMotion, smoothZoom } = clip;
  return { id, kind, start, duration, sourceStart, ...(assetId === undefined ? {} : { assetId }), ...(playbackRate === undefined ? {} : { playbackRate }), ...(speedRamp ? { speedRamp } : {}), ...(focus ? { focus } : {}), ...(transform ? { transform } : {}), ...(crop ? { crop } : {}), ...(fit ? { fit } : {}), ...(motion ? { motion } : {}), ...(motionOffset === undefined ? {} : { motionOffset }), ...(cameraMotion ? { cameraMotion } : {}), ...(smoothZoom ? { smoothZoom } : {}) };
}

/** A compact reference replaces per-frame keys in the timeline document. */
export function streamedAttachmentPatch(overlay: Clip, footage: Clip, asset: Pick<MediaAsset, 'width' | 'height'>, aspectRatio: AspectRatio, reference: PixelTrackReference, options: { mode: 'move' | 'mask'; offsetX?: number; offsetY?: number; smoothing?: number; followTransform?: boolean; mask?: TrackMaskSettings }): Partial<Clip> {
  assertFootage(footage);
  if (!asset.width || !asset.height) throw new Error('The footage needs source dimensions.');
  const base = { reference, footage: geometry(footage), width: asset.width, height: asset.height, aspectRatio, attachedStart: overlay.start, attachedDuration: overlay.duration, attachedMotionOffset: options.mode === 'mask' ? overlay.motionOffset ?? 0 : 0, smoothing: options.smoothing ?? .35, followTransform: options.followTransform ?? true };
  let pixelTracking: PixelTrackBinding;
  if (options.mode === 'mask') {
    if (!options.mask || !['image', 'video'].includes(overlay.kind) || overlay.assetId !== footage.assetId) throw new Error('Mask tracking needs mask settings and a synchronized source copy.');
    pixelTracking = { ...base, mode: 'mask', target: geometry(overlay), mask: options.mask };
    return { pixelTracking, mask: undefined };
  }
  overlayCenter(overlay);
  pixelTracking = { ...base, mode: 'move', offsetX: options.offsetX ?? 0, offsetY: options.offsetY ?? 0 };
  return { pixelTracking, motion: [{ time: 0, ...NEUTRAL_MOTION }], motionOffset: 0, cameraMotion: undefined, smoothZoom: undefined, ...(overlay.kind === 'caption' || overlay.kind === 'graphic' ? { animation: 'none' } : {}) };
}
