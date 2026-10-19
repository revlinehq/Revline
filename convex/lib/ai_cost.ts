import { v } from 'convex/values';
const nullableText = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());
export const aiCostRecordFields = {
  key: v.string(), kind: v.union(v.literal('model-call'), v.literal('run-summary')), recordedAt: v.number(),
  model: nullableText, provider: nullableText, reasoningEffort: nullableText, speedMode: nullableText, serviceTier: nullableText,
  estimatedUsd: nullableNumber, inputTokens: nullableNumber, outputTokens: nullableNumber, reasoningTokens: nullableNumber,
  uncachedInputTokens:v.optional(nullableNumber),cacheReadTokens:v.optional(nullableNumber),cacheWriteTokens:v.optional(nullableNumber),
  toolCallCount: v.number(), unreportedCall: v.boolean(),
};
const totalFields = { knownEstimatedUsd: v.number(), callCount: v.number(), unknownCostCalls: v.number(), inputTokens: v.number(), uncachedInputTokens:v.number(),cacheReadTokens:v.number(),cacheWriteTokens:v.number(),unknownCacheUsageCalls:v.number(),outputTokens: v.number(), reasoningTokens: v.number(), toolCallCount: v.number() };
const breakdown = v.array(v.object({ model: nullableText, provider: nullableText, reasoningEffort: nullableText, speedMode: nullableText, serviceTier: nullableText, ...totalFields }));
export const aiCostTurnReport = v.object({promptMessageId:v.string(),...totalFields,unreportedRuns:v.number(),runCount:v.number(),breakdown,truncated:v.boolean()});
export const aiCostSummary = v.object({
  period: v.object({ start: v.number(), end: v.number(), days: v.number(), timeZone: v.string() }),
  summary: v.object({ ...totalFields, unreportedRuns: v.number(), runCount: v.number() }),
  daily: v.array(v.object({ date: v.string(), knownEstimatedUsd: v.number(), callCount: v.number(), unknownCostCalls: v.number() })),
  breakdown,
  truncated: v.boolean(), recordingSince: nullableNumber,
});
