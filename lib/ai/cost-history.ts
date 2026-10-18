export const costDashboardEnabled = (env: Record<string, string | undefined> = process.env) => env.AI_COST_DASHBOARD_ENABLED === 'true' && env.MODEL_SWITCHER_ENABLED === 'true';

/** Sanitized usage only. Never persist prompts, responses, tool inputs or provider metadata. */
export type EditorCostRecord = {
  key: string;
  kind: 'model-call' | 'run-summary';
  recordedAt: number;
  model: string | null;
  provider: string | null;
  reasoningEffort: string | null;
  speedMode: string | null;
  serviceTier: string | null;
  estimatedUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  toolCallCount: number;
  unreportedCall: boolean;
};
const text = (value: unknown) => typeof value === 'string' && value.length <= 160 ? value : null;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function costHistoryRecord(event: Record<string, unknown>): EditorCostRecord | null {
  if (event.event !== 'model-step' && event.event !== 'run-summary') return null;
  const recordedAt = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
  if (!Number.isFinite(recordedAt)) return null;
  const summary = event.event === 'run-summary';
  const callId = text(event.callId), step = count(event.step);
  if (!summary && (!callId || step === null)) return null;
  return {
    key: summary ? 'summary' : `${callId}:${step}`,
    kind: summary ? 'run-summary' : 'model-call', recordedAt,
    model: text(event.model), provider: text(event.provider), reasoningEffort: text(event.reasoningEffort), speedMode: text(event.speedMode), serviceTier: text(event.serviceTier),
    estimatedUsd: !summary && typeof event.stepEstimatedUsd === 'number' && Number.isFinite(event.stepEstimatedUsd) && event.stepEstimatedUsd >= 0 ? event.stepEstimatedUsd : null,
    inputTokens: summary ? null : count(event.inputTokens), outputTokens: summary ? null : count(event.outputTokens), reasoningTokens: summary ? null : count(event.reasoningTokens),
    toolCallCount: summary ? 0 : count(event.toolCallCount) ?? 0,
    unreportedCall: summary && event.unreportedCall === true,
  };
}
export const COST_HISTORY_LIMIT = 5000;
type StoredCost = EditorCostRecord & { runId: string };
const round = (value: number) => Math.round(value * 1e12) / 1e12;
export function costPeriod(days: 7 | 30, timeZone: string, now: number) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateAt = (time: number) => {
    const parts = formatter.formatToParts(time);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
  };
  const today = dateAt(now), firstDay = Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000;
  const dates = Array.from({ length: days }, (_, index) => new Date(firstDay + index * 86400000).toISOString().slice(0, 10));
  // Find the first instant of the local day, including DST and non-hour offsets.
  let lower = firstDay - 86400000, upper = firstDay + 86400000;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (dateAt(middle) < dates[0]) lower = middle; else upper = middle;
  }
  return { start: upper, end: now, days, timeZone, dates, dateAt };
}
const totals = () => ({ knownEstimatedUsd: 0, callCount: 0, unknownCostCalls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, toolCallCount: 0 });
export function summarizeEditorCosts(records: StoredCost[], period: ReturnType<typeof costPeriod>) {
  const summary = { ...totals(), unreportedRuns: 0, runCount: 0 };
  const daily = period.dates.map(date => ({ date, knownEstimatedUsd: 0, callCount: 0, unknownCostCalls: 0 }));
  const days = new Map(daily.map(day => [day.date, day]));
  const groups = new Map<string, ReturnType<typeof totals> & Pick<EditorCostRecord, 'model' | 'provider' | 'reasoningEffort' | 'speedMode' | 'serviceTier'>>();
  const runs = new Set<string>(), unreported = new Set<string>();
  for (const record of records) {
    const day = days.get(period.dateAt(record.recordedAt));
    if (!day || record.recordedAt > period.end) continue;
    runs.add(record.runId);
    if (record.kind === 'run-summary') { if (record.unreportedCall) unreported.add(record.runId); continue; }
    const identity = { model: record.model, provider: record.provider, reasoningEffort: record.reasoningEffort, speedMode: record.speedMode, serviceTier: record.serviceTier };
    const key = JSON.stringify(identity);
    if (!groups.has(key)) groups.set(key, { ...identity, ...totals() });
    const group = groups.get(key)!;
    for (const target of [summary, group]) {
      target.callCount++;
      if (record.estimatedUsd === null) target.unknownCostCalls++; else target.knownEstimatedUsd = round(target.knownEstimatedUsd + record.estimatedUsd);
      target.inputTokens += record.inputTokens ?? 0; target.outputTokens += record.outputTokens ?? 0; target.reasoningTokens += record.reasoningTokens ?? 0; target.toolCallCount += record.toolCallCount;
    }
    day.callCount++;
    if (record.estimatedUsd === null) day.unknownCostCalls++; else day.knownEstimatedUsd = round(day.knownEstimatedUsd + record.estimatedUsd);
  }
  summary.runCount = runs.size; summary.unreportedRuns = unreported.size;
  return { summary, daily, breakdown: [...groups.values()].sort((a, b) => b.knownEstimatedUsd - a.knownEstimatedUsd || b.callCount - a.callCount) };
}

/** Keep diagnostics failures separate from editing, but do not abandon pending writes on return. */
export class CostHistoryWriter {
  private pending: Promise<void>[] = [];
  private failed = 0;
  constructor(private save: (record: EditorCostRecord) => Promise<unknown>, private warn: (failedWrites: number) => void) {}
  enqueue(record: EditorCostRecord) {
    this.pending.push(this.write(record));
  }
  private async write(record: EditorCostRecord) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await this.save(record); return; } catch { /* A stable record key makes one retry safe. */ }
    }
    this.failed++;
    this.warn(this.failed);
  }
  async flush(): Promise<void> {
    await Promise.all(this.pending);
    if (!this.failed) return;
    // If some per-call writes failed, mark the run incomplete wherever storage is available.
    await this.write({ key: 'history-gap', kind: 'run-summary', recordedAt: Date.now(), model: null, provider: null, reasoningEffort: null, speedMode: null, serviceTier: null, estimatedUsd: null, inputTokens: null, outputTokens: null, reasoningTokens: null, toolCallCount: 0, unreportedCall: true });
  }
}
