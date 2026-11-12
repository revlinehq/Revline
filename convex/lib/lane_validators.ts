import { v } from 'convex/values';
import { LANE_IDS } from '../../lib/ai/lanes/types';
export const activeLaneValidator = v.union(...LANE_IDS.map(lane => v.literal(lane)));
// Keep persisted records readable without offering the retired workflows.
export const laneValidator = v.union(activeLaneValidator, v.literal('explainer'), v.literal('motion'), v.literal('recreate'));
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
      sourceStart: v.optional(v.number()),
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
  checkKey: v.optional(v.string()),
  motionCheck: v.optional(v.string()),
  warnings: v.optional(v.array(v.string())),
  /** Failed checks since the task last passed, including the ones that made progress. */
  checks: v.optional(v.number()),
  healed: v.optional(v.array(v.string())),
  fixes: v.optional(v.array(v.string())),
  rerun: v.optional(v.string()),
  motionOff: v.optional(v.array(v.object({ assetId: v.string(), timelineId: v.string(), start: v.number(), end: v.number(), time: v.number(), reason: v.string() }))),
});
