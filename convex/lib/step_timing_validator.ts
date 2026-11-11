import { v } from 'convex/values';

/** One model call or tool call of a run (lib/ai/step-timing.ts StepTiming). */
export const stepTimingValidator = v.object({
  step: v.number(), kind: v.union(v.literal('model'), v.literal('tool')), name: v.optional(v.string()), at: v.number(), ms: v.number(),
  firstOutputMs: v.optional(v.number()), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()), cacheWriteTokens: v.optional(v.number()), failed: v.optional(v.boolean()), key: v.optional(v.string()),
});
