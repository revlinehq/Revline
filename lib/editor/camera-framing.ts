import { calculateVisualRect } from './visual-source-geometry';
import type { MotionKeyframe } from './motion-path';
import { dimensions, type AspectRatio, type Clip, type MediaAsset } from './types';

/** A footage camera cannot reveal pixels beyond the retained source window.
 * Constrain in the camera's local space so intentional static placement,
 * rotation, crop and existing contain bars remain unchanged. */
export function boundedCameraMotion(clip: Clip, asset: MediaAsset, aspectRatio: AspectRatio, keys: MotionKeyframe[]): MotionKeyframe[] {
  if ((!clip.cameraMotion && !clip.smoothZoom) || !keys.length || !asset.width || !asset.height) return keys;
  const canvas = dimensions(aspectRatio);
  const { window } = calculateVisualRect(asset.width, asset.height, canvas.width, canvas.height, clip.crop, clip.focus?.[0], clip.fit);
  const left = window.left / canvas.width, right = (window.left + window.width) / canvas.width;
  const top = window.top / canvas.height, bottom = (window.top + window.height) / canvas.height;
  return keys.map(key => {
    const x = Math.min((left - .5) * (1 - key.scale), Math.max((right - .5) * (1 - key.scale), key.x));
    const y = Math.min((top - .5) * (1 - key.scale), Math.max((bottom - .5) * (1 - key.scale), key.y));
    return x === key.x && y === key.y ? key : { ...key, x, y };
  });
}
