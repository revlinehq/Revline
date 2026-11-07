import { z } from 'zod';
import type { Timeline } from '../../../../editor/types';
import { baseClip, type Applied, type ExistingStack, type ReadyLayer } from './layer';

export const removeObjectInput = z.object({
  layerIds: z.array(z.string().min(1)).min(1).max(4).describe('Ready SAM 3.1 layers (from segment) of the subjects to remove, all from this footage.'),
  clipId: z.string().min(1).optional().describe("Footage clip; defaults to the first layer's clip."),
  fallback: z.enum(['bria', 'none']).optional().describe('When the free clean plate cannot do the shot (moving camera, or masked pixels never uncovered): bria (default) erases with Bria Video Eraser at $0.14 per second, within the monthly allowance; none refuses instead (small never-uncovered specks are then texture-filled, up to 1% of the frame).'),
  dilate: z.number().min(.004).max(.05).optional().describe('How far past the mask edge to fill, as a fraction of the short frame side (default .012 ≈ 13 px at 1080p). Raise it for motion blur or a soft shadow at the edge.'),
}).strict();
export type RemoveObjectInput = z.infer<typeof removeObjectInput>;

export const removeObjectDescription = "Genesis (MCP only). Remove one or more segmented subjects (SAM layers; segment a held object as its own layer, or rely on the paid path's wider mask) and save the footage without them as a new asset on the source clock; the clip then points at it (sound unchanged) and one undoLatestEdit restores the original. Method, in order: (1) free clean plate, our own compositor with no generative model, when the camera is static and every masked pixel is uncovered in some frame: each frame keeps its own pixels and the masked ones come from the temporal median of frames where they are uncovered; (2) otherwise Bria Video Eraser (mask mode, fal) on the SAM mask dilated ~30 px, in chunks of up to 5 s, at $0.14 per second of the range, counted against a monthly allowance (60 s, 120 s on Pro). fallback none refuses instead of paying. The result reports method, costUsd, coverage and the allowance left. The first call starts the render (free: ~45 s per 8 s of 1080p; Bria: ~1 minute per 5 s) and returns status processing; call removeObject again with the same input until it applies. Use it before other Genesis functions on the same clip. Check with getFrames where the subject was.";

/** Switch the footage clip to the clean plate. Nothing else moves, so one undo restores it. */
export function applyRemoveObject(timeline: Timeline, layers: ReadyLayer[], existing: ExistingStack, plateAssetId: string, clipId?: string): Applied {
  const clip = baseClip(timeline, layers[0], clipId ?? layers[0].clipId);
  for (const layer of layers.slice(1)) baseClip(timeline, layer, clip.id);
  if (clip.assetId !== layers[0].sourceAssetId) throw new Error(`Clip ${clip.id} already shows a clean plate. Undo that removeObject and remove every subject in one call (layerIds).`);
  if (existing.clipIds.some(id => id !== clip.id)) throw new Error(`Clip ${clip.id} already has Genesis clips stacked on it, and they copy the original footage, so the subject would show through. undoLatestEdit those, run removeObject first, then apply them again.`);
  const next = { ...timeline, clips: timeline.clips.map(item => item.id === clip.id ? { ...item, assetId: plateAssetId } : item) };
  return { timeline: next, baseClipId: clip.id, clipIds: [clip.id], subjectClipIds: [] };
}

/** The source range a clean plate covers: where every layer has a mask (each includes its 0.25 s handles). */
export function plateRange(layers: ReadyLayer[]) {
  const start = Math.max(...layers.map(layer => layer.start)), end = Math.min(...layers.map(layer => layer.end));
  if (!(end > start)) throw new Error('These layers cover different parts of the footage. Segment each subject over the same range.');
  return { start, end, fps: layers[0].fps };
}
