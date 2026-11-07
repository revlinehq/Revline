import { z } from 'zod';

const unit = z.number().min(0).max(1);
export const segmentPrompt = z.union([
  z.object({ noun: z.string().trim().min(1).max(120) }).strict(),
  z.object({ point: z.object({ x: unit, y: unit }).strict() }).strict(),
  z.object({ box: z.object({ left: unit, top: unit, right: unit, bottom: unit }).strict().refine(box => box.right > box.left && box.bottom > box.top, 'The box needs right > left and bottom > top.') }).strict(),
]);
export type SegmentPrompt = z.infer<typeof segmentPrompt>;

export const segmentInput = z.object({
  clipId: z.string().min(1),
  prompt: segmentPrompt.describe('{noun:"dancer in red"} (SAM 3.1 grounds it on the `at` frame and must find exactly one), {point:{x,y}} or {box:{left,top,right,bottom}} in normalized SOURCE frame coordinates.'),
  at: z.number().min(0).optional().describe('TIMELINE second of the frame the prompt describes; default `start`. Pick a frame where the subject is clearly visible.'),
  start: z.number().min(0).optional().describe('TIMELINE start of the masked range; default the clip start.'),
  end: z.number().positive().optional().describe('TIMELINE end of the masked range; default the clip end.'),
}).strict();
export type SegmentInput = z.infer<typeof segmentInput>;

/** The seed the cut-out pipeline understands, from a Genesis prompt. */
export function subjectSeed(prompt: SegmentPrompt) {
  if ('noun' in prompt) return { kind: 'object' as const, noun: prompt.noun };
  if ('point' in prompt) return { kind: 'point' as const, ...prompt.point };
  return { kind: 'box' as const, box: prompt.box };
}

export const segmentDescription = "Genesis (MCP only). Segment one subject of a video clip with Meta SAM 3.1 video segmentation in the media worker and store it as a reusable layer: a per-frame mask video (kept as a transparent cut-out on the source clock), per-frame boxes, model provenance sam-3.1 and cost. prompt: {noun} | {point:{x,y}} | {box} in normalized SOURCE coordinates, describing the frame at TIMELINE second `at`. Optional TIMELINE start/end limit the range (default the whole clip; at most 120 s). SAM 3.1 tracks both directions from `at`; frames where the subject is hidden stay empty. Durable and background like trackPoints: returns layerId at once; poll getLayer until status ready (measured: 5-10 s of 720p took 2-2.5 minutes end to end). The same clip, range and prompt reuses the existing layer for free. Then layerEffect / textBehind with layerId.";

/** The most boxes one getLayer call returns; longer ranges continue from `boxes.next`. */
export const MAX_LAYER_BOXES = 720;
export const getLayerInput = z.object({
  layerId: z.string().min(1),
  from: z.number().min(0).optional().describe('SOURCE second of the first box to return; default the layer start.'),
  to: z.number().min(0).optional().describe('SOURCE second of the last box to return (inclusive); default the layer end.'),
}).strict().refine(input => input.from === undefined || input.to === undefined || input.to >= input.from, 'to must be at or after from.');
export const getLayerDescription = `Genesis (MCP only). Read a SAM 3.1 layer: status processing | ready | failed (with the worker error), progress, source range, fps, model, estimatedUsd, latency, coverage (frames, frames where the subject is visible, first/last visible source second), where layer functions placed it, and, once ready, the box of every mask frame. boxes.boxes[k] is the normalized [left, top, right, bottom] of the mask's opaque pixels at SOURCE second boxes.from + k / boxes.fps (null where the subject is hidden), so an overlay can follow the subject frame by frame. Pass from/to (SOURCE seconds) to read part of a long layer; one call returns at most ${MAX_LAYER_BOXES} frames and boxes.next is the from of the following page. Poll after segment until ready.`;
