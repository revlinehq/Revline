import type { Clip } from './types';

import { MOTION_EASINGS } from './motion-path';
export const SMOOTH_ZOOM_EASINGS = MOTION_EASINGS;
export type SmoothZoomSettings = { start: number; inDuration: number; holdDuration: number; outDuration: number; scale: number; centerX: number; centerY: number; framing?: 'anchor' | 'center'; easing: typeof SMOOTH_ZOOM_EASINGS[number] };

/** Recipe times share motion's original clip-local timeline origin, including after trims. */
export function validateSmoothZoom(clip: Pick<Clip, 'kind' | 'smoothZoom'>) {
  const zoom = clip.smoothZoom;
  if (!zoom) return;
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Smooth zoom belongs to video or image clips.');
  for (const key of ['start', 'holdDuration', 'outDuration'] as const) if (!Number.isFinite(zoom[key]) || zoom[key] < 0) throw new Error(`Zoom ${key} must be a finite nonnegative number.`);
  if (!Number.isFinite(zoom.inDuration) || zoom.inDuration <= 0) throw new Error('Zoom entrance must have a positive duration.');
  if (!Number.isFinite(zoom.scale) || zoom.scale < 1 || zoom.scale > 3) throw new Error('Zoom scale must be between 1 and 3.');
  for (const key of ['centerX', 'centerY'] as const) if (!Number.isFinite(zoom[key]) || zoom[key] < 0 || zoom[key] > 1) throw new Error('Zoom focus must use normalized original-source coordinates.');
  if (!SMOOTH_ZOOM_EASINGS.includes(zoom.easing)) throw new Error('Choose a supported zoom easing.');
  if (zoom.framing !== undefined && zoom.framing !== 'anchor' && zoom.framing !== 'center') throw new Error('Choose anchor or center zoom framing.');
}

export function rescaleSmoothZoom(zoom: SmoothZoomSettings, ratio: number): SmoothZoomSettings {
  return { ...zoom, start: zoom.start * ratio, inDuration: zoom.inDuration * ratio, holdDuration: zoom.holdDuration * ratio, outDuration: zoom.outDuration * ratio };
}
