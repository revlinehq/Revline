import { z } from 'zod';

export const MAX_TRACK_FRAMES = 3600;
export const MAX_TRACK_SECONDS = 30;
export const PIXEL_TRACK_PROCESSOR_VERSION = 24;
const fraction = z.number().min(0).max(1);
export const trackBox = z.object({ left: fraction, top: fraction, right: fraction, bottom: fraction }).strict().refine(box => box.right > box.left && box.bottom > box.top, 'The box must have positive width and height.');
export const trackSeed = z.union([
  z.object({ kind: z.literal('point'), x: fraction, y: fraction }).strict(),
  z.object({ kind: z.literal('box'), box: trackBox }).strict(),
]);
export const pixelTrackRequest = z.object({ start: z.number().nonnegative(), end: z.number().positive(), time: z.number().nonnegative(), seed: trackSeed }).strict().refine(value => value.end > value.start && value.end - value.start <= MAX_TRACK_SECONDS && value.time >= value.start && value.time < value.end, 'Track a window of up to 30 source seconds with the seed inside it.');
const stop = z.object({ time: z.number().nonnegative(), reason: z.enum(['boundary', 'cut', 'occluded', 'out-of-frame', 'unreliable']) });
export const pixelTrackResult = z.object({
  engine: z.literal('opencv-klt-template-v1'), seedTime: z.number().nonnegative(), sourceFps: z.number().positive(), width: z.number().positive(), height: z.number().positive(),
  samples: z.array(z.object({ frameIndex: z.number().int().nonnegative(), time: z.number().nonnegative(), x: fraction, y: fraction, confidence: fraction, scale: z.number().min(.05).max(20), rotation: z.number(), box: trackBox.optional() })).min(1).max(MAX_TRACK_FRAMES),
  backward: stop, forward: stop,
});
export type PixelTrackRequest = z.infer<typeof pixelTrackRequest>;
export type PixelTrackResult = z.infer<typeof pixelTrackResult>;

export function parsePixelTrackResult(value: unknown, request: PixelTrackRequest): PixelTrackResult {
  const result = pixelTrackResult.parse(value);
  if (result.samples.some((sample, index) => sample.time < request.start - 1e-6 || sample.time >= request.end + 1e-6 || index > 0 && (sample.frameIndex !== result.samples[index - 1].frameIndex + 1 || sample.time <= result.samples[index - 1].time)) || !result.samples.some(sample => Math.abs(sample.time - result.seedTime) < 1e-6) || result.seedTime < request.start || result.seedTime >= request.end) throw new Error('Pixel tracking returned a discontinuous or out-of-window path.');
  return result;
}
