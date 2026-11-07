import { v } from 'convex/values';
import { MCP_LANE_IDS } from '../../lib/ai/lanes/types';
// Stored lanes include MCP-only lanes; selection surfaces decide which ones a caller may choose.
export const activeLaneValidator = v.union(...MCP_LANE_IDS.map(lane => v.literal(lane)));
// Keep persisted records readable without offering the retired workflow.
export const laneValidator = v.union(activeLaneValidator, v.literal('explainer'));
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
  checkKey: v.optional(v.string()),
  motionCheck: v.optional(v.string()),
  warnings: v.optional(v.array(v.string())),
  motionOff: v.optional(v.array(v.object({ assetId: v.string(), timelineId: v.string(), start: v.number(), end: v.number(), time: v.number(), reason: v.string() }))),
});
