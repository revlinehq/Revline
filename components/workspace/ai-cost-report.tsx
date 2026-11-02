'use client';


export type AiCostReport = {
  period: { start: number; end: number; days: number; timeZone: string };
  summary: { knownEstimatedUsd: number; callCount: number; unknownCostCalls: number; unreportedRuns: number; runCount: number; inputTokens: number; outputTokens: number; reasoningTokens: number; toolCallCount: number };
  daily: { date: string; knownEstimatedUsd: number; callCount: number; unknownCostCalls: number }[];
  breakdown: { model: string | null; provider: string | null; reasoningEffort: string | null; speedMode: string | null; serviceTier: string | null; knownEstimatedUsd: number; callCount: number; unknownCostCalls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; toolCallCount: number }[];
  truncated: boolean;
  recordingSince: number | null;
};

export function formatAiCost(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 }).format(value);
}
