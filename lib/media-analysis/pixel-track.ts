import { z } from 'zod';
import type { Clip, AspectRatio } from '../editor/types';
import type { MaskShape } from '../editor/masks';

const fraction = z.number().min(0).max(1);
export const trackBox = z.object({ left: fraction, top: fraction, right: fraction, bottom: fraction }).strict().refine(box => box.right > box.left && box.bottom > box.top, 'The box must have positive width and height.');
export const trackSeed = z.union([
  z.object({ kind: z.literal('point'), x: fraction, y: fraction }).strict(),
  z.object({ kind: z.literal('box'), box: trackBox }).strict(),
]);
const subjectSeed = z.union([trackSeed, z.object({ kind: z.literal('object'), noun: z.string().trim().min(1).max(120) }).strict()]);
export const subjectSelection = z.object({ time:z.number().nonnegative(), seed:subjectSeed }).strict();
export const pixelTrackRequest = z.object({ start: z.number().nonnegative(), end: z.number().positive(), time: z.number().nonnegative(), seed: subjectSeed }).strict().refine(value => value.end > value.start && value.time >= value.start && value.time < value.end, 'The seed must be inside the source tracking window.');
export function subjectSelectionKey(selection: z.infer<typeof subjectSelection> | undefined) {
  if(!selection)return '';
  const {time,seed}=selection;
  if(seed.kind==='object')return JSON.stringify([time,seed.kind,seed.noun]);
  if(seed.kind==='point')return JSON.stringify([time,seed.kind,seed.x,seed.y]);
  return JSON.stringify([time,seed.kind,seed.box.left,seed.box.top,seed.box.right,seed.box.bottom]);
}
const stop = z.object({ time: z.number().nonnegative(), reason: z.enum(['boundary', 'cut', 'occluded', 'out-of-frame', 'unreliable']) });
export const pixelTrackSample = z.object({ frameIndex: z.number().int().nonnegative(), time: z.number().nonnegative(), x: fraction, y: fraction, confidence: fraction, scale: z.number().positive(), rotation: z.number(), box: trackBox.optional() });
export const pixelTrackHeader = z.object({ seedTime: z.number().nonnegative(), sourceFps: z.number().positive(), width: z.number().positive(), height: z.number().positive() });
const trackGrounding = z.object({ provider: z.enum(['fal-florence-2', 'gemini']), noun: z.string(), box: trackBox, time: z.number().nonnegative() });
const pixelTrackSummary = pixelTrackHeader.extend({ grounding: trackGrounding.optional(), engine: z.literal('opencv-klt-template-v2'), sampleCount: z.number().int().positive(), minConfidence: fraction, firstTime: z.number().nonnegative(), lastTime: z.number().nonnegative(), backward: stop, forward: stop });
const legacyPixelTrackResult = pixelTrackHeader.extend({ engine: z.literal('opencv-klt-template-v1'), samples: z.array(pixelTrackSample).min(1), backward: stop, forward: stop });
const pixelTrackResult = z.discriminatedUnion('engine', [legacyPixelTrackResult, pixelTrackSummary]);
export const pixelTrackChunk = z.object({ direction: z.enum(['forward', 'backward']), sequence: z.number().int().nonnegative(), samples: z.array(pixelTrackSample).min(1) });
export const pixelTrackMessage = z.discriminatedUnion('type', [z.object({ type: z.literal('header'), header: pixelTrackHeader }), z.object({ type: z.literal('chunk'), chunk: pixelTrackChunk }), z.object({ type: z.literal('complete'), result: pixelTrackSummary })]);
export const pixelTrackPage = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued'), sampleCount: z.number().nonnegative() }),
  z.object({ status: z.literal('failed'), error: z.string() }),
  z.object({ status: z.literal('completed'), summary: pixelTrackSummary, samples: z.array(pixelTrackSample), window: z.object({ start: z.number(), end: z.number() }), nextCursor: z.number().nullable() }),
]);
export const pixelTrackFileIndex = z.object({ summary: pixelTrackSummary, chunks: z.array(z.object({ start: z.number(), end: z.number(), file: z.string() })) });
export type PixelTrackRequest = z.infer<typeof pixelTrackRequest>;
export type PixelTrackResult = z.infer<typeof pixelTrackResult>;
export type PixelTrackSummary = z.infer<typeof pixelTrackSummary>;
export type PixelTrackChunk = z.infer<typeof pixelTrackChunk>;
export type PixelTrackPage = z.infer<typeof pixelTrackPage>;
export type PixelTrackReference = { trackId: string; token: string };
export type TrackGeometry = Pick<Clip, 'id' | 'kind' | 'assetId' | 'start' | 'duration' | 'sourceStart' | 'playbackRate' | 'speedRamp' | 'focus' | 'transform' | 'crop' | 'fit' | 'motion' | 'motionOffset' | 'cameraMotion' | 'smoothZoom'>;
export type TrackMaskSettings = { shape: MaskShape; width: number; height: number; feather?: number; invert?: boolean; radius?: number; text?: string };
type BindingBase = { reference: PixelTrackReference; footage: TrackGeometry; width: number; height: number; aspectRatio: AspectRatio; attachedStart: number; attachedDuration: number; attachedMotionOffset: number; smoothing: number; followTransform: boolean };
export type PixelTrackBinding = BindingBase & ({ mode: 'move'; offsetX: number; offsetY: number } | { mode: 'mask'; target: TrackGeometry; mask: TrackMaskSettings });

export function summarizePixelTrack(result: PixelTrackResult): PixelTrackSummary {
  if (result.engine === 'opencv-klt-template-v2') return result;
  return { engine: 'opencv-klt-template-v2', seedTime: result.seedTime, sourceFps: result.sourceFps, width: result.width, height: result.height, sampleCount: result.samples.length, minConfidence: result.samples.reduce((minimum, sample) => Math.min(minimum, sample.confidence), 1), firstTime: result.samples[0].time, lastTime: result.samples[result.samples.length - 1].time, backward: result.backward, forward: result.forward };
}

export function parsePixelTrackResult(value: unknown, request: PixelTrackRequest): PixelTrackResult {
  const result = pixelTrackResult.parse(value), summary = summarizePixelTrack(result);
  if (summary.firstTime < request.start - 1e-6 || summary.lastTime >= request.end + 1e-6 || summary.firstTime > summary.seedTime || summary.lastTime < summary.seedTime || summary.seedTime < request.start || summary.seedTime >= request.end) throw new Error('Pixel tracking returned an out-of-window path.');
  if (result.engine === 'opencv-klt-template-v1' && result.samples.some((sample, index) => index > 0 && (sample.frameIndex !== result.samples[index - 1].frameIndex + 1 || sample.time <= result.samples[index - 1].time))) throw new Error('Pixel tracking returned a discontinuous path.');
  return result;
}
