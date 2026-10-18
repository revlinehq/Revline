import { NEUTRAL_MOTION, sampleMotionAnchors, type EasedMotionAnchor } from './motion-path';
import { boundedCameraMotion } from './camera-framing';
import { calculateVisualRect } from './visual-source-geometry';
import { validateSmoothZoom, type SmoothZoomSettings } from './smooth-zoom-settings';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type MediaAsset } from './types';

export { motionEase as zoomEase } from './motion-path';

/** Source coordinates are mapped through the same fit/crop geometry as playback/export. */
export function smoothZoomFocus(clip: Clip, asset: MediaAsset, aspectRatio: AspectRatio, point: { centerX: number; centerY: number }) {
  if (!asset.width || !asset.height) throw new Error('Source dimensions are required to position a smooth zoom.');
  const focus = clip.focus?.[0];
  if (focus && clip.focus!.some(sample => Math.abs(sample.x - focus.x) > 1e-6 || Math.abs(sample.y - focus.y) > 1e-6)) throw new Error('This clip uses moving tracked framing. Remove or replace that framing explicitly before adding a fixed smooth zoom.');
  const canvas = dimensions(aspectRatio);
  const rect = calculateVisualRect(asset.width, asset.height, canvas.width, canvas.height, clip.crop, focus, clip.fit);
  const x = rect.left + point.centerX * rect.width, y = rect.top + point.centerY * rect.height;
  if (x < rect.window.left - 1e-6 || x > rect.window.left + rect.window.width + 1e-6 || y < rect.window.top - 1e-6 || y > rect.window.top + rect.window.height + 1e-6) throw new Error('The zoom target is outside the visible crop. Choose a visible point or change the framing explicitly.');
  const transform = { ...DEFAULT_TRANSFORM, ...clip.transform }, angle = transform.rotation * Math.PI / 180;
  const dx = (x - canvas.width / 2) * transform.scale, dy = (y - canvas.height / 2) * transform.scale;
  const shownX = transform.x * canvas.width + dx * Math.cos(angle) - dy * Math.sin(angle);
  const shownY = transform.y * canvas.height + dx * Math.sin(angle) + dy * Math.cos(angle);
  if (shownX < 0 || shownX > canvas.width || shownY < 0 || shownY > canvas.height) throw new Error('The zoom target is outside the visible transformed frame. Change its framing explicitly first.');
  return { x: x / canvas.width, y: y / canvas.height };
}

/** Existing deterministic motion keys are the canonical render input, not a second clock. */
export function smoothZoomPatch(clip: Clip, asset: MediaAsset, aspectRatio: AspectRatio, settings: SmoothZoomSettings, options: { replace?: boolean } = {}): Pick<Clip, 'smoothZoom' | 'cameraMotion' | 'motion' | 'motionOffset'> {
  validateSmoothZoom({ kind: clip.kind, smoothZoom: settings });
  if (asset._id !== clip.assetId || asset.kind !== clip.kind) throw new Error('Choose the original media asset for this clip.');
  if (clip.motion?.length && !clip.smoothZoom && !clip.cameraMotion && !options.replace) throw new Error('This clip already has custom motion. Explicitly replace its motion to add a smooth zoom.');
  const end = settings.start + settings.inDuration + (settings.outDuration > 0 ? settings.holdDuration + settings.outDuration : 0);
  if (end > clip.duration + 1e-6) throw new Error('The zoom timing must fit inside the selected clip.');
  const focus = smoothZoomFocus(clip, asset, aspectRatio, settings);
  const canvas = dimensions(aspectRatio), transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const angle = transform.rotation * Math.PI / 180;
  // Move the target to the canvas center in the parent's local space. Static
  // placement/rotation/scale stay intact, so returning to neutral restores them.
  const dx = (.5 - transform.x) * canvas.width / transform.scale;
  const dy = (.5 - transform.y) * canvas.height / transform.scale;
  const destinationX = (dx * Math.cos(angle) + dy * Math.sin(angle)) / canvas.width;
  const destinationY = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / canvas.height;
  const peakX = (.5 - focus.x) * settings.scale + destinationX;
  const peakY = (.5 - focus.y) * settings.scale + destinationY;
  const anchors: EasedMotionAnchor[] = [];
  const add = (time: number, scale: number, progress = 0) => {
    const key = { time, ...NEUTRAL_MOTION, scale, x: settings.framing === 'center' ? (progress === 0 ? 0 : peakX * progress) : (.5 - focus.x) * (scale - 1), y: settings.framing === 'center' ? (progress === 0 ? 0 : peakY * progress) : (.5 - focus.y) * (scale - 1), easing: settings.easing };
    if (anchors.length && Math.abs(anchors.at(-1)!.time - time) < 1e-9) anchors[anchors.length - 1] = key;
    else anchors.push(key);
  };
  add(0, 1);
  add(settings.start, 1);
  add(settings.start + settings.inDuration, settings.scale, 1);
  if (settings.outDuration > 0) {
    const returnStart = settings.start + settings.inDuration + settings.holdDuration;
    add(returnStart, settings.scale, 1);
    add(returnStart + settings.outDuration, 1);
  }
  const motion = sampleMotionAnchors(anchors, clip.duration);
  return { smoothZoom: { ...settings }, cameraMotion:undefined, motion: boundedCameraMotion({ ...clip, smoothZoom: settings }, asset, aspectRatio, motion), motionOffset: 0 };
}
