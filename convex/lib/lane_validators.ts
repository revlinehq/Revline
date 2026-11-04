import { v } from 'convex/values';
export const laneValidator = v.union(
  v.literal('edit'),
  v.literal('motion'),
  v.literal('recreate'),
  v.literal('explainer'),
  v.literal('clip'),
  v.literal('reel'),
);
export const laneEvidenceValidator = v.object({
  tool: v.string(),
  timelineId: v.string(),
  fingerprint: v.string(),
  input: v.any(),
  output: v.any(),
});
export const laneBaselineValidator = v.object({
  timelineId: v.string(),
  fingerprint: v.string(),
  aspectRatio: v.string(),
  clips: v.array(
    v.object({
      id: v.string(),
      key: v.string(),
      start: v.number(),
      duration: v.number(),
    }),
  ),
  gaps: v.array(v.object({ start: v.number(), end: v.number() })),
});
export const laneResultValidator = v.object({
  passed: v.boolean(),
  lane: laneValidator,
  attempt: v.number(),
  exhausted: v.boolean(),
  failures: v.array(v.string()),
  fingerprint: v.string(),
  timelineId: v.string(),
  motionCheck: v.optional(v.string()),
  motionOff: v.optional(v.array(v.object({ assetId: v.string(), timelineId: v.string(), start: v.number(), end: v.number(), time: v.number(), reason: v.string() }))),
});
