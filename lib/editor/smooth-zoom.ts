import { NEUTRAL_MOTION, type MotionKeyframe } from './clip-effects';
import { calculateVisualRect } from './visual-source-geometry';
import { validateSmoothZoom, type SmoothZoomSettings } from './smooth-zoom-settings';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type MediaAsset } from './types';

export function zoomEase(progress: number, easing: SmoothZoomSettings['easing']) {
  const p = Math.max(0, Math.min(1, progress));
  if (easing === 'focused-spring') {
    // Critically damped spring: fast response, smooth braking, no overshoot.
    // Normalize its finite window so preview/export land exactly on the target.
    return (1 - (1 + 9 * p) * Math.exp(-9 * p)) / (1 - 10 * Math.exp(-9));
  }
  return easing === 'ease-in-out' ? p * p * (3 - 2 * p) : easing === 'ease-out' ? 1 - (1 - p) ** 3 : p;
}

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
export function smoothZoomPatch(clip: Clip, asset: MediaAsset, aspectRatio: AspectRatio, settings: SmoothZoomSettings, options: { replace?: boolean } = {}): Pick<Clip, 'smoothZoom' | 'motion' | 'motionOffset'> {
  validateSmoothZoom({ kind: clip.kind, smoothZoom: settings });
  if (asset._id !== clip.assetId || asset.kind !== clip.kind) throw new Error('Choose the original media asset for this clip.');
  if (clip.motion?.length && !clip.smoothZoom && !options.replace) throw new Error('This clip already has custom motion. Explicitly replace its motion to add a smooth zoom.');
  const end = settings.start + settings.inDuration + (settings.outDuration > 0 ? settings.holdDuration + settings.outDuration : 0);
  if (end > clip.duration + 1e-6) throw new Error('The zoom timing must fit inside the selected clip.');
  const focus = smoothZoomFocus(clip, asset, aspectRatio, settings);
  const motion: MotionKeyframe[] = [];
  const add = (time: number, scale: number) => {
    const key = { time, ...NEUTRAL_MOTION, scale, x: (.5 - focus.x) * (scale - 1), y: (.5 - focus.y) * (scale - 1) };
    if (motion.length && Math.abs(motion.at(-1)!.time - time) < 1e-9) motion[motion.length - 1] = key;
    else motion.push(key);
  };
  add(0, 1);
  add(settings.start, 1);
  const steps = settings.easing === 'linear' ? 1 : 32;
  for (let index = 1; index <= steps; index++) add(settings.start + settings.inDuration * index / steps, 1 + (settings.scale - 1) * zoomEase(index / steps, settings.easing));
  if (settings.outDuration > 0) {
    const returnStart = settings.start + settings.inDuration + settings.holdDuration;
    add(returnStart, settings.scale);
    for (let index = 1; index <= steps; index++) add(returnStart + settings.outDuration * index / steps, settings.scale + (1 - settings.scale) * zoomEase(index / steps, settings.easing));
  }
  if (clip.duration > motion.at(-1)!.time + 1e-9) add(clip.duration, settings.outDuration > 0 ? 1 : settings.scale);
  return { smoothZoom: { ...settings }, motion, motionOffset: 0 };
}
