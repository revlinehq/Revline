import { z } from 'zod';
import { sourceEndOf } from '../../../../editor/playback-rate';
import type { Clip, Timeline } from '../../../../editor/types';
import { placeStack, syncedCopy, type Applied, type ExistingStack, type ReadyLayer } from './layer';

const unit = z.number().min(0).max(1);
const corner = z.tuple([unit, unit]);
export const replaceSurfaceInput = z.object({
  clipId: z.string().min(1).describe('Footage clip that shows the surface.'),
  assetId: z.string().min(1).describe('Image or video asset in this project to put on the surface (uploadMedia / copyMedia first).'),
  at: z.number().min(0).describe('TIMELINE second of the frame the corners (or the surface layer) describe. Pick a frame where the surface is whole and unblocked.'),
  corners: z.tuple([corner, corner, corner, corner]).optional().describe('The surface corners on frame `at`, normalized SOURCE [x,y], in the insert\'s own order: top-left, top-right, bottom-right, bottom-left of the image as it should appear.'),
  surfaceLayerId: z.string().min(1).optional().describe('Instead of corners: a ready SAM 3.1 layer of the surface (segment with a box around it); its mask on frame `at` gives the four corners.'),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe('surfaceLayerId only: turn the insert when the layer-derived corners put its top on the wrong side.'),
  occluderLayerIds: z.array(z.string().min(1)).max(4).optional().describe('Ready SAM 3.1 layers of things that pass in front of the surface (a hand). They stay on top, and are ignored for tracking.'),
  lightMatch: z.boolean().optional().describe("Carry the surface's average brightness change (relative to frame `at`) onto the insert (default true)."),
  fit: z.enum(['cover', 'stretch']).optional().describe('cover (default) crops the insert to the surface\'s aspect; stretch fills it exactly.'),
}).strict().refine(input => (input.corners ? 1 : 0) + (input.surfaceLayerId ? 1 : 0) === 1, 'Give exactly one of corners or surfaceLayerId.');
export type ReplaceSurfaceInput = z.infer<typeof replaceSurfaceInput>;

export const replaceSurfaceDescription = "Genesis (MCP only). Put an image or video on a flat surface in footage (a phone screen, a sign, a car door) and keep it there as the camera or surface moves. Give the four corners on frame `at` (normalized SOURCE, in the insert's top-left, top-right, bottom-right, bottom-left order) or a SAM 3.1 surfaceLayerId to derive them. The media worker tracks the surface with the pixel tracker's KLT internals fitted to a homography anchored on frame `at` (falling back to a similarity when features bunch on one side), warps the insert per frame, and optionally carries the surface's brightness change onto it (lightMatch, default on). Our own compositor, no generative model. occluderLayerIds: SAM layers of things passing in front (a hand), stacked above the insert and excluded from tracking. Stack: footage < surface insert (alpha video) < occluder cut-outs. Frames where tracking is lost stay uncovered and are reported. The first call starts the render and returns status processing; call replaceSurface again with the same input until it applies. Check with getFrames: corners hug the surface, occluders stay in front.";

/** Footage < surface insert (synced alpha copy) < occluder cut-outs (plain subject copies, reused when present). */
export function applyReplaceSurface(timeline: Timeline, clip: Clip, occluders: ReadyLayer[], existing: ExistingStack, insertAssetId: string, newId: () => string): Applied {
  const insert = syncedCopy(clip, newId(), 0, { assetId: insertAssetId });
  let placed = placeStack(timeline, clip, existing, { plate: insert });
  const subjects: string[] = [];
  for (const layer of occluders) {
    const known = { clipIds: [...existing.clipIds, insert.id, ...subjects], subjectClipIds: [...existing.subjectClipIds, ...subjects] };
    placed = placeStack(placed.timeline, clip, known, { subject: syncedCopy(clip, newId(), 0, { assetId: layer.outputAssetId }) });
    subjects.push(placed.subject!.id);
  }
  return { timeline: placed.timeline, baseClipId: clip.id, clipIds: [insert.id, ...subjects], subjectClipIds: subjects };
}

/** The source range a surface render covers: the clip, plus up to 0.25 s handles inside the layers and the footage. */
export function surfaceRange(clip: Clip, layers: ReadyLayer[], sourceDuration: number) {
  const from = clip.sourceStart, to = sourceEndOf(clip);
  const start = Math.max(0, from - .25, ...layers.map(layer => layer.start)), end = Math.min(sourceDuration, to + .25, ...layers.map(layer => layer.end));
  if (start > from + 1e-3 || end < to - 1e-3) throw new Error(`The layers mask source ${start.toFixed(2)}–${end.toFixed(2)}s but clip ${clip.id} plays ${from.toFixed(2)}–${to.toFixed(2)}s. Segment them over the whole clip.`);
  return { start, end };
}
