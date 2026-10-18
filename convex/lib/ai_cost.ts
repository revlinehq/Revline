import { v } from 'convex/values';
const nullableText = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());
export const aiCostRecordFields = {
  key: v.string(), kind: v.union(v.literal('model-call'), v.literal('run-summary')), recordedAt: v.number(),
  model: nullableText, provider: nullableText, reasoningEffort: nullableText, speedMode: nullableText, serviceTier: nullableText,
  estimatedUsd: nullableNumber, inputTokens: nullableNumber, outputTokens: nullableNumber, reasoningTokens: nullableNumber,
  toolCallCount: v.number(), unreportedCall: v.boolean(),
};
const totalFields = { knownEstimatedUsd: v.number(), callCount: v.number(), unknownCostCalls: v.number(), inputTokens: v.number(), outputTokens: v.number(), reasoningTokens: v.number(), toolCallCount: v.number() };
export const aiCostSummary = v.object({
  period: v.object({ start: v.number(), end: v.number(), days: v.number(), timeZone: v.string() }),
  summary: v.object({ ...totalFields, unreportedRuns: v.number(), runCount: v.number() }),
  daily: v.array(v.object({ date: v.string(), knownEstimatedUsd: v.number(), callCount: v.number(), unknownCostCalls: v.number() })),
  breakdown: v.array(v.object({ model: nullableText, provider: nullableText, reasoningEffort: nullableText, speedMode: nullableText, serviceTier: nullableText, ...totalFields })),
  truncated: v.boolean(), recordingSince: nullableNumber,
});
