import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCostReportView, formatAiCost, type AiCostReport } from './ai-cost-report';
import { DevAiCosts } from './dev-ai-costs';

const connection = vi.hoisted(() => ({ isAuthenticated: true, isLoading: false }));
const query = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => vi.fn(() => connection));
vi.mock('convex/react', () => ({ useConvexAuth: auth, useQuery: query }));

const report: AiCostReport = {
  period: { start: 0, end: 1, days: 7, timeZone: 'America/New_York' },
  summary: { knownEstimatedUsd: .1234, callCount: 3, unknownCostCalls: 1, unreportedRuns: 1, runCount: 2, inputTokens: 1500, outputTokens: 500, reasoningTokens: 200, toolCallCount: 4 },
  daily: [{ date: '2026-10-18', knownEstimatedUsd: .1234, callCount: 3, unknownCostCalls: 1 }],
  breakdown: [{ model: 'gpt-6.1-sol', provider: 'openai', reasoningEffort: 'medium', speedMode: 'fast', serviceTier: 'default', knownEstimatedUsd: .1234, callCount: 2, unknownCostCalls: 0, inputTokens: 1500, outputTokens: 500, reasoningTokens: 200, toolCallCount: 4 }, { model: null, provider: null, reasoningEffort: null, speedMode: null, serviceTier: null, knownEstimatedUsd: 0, callCount: 1, unknownCostCalls: 1, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, toolCallCount: 0 }],
  truncated: true, recordingSince: Date.UTC(2026, 9, 18),
};

describe('development cost report', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it('does not mount auth or cost queries in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(renderToStaticMarkup(<DevAiCosts />)).toBe('');
    expect(auth).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('separates requested mode and actual billed tier, unknown costs and incomplete history', () => {
    const html = renderToStaticMarkup(<AiCostReportView report={report} days={7} onDaysChange={() => {}} />);
    expect(html).toContain('Reasoning: Medium · Speed: Fast');
    expect(html).toContain('Billed tier: Standard');
    expect(html).toContain('Model not recorded');
    expect(html).toContain('Reasoning: Not recorded · Speed: Not recorded');
    expect(html).toContain('Unknown');
    expect(html).toContain('1 unpriced call is excluded from the total');
    expect(html).toContain('Earlier console-only usage is not included');
    expect(html).toContain('include calls with unreported usage');
    expect(html).toContain('most recent recorded calls only');
    expect(html).toContain('2,000'); // Reasoning is already included in output; no double counting.
    expect(html).not.toContain('2,200');
  });

  it('does not mistake loading or disabled diagnostics for zero spend', () => {
    expect(renderToStaticMarkup(<AiCostReportView report={undefined} days={7} onDaysChange={() => {}} />)).toContain('Loading recorded costs');
    const disabled = renderToStaticMarkup(<AiCostReportView report={null} days={7} onDaysChange={() => {}} />);
    expect(disabled).toContain('unavailable in this environment');
    expect(disabled).not.toContain('$0.00');
  });

  it('retains sub-cent costs without rounding them to zero', () => {
    expect(formatAiCost(.0012)).toBe('$0.0012');
    expect(formatAiCost(0)).toBe('$0.00');
  });
});
