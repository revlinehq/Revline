import { clamp } from '../math';
import type { SourceCrop } from './types';
import type { VisualRect } from './visual-transforms';

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
const maxRemoved = .949;

export function cropSelectionRect(crop: SourceCrop, source: VisualRect): VisualRect {
  return {
    left: source.left + source.width * crop.left,
    top: source.top + source.height * crop.top,
    width: source.width * (1 - crop.left - crop.right),
    height: source.height * (1 - crop.top - crop.bottom),
  };
}

/** Deltas use the fixed, fully fitted source's screen bounds, including preview zoom. */
export function dragSourceCrop(initial: SourceCrop, handle: CropHandle, dx: number, dy: number, sourceWidth: number, sourceHeight: number): SourceCrop {
  if (!(sourceWidth > 0 && sourceHeight > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return initial;
  const x = dx / sourceWidth, y = dy / sourceHeight;
  if (handle === 'move') {
    const moveX = clamp(x, -initial.left, initial.right), moveY = clamp(y, -initial.top, initial.bottom);
    return { left: initial.left + moveX, right: initial.right - moveX, top: initial.top + moveY, bottom: initial.bottom - moveY };
  }
  const crop = { ...initial };
  if (handle.includes('w')) crop.left = clamp(initial.left + x, 0, maxRemoved - initial.right);
  if (handle.includes('e')) crop.right = clamp(initial.right - x, 0, maxRemoved - initial.left);
  if (handle.includes('n')) crop.top = clamp(initial.top + y, 0, maxRemoved - initial.bottom);
  if (handle.includes('s')) crop.bottom = clamp(initial.bottom - y, 0, maxRemoved - initial.top);
  return crop;
}

export function sameSourceCrop(first: SourceCrop, second: SourceCrop) {
  return first.left === second.left && first.top === second.top && first.right === second.right && first.bottom === second.bottom;
}
