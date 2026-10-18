import { expect, test } from 'vitest';
import { CostHistoryWriter, costDashboardEnabled, costHistoryRecord, costPeriod, summarizeEditorCosts, type EditorCostRecord } from './cost-history';
const row = (patch: Partial<EditorCostRecord & { runId: string }> = {}) => ({ key: 'call:1', kind: 'model-call' as const, recordedAt: Date.parse('2026-10-18T17:00:00Z'), runId: 'run', model: 'gpt-6.1-sol', provider: 'openai.responses', reasoningEffort: 'medium', speedMode: 'fast', serviceTier: 'default', estimatedUsd: .1, inputTokens: 100, outputTokens: 40, reasoningTokens: 30, toolCallCount: 2, unreportedCall: false, ...patch });
test('tracking requires both explicit dev diagnostics gates', () => {
  expect(costDashboardEnabled({ MODEL_SWITCHER_ENABLED: 'true' })).toBe(false);
  expect(costDashboardEnabled({ AI_COST_DASHBOARD_ENABLED: 'true' })).toBe(false);
  expect(costDashboardEnabled({ AI_COST_DASHBOARD_ENABLED: 'true', MODEL_SWITCHER_ENABLED: 'true' })).toBe(true);
});
test('sanitize usage events without carrying private tool inputs, messages or metadata', () => {
  const event = { event: 'model-step', timestamp: '2026-10-18T17:00:00Z', callId: 'call', step: 1, model: 'gpt-6.1-sol', provider: 'openai.responses', inputTokens: 100, outputTokens: 40, reasoningTokens: 30, toolCallCount: 2, stepEstimatedUsd: .1, privatePrompt: 'secret', tools: [{ input: 'secret' }], providerMetadata: { secret: true } };
  const record = costHistoryRecord(event)!;
  expect(record).toMatchObject({ key: 'call:1', estimatedUsd: .1, reasoningEffort: null, speedMode: null, serviceTier: null });
  expect(JSON.stringify(record)).not.toMatch(/secret|privatePrompt|providerMetadata|tools/);
  expect(costHistoryRecord({ ...event, timestamp: 'invalid' })).toBeNull();
  expect(costHistoryRecord({ ...event, callId: undefined })).toBeNull();
  expect(costHistoryRecord({ ...event, event: 'anomaly' })).toBeNull();
  expect(costHistoryRecord({ ...event, stepEstimatedUsd: NaN })?.estimatedUsd).toBeNull();
});
test('requested Fast with returned Standard is a distinct explicit group; unknown usage is not free', () => {
  const result = summarizeEditorCosts([row(), row({ key: 'call:2', serviceTier: 'fast', estimatedUsd: .2 }), row({ key: 'call:3', model: 'old-model', reasoningEffort: null, speedMode: null, serviceTier: null, estimatedUsd: null, inputTokens: null }), row({ kind: 'run-summary', key: 'summary', unreportedCall: true })], costPeriod(7, 'America/New_York', Date.parse('2026-10-18T20:00:00Z')));
  expect(result.summary).toMatchObject({ knownEstimatedUsd: .3, callCount: 3, unknownCostCalls: 1, unreportedRuns: 1, runCount: 1, inputTokens: 200, outputTokens: 120, reasoningTokens: 90 });
  expect(result.breakdown).toHaveLength(3);
  expect(result.breakdown.find(group => group.serviceTier === 'default')).toMatchObject({ speedMode: 'fast', knownEstimatedUsd: .1 });
  expect(result.breakdown.find(group => group.model === 'old-model')).toMatchObject({ reasoningEffort: null, speedMode: null, serviceTier: null, unknownCostCalls: 1 });
  expect(result.daily).toHaveLength(7); expect(result.daily.at(-1)).toMatchObject({ date: '2026-10-18', knownEstimatedUsd: .3, callCount: 3 });
});
test('local calendar dates remain correct across daylight-saving transitions and midnight', () => {
  const period = costPeriod(7, 'America/New_York', Date.parse('2026-11-03T02:00:00Z'));
  const result = summarizeEditorCosts([row({ recordedAt: Date.parse('2026-11-02T04:59:59Z') }), row({ recordedAt: Date.parse('2026-11-02T05:00:00Z') }), row({ recordedAt: Date.parse('2026-10-27T03:59:59Z') })], period);
  expect(result.daily.at(-1)).toMatchObject({ date: '2026-11-02', callCount: 1 });
  expect(result.daily.at(-2)).toMatchObject({ date: '2026-11-01', callCount: 1 });
  expect(result.summary.callCount).toBe(2);
  expect(() => costPeriod(7, 'not-a-timezone', Date.now())).toThrow();
});

test('awaits pending writes and retries the same record once without breaking editing', async () => {
  let release: () => void = () => {}, attempts = 0;
  const saved: EditorCostRecord[] = [], warnings: number[] = [];
  const writer = new CostHistoryWriter(async record => { attempts++; if (attempts === 1) throw new Error('temporary'); await new Promise<void>(resolve => { release = resolve; }); saved.push(record); }, count => warnings.push(count));
  writer.enqueue(row());
  await Promise.resolve(); await Promise.resolve();
  let done = false; const pending = writer.flush().then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false); release(); await pending;
  expect(attempts).toBe(2); expect(saved).toHaveLength(1); expect(saved[0].key).toBe('call:1'); expect(warnings).toEqual([]);
});
test('permanent call-write failure logs and saves an explicit incomplete-run marker', async () => {
  const attempts: string[] = [], saved: EditorCostRecord[] = [], warnings: number[] = [];
  const writer = new CostHistoryWriter(async record => { attempts.push(record.key); if (record.kind === 'model-call') throw new Error('storage'); saved.push(record); }, count => warnings.push(count));
  writer.enqueue(row()); await expect(writer.flush()).resolves.toBeUndefined();
  expect(attempts).toEqual(['call:1', 'call:1', 'history-gap']); expect(warnings).toEqual([1]); expect(saved).toMatchObject([{ kind: 'run-summary', unreportedCall: true }]);
});
