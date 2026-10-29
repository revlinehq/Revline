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

function dayLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

function modelLabel(model: string | null) {
  return model === 'gpt-6.1-sol' ? 'GPT-6.1 Sol' : model === 'gpt-6-astra' ? 'GPT-6 Astra' : model === 'gpt-6.1-terra' ? 'GPT-6.1 Terra' : model === 'gpt-5.4-mini' ? 'GPT-5.4 mini' : model === 'gemini-4-argon' ? 'Gemini 4 Argon' : model ?? 'Model not recorded';
}

function modeLabel(value: string | null) {
  return value ? value === 'xhigh' ? 'X-high' : value.charAt(0).toUpperCase() + value.slice(1) : 'Not recorded';
}

