import { v } from 'convex/values';
export const effectPlanValidator = v.object({
  id:v.string(),kind:v.union(v.literal('timed'),v.literal('visual'),v.literal('text'),v.literal('transition')),effect:v.string(),targetClipId:v.optional(v.string()),outputClipId:v.optional(v.string()),purpose:v.string(),strength:v.string(),expectation:v.string(),start:v.number(),duration:v.number(),peak:v.optional(v.number()),
  anchor:v.object({kind:v.union(v.literal('requested-time'),v.literal('observed-event'),v.literal('marker'),v.literal('cut')),time:v.number(),clipId:v.optional(v.string()),markerId:v.optional(v.string()),evidenceId:v.optional(v.string()),description:v.string()}),
  checks:v.optional(v.object({returnBy:v.optional(v.number()),minPixelChange:v.optional(v.number()),maxPixelChange:v.optional(v.number()),textSafe:v.optional(v.boolean()),subjectReadable:v.optional(v.boolean())})),
});
export const compositionReviewResult = v.object({
  revision:v.number(),sampleTimes:v.array(v.number()),checks:v.array(v.object({planId:v.string(),timingPass:v.boolean(),peakPixelChange:v.number(),sampledPeakTime:v.optional(v.number()),returnPass:v.optional(v.union(v.boolean(),v.null())),pixelPass:v.union(v.boolean(),v.null()),textSafe:v.union(v.boolean(),v.null())})),
  observations:v.array(v.object({planId:v.string(),verdict:v.union(v.literal('pass'),v.literal('fail'),v.literal('unverifiable')),evidence:v.string()})),uncertainty:v.string(),
});
