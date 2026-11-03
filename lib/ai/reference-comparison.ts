import { z } from 'zod';

export const comparisonCrop = z.object({ x: z.number().min(0).lt(1), y: z.number().min(0).lt(1), w: z.number().positive().max(1), h: z.number().positive().max(1) }).strict().refine(box => box.x + box.w <= 1 && box.y + box.h <= 1, { message: 'Keep the crop inside the frame.' });
export type ComparisonCrop = z.infer<typeof comparisonCrop>;
export const referenceCropKeyframes = z.array(z.object({ time: z.number().nonnegative(), crop: comparisonCrop }).strict()).min(1).max(60).refine(keys => keys.every((key, index) => index === 0 || key.time > keys[index - 1].time), { message: 'Reference crop keyframes must have strictly increasing SOURCE times.' });
export type ReferenceCropKeyframe = z.infer<typeof referenceCropKeyframes>[number];
export const comparisonCropFields = {
  crop: comparisonCrop.optional().describe('Shorthand crop for both sides. Each explicit side crop overrides it. Normalized displayed-frame coordinates: x/y top-left, w/h size.'),
  referenceCrop: comparisonCrop.optional().describe('Reference region in normalized displayed-frame coordinates. Use this for a demo sub-panel within a larger reference. Overrides crop on the reference side.'),
  timelineCrop: comparisonCrop.optional().describe('Timeline region in normalized displayed-frame coordinates. Omit for the full timeline frame when crop is absent, or use {x:0,y:0,w:1,h:1} to override crop. Scaled to match the reference region.'),
  referenceCropKeyframes: referenceCropKeyframes.optional().describe('Moving reference region: [{time,crop}] in strictly increasing SOURCE seconds, before offset/timelineStart. Linearly interpolate x/y/w/h; hold the nearest endpoint outside the keyed range. Overrides referenceCrop and crop.'),
};
export type ComparisonCrops = { crop?: ComparisonCrop; referenceCrop?: ComparisonCrop; timelineCrop?: ComparisonCrop; referenceCropKeyframes?: ReferenceCropKeyframe[] };
export function referenceCropAt(time: number, crop?: ComparisonCrop, keys?: ReferenceCropKeyframe[]): ComparisonCrop | undefined {
  if (!keys?.length) return crop;
  const next = keys.findIndex(key => key.time >= time);
  if (next < 0) return keys[keys.length - 1].crop;
  if (next === 0) return keys[0].crop;
  const a = keys[next - 1], b = keys[next], u = (time - a.time) / (b.time - a.time);
  return { x: a.crop.x + (b.crop.x - a.crop.x) * u, y: a.crop.y + (b.crop.y - a.crop.y) * u, w: a.crop.w + (b.crop.w - a.crop.w) * u, h: a.crop.h + (b.crop.h - a.crop.h) * u };
}
export function cropBounds(crop: ComparisonCrop, width: number, height: number) {
  const left = Math.min(width - 1, Math.floor(crop.x * width + 1e-6)), top = Math.min(height - 1, Math.floor(crop.y * height + 1e-6));
  return { left, top, width: Math.max(1, Math.min(width - left, Math.round(crop.w * width))), height: Math.max(1, Math.min(height - top, Math.round(crop.h * height))) };
}
export const REFERENCE_COMPARISON_BUDGET_MS = 4 * 60_000;
const shared = { assetId: z.string().min(1), offset: z.number().optional(), ...comparisonCropFields };
const times = z.array(z.number().min(0)).min(1).describe('Reference seconds. Use sparse times only for steady stretches.');
const fps = z.number().min(1).max(30);
const range = { start: z.number().min(0), end: z.number().min(0), fps: fps.default(15) };
const samplingInput = z.union([
  z.object({ ...shared, times }).strict(),
  z.object({ ...shared, ...range }).strict().refine(input => input.end > input.start && Number.isSafeInteger(Math.ceil((input.end - input.start) * input.fps))),
]);
// MCP adds projectId and timelineId to the top-level object. Keep the alternatives inside boundary validation.
export const referenceComparisonInput = z.object({ ...shared, times: times.optional(), start: range.start.optional(), end: range.end.optional(), fps: fps.optional() }).strict().refine(input => samplingInput.safeParse(input).success, { message: 'Give either times, or an increasing start/end range with optional fps (default 15). Follow nextAction when the time budget returns a partial comparison.' });

/** Generate only the next batch, so long windows do not allocate every sample before the budget starts. */
export function comparisonSamples(raw: z.infer<typeof referenceComparisonInput>) {
  const input = samplingInput.parse(raw);
  if ('times' in input) return { count: input.times.length, batch: (first: number) => input.times.slice(first, first + 6) };
  const count = Math.floor((input.end - input.start) * input.fps + 1e-6);
  const samples = count + 1 + (input.end - (input.start + count / input.fps) > 1e-6 ? 1 : 0);
  return { count: samples, batch: (first: number) => Array.from({ length: Math.min(6, samples - first) }, (_, index) => first + index <= count ? input.start + (first + index) / input.fps : input.end) };
}
