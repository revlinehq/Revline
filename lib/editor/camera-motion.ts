import { validateClipEffects } from './clip-effects';
import { boundedCameraMotion } from './camera-framing';
import { NEUTRAL_MOTION, sampleMotionAnchors } from './motion-path';
import { validateCameraMotion, type CameraMotionSettings } from './camera-motion-settings';
import { smoothZoomFocus } from './smooth-zoom';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type MediaAsset } from './types';

/** Compile source targets into the same sampled motion used by preview and export. */
export function cameraMotionPatch(clip: Clip, asset: MediaAsset, aspectRatio: AspectRatio, settings: CameraMotionSettings, options: { replace?: boolean } = {}): Pick<Clip, 'cameraMotion' | 'motion' | 'motionOffset' | 'smoothZoom'> {
  validateCameraMotion({ kind: clip.kind, cameraMotion: settings });
  if (asset._id !== clip.assetId || asset.kind !== clip.kind) throw new Error('Choose the original media asset for this clip.');
  if (clip.motion?.length && !clip.cameraMotion && !clip.smoothZoom && !options.replace) throw new Error('This clip already has custom motion. Explicitly replace its motion to add a camera glide.');
  if (settings.keyframes.at(-1)!.time > clip.duration + 1e-6) throw new Error('Camera motion must fit inside the selected clip.');
  const canvas = dimensions(aspectRatio), transform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const angle = transform.rotation * Math.PI / 180;
  const dx = (.5 - transform.x) * canvas.width / transform.scale;
  const dy = (.5 - transform.y) * canvas.height / transform.scale;
  const destinationX = (dx * Math.cos(angle) + dy * Math.sin(angle)) / canvas.width;
  const destinationY = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / canvas.height;
  const anchors = settings.keyframes.map(key => {
    const focus = smoothZoomFocus(clip, asset, aspectRatio, key);
    return { time: key.time, ...NEUTRAL_MOTION, scale: key.scale, x: (.5 - focus.x) * key.scale + destinationX, y: (.5 - focus.y) * key.scale + destinationY, easing: key.easing };
  });
  if (anchors[0].time > 0) anchors.unshift({ time: 0, ...NEUTRAL_MOTION, easing: 'linear' });
  const motion = sampleMotionAnchors(anchors, clip.duration);
  const cameraMotion = { ...(settings.blurAmount!==undefined?{blurAmount:settings.blurAmount}:{}),keyframes: settings.keyframes.map(key => ({ ...key })) };
  const patch = { cameraMotion, motion: boundedCameraMotion({ ...clip, cameraMotion }, asset, aspectRatio, motion), motionOffset: 0, smoothZoom: undefined };
  validateClipEffects({ ...clip, ...patch });
  return patch;
}
