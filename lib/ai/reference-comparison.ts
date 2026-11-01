import { z } from 'zod';

export const comparisonCrop = z.object({ x: z.number().min(0).lt(1), y: z.number().min(0).lt(1), w: z.number().positive().max(1), h: z.number().positive().max(1) }).strict().refine(box => box.x + box.w <= 1 && box.y + box.h <= 1, { message: 'Keep the crop inside the frame.' });
export type ComparisonCrop = z.infer<typeof comparisonCrop>;
export function cropBounds(crop: ComparisonCrop, width: number, height: number) {
  const left = Math.min(width - 1, Math.floor(crop.x * width)), top = Math.min(height - 1, Math.floor(crop.y * height));
  return { left, top, width: Math.max(1, Math.min(width - left, Math.round(crop.w * width))), height: Math.max(1, Math.min(height - top, Math.round(crop.h * height))) };
}
const MAX_SAMPLES = 60;
const shared = { assetId: z.string().min(1), offset: z.number().optional(), crop: comparisonCrop.optional().describe('Score only this region, normalized 0 to 1 in each displayed frame. x/y are its top-left, w/h its size. Crop both images to the same region before scoring.') };
const times = z.array(z.number().min(0)).min(1).max(MAX_SAMPLES).describe('Reference seconds. Use sparse times only for steady stretches.');
const fps = z.number().min(1).max(30);
const range = { start: z.number().min(0), end: z.number().min(0), fps: fps.default(15) };
const samplingInput = z.union([
  z.object({ ...shared, times }).strict(),
  z.object({ ...shared, ...range }).strict().refine(input => input.end > input.start && Math.ceil((input.end - input.start) * input.fps - 1e-6) + 1 <= MAX_SAMPLES),
]);
// MCP adds projectId and timelineId to the top-level object. Keep the alternatives inside boundary validation.
export const referenceComparisonInput = z.object({ ...shared, times: times.optional(), start: range.start.optional(), end: range.end.optional(), fps: fps.optional() }).strict().refine(input => samplingInput.safeParse(input).success, { message: 'Give either times, or an increasing start/end range with optional fps (default 15), up to 60 samples. Split longer transitions into adjoining ranges.' });

export function comparisonTimes(raw: z.infer<typeof referenceComparisonInput>) {
  const input = samplingInput.parse(raw);
  if ('times' in input) return input.times;
  const count = Math.floor((input.end - input.start) * input.fps + 1e-6);
  const times = Array.from({ length: count + 1 }, (_, index) => input.start + index / input.fps);
  if (input.end - times[times.length - 1] > 1e-6) times.push(input.end);
  return times;
}
