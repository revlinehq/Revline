import type { Clip } from './types';
import { SMOOTH_ZOOM_EASINGS, type SmoothZoomSettings } from './smooth-zoom-settings';

export type CameraMotionSettings = { blurAmount?:number; keyframes: { time: number; scale: number; centerX: number; centerY: number; easing: SmoothZoomSettings['easing'] }[] };

/** Recipe times retain motion's original clip-local origin through trims and splits. */
export function validateCameraMotion(clip: Pick<Clip, 'kind' | 'cameraMotion' | 'smoothZoom'>) {
  const camera = clip.cameraMotion;
  if (!camera) return;
  if(camera.blurAmount!==undefined&&(!Number.isFinite(camera.blurAmount)||camera.blurAmount<0||camera.blurAmount>1))throw new Error('Camera motion blur must be between 0 and 1.');
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Camera motion belongs to video or image clips.');
  if (clip.smoothZoom) throw new Error('Use one camera motion or smooth zoom recipe per clip.');
  if (!Array.isArray(camera.keyframes) || camera.keyframes.length < 2 || camera.keyframes.length > 8) throw new Error('Use between 2 and 8 camera keyframes.');
  for (const [index, key] of camera.keyframes.entries()) {
    if (!Number.isFinite(key.time) || key.time < 0 || index > 0 && key.time <= camera.keyframes[index - 1].time) throw new Error('Camera keyframes need finite, increasing nonnegative times.');
    if (!Number.isFinite(key.scale) || key.scale < 1 || key.scale > 3) throw new Error('Camera scale must be between 1 and 3.');
    for (const axis of ['centerX', 'centerY'] as const) if (!Number.isFinite(key[axis]) || key[axis] < 0 || key[axis] > 1) throw new Error('Camera targets must use normalized original-source coordinates.');
    if (!SMOOTH_ZOOM_EASINGS.includes(key.easing)) throw new Error('Choose a supported camera easing.');
  }
}

export function rescaleCameraMotion(camera: CameraMotionSettings, ratio: number): CameraMotionSettings {
  return { ...camera,keyframes: camera.keyframes.map(key => ({ ...key, time: key.time * ratio })) };
}
