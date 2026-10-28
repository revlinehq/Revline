'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import './ai-cost-report.css';

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
  return model === 'gpt-6.1-sol' ? 'GPT-6.1 Sol' : model === 'gpt-6-astra' ? 'GPT-6 Astra' : model === 'gpt-6.1-terra' ? 'GPT-6.1 Terra' : model === 'gpt-5.4-mini' ? 'GPT-5.4 mini' : model ?? 'Model not recorded';
}

function modeLabel(value: string | null) {
  return value ? value === 'xhigh' ? 'X-high' : value.charAt(0).toUpperCase() + value.slice(1) : 'Not recorded';
}

export function AiCostReportView({ report, days, onDaysChange, loading = false }: { report: AiCostReport | null | undefined; days: 7 | 30; onDaysChange: (days: 7 | 30) => void; loading?: boolean }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected = report?.daily.find(day => day.date === selectedDate) ?? report?.daily.at(-1);
  const max = Math.max(...(report?.daily.map(day => day.knownEstimatedUsd) ?? []), 0.0001);
  const count = (value: number) => value.toLocaleString('en-US');

  return <section className="workspace-profile-section ai-cost-section" aria-labelledby="ai-cost-title">
    <div className="workspace-section-label"><h2 id="ai-cost-title">Editor AI costs <span className="ai-cost-dev-label">Development</span></h2><p>Recorded usage by model and mode.</p></div>
    <div className="workspace-section-content ai-cost-report" aria-busy={loading}>
      <div className="ai-cost-toolbar"><span>Estimated API spend · USD</span><Tabs value={String(days)} onValueChange={value => { setSelectedDate(null); onDaysChange(Number(value) as 7 | 30); }}><TabsList aria-label="Cost reporting period">{([7, 30] as const).map(period => <TabsTrigger key={period} value={String(period)}>{period} days</TabsTrigger>)}</TabsList></Tabs></div>
      {loading || report === undefined ? <p className="ai-cost-notice" role="status">Loading recorded costs…</p> : report === null ? <p className="ai-cost-notice">Cost tracking is unavailable in this environment.</p> : <>
        <div className="ai-cost-totals"><div><strong>{formatAiCost(report.summary.knownEstimatedUsd)}</strong><span>Known estimated cost</span></div><div><strong>{count(report.summary.callCount)}</strong><span>Model calls</span></div><div><strong>{count(report.summary.inputTokens + report.summary.outputTokens)}</strong><span>Recorded tokens</span></div></div>
        {report.summary.callCount > 0 ? <>
          <div className="ai-cost-chart-scroll" tabIndex={0} aria-label="Daily cost chart; scroll horizontally for all dates"><div className="ai-cost-chart" style={{ minWidth: days === 30 ? 540 : undefined }} role="group" aria-label="Daily estimated API cost">
            {report.daily.map((day, index) => <button key={day.date} type="button" className="ai-cost-day" aria-pressed={selected?.date === day.date} aria-label={`${dayLabel(day.date, { month: 'long', day: 'numeric' })}: ${formatAiCost(day.knownEstimatedUsd)}, ${day.callCount} model calls${day.unknownCostCalls ? `, ${day.unknownCostCalls} with unknown cost` : ''}`} onClick={() => setSelectedDate(day.date)}><span className="ai-cost-bar-track"><span className="ai-cost-bar" style={{ height: `${day.knownEstimatedUsd / max * 100}%` }} /></span><span className="ai-cost-day-label">{days === 7 || index % 5 === 0 || index === report.daily.length - 1 ? dayLabel(day.date, days === 7 ? { month: 'short', day: 'numeric' } : { day: 'numeric' }) : '\u00a0'}</span></button>)}
          </div></div>
          <p className="ai-cost-selected" aria-live="polite">{selected ? <><span>{dayLabel(selected.date, { month: 'short', day: 'numeric' })}</span><strong>{formatAiCost(selected.knownEstimatedUsd)}</strong><span>{count(selected.callCount)} calls{selected.unknownCostCalls ? ` · ${count(selected.unknownCostCalls)} unpriced` : ''}</span></> : 'No daily usage recorded.'}</p>
          <div className="ai-cost-breakdown"><h3>Models & modes</h3>{report.breakdown.map((row, index) => <div className="ai-cost-model" key={`${row.model}-${row.reasoningEffort}-${row.speedMode}-${row.serviceTier}-${index}`}><div className="ai-cost-model-details"><strong>{modelLabel(row.model)}</strong><span>Reasoning: {modeLabel(row.reasoningEffort)} · Speed: {modeLabel(row.speedMode)}</span>{row.serviceTier && <span>Billed tier: {row.serviceTier === 'default' ? 'Standard' : modeLabel(row.serviceTier)}</span>}<small>{count(row.callCount)} {row.callCount === 1 ? 'call' : 'calls'} · {count(row.inputTokens + row.outputTokens)} tokens · {count(row.toolCallCount)} tool calls</small>{row.unknownCostCalls > 0 && <small>{count(row.unknownCostCalls)} {row.unknownCostCalls === 1 ? 'call has' : 'calls have'} no price estimate</small>}</div><strong className="ai-cost-model-amount">{row.unknownCostCalls === row.callCount ? 'Unknown' : formatAiCost(row.knownEstimatedUsd)}</strong></div>)}</div>
          <Collapsible className="ai-cost-token-details group/collapsible"><CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm">Token details<ChevronDown className="transition-transform group-data-[state=open]/collapsible:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent><dl><div><dt>Input</dt><dd>{count(report.summary.inputTokens)}</dd></div><div><dt>Output</dt><dd>{count(report.summary.outputTokens)}</dd></div><div><dt>Reasoning (included in output)</dt><dd>{count(report.summary.reasoningTokens)}</dd></div><div><dt>Tool calls</dt><dd>{count(report.summary.toolCallCount)}</dd></div></dl></CollapsibleContent></Collapsible>
        </> : <p className="ai-cost-notice">No model calls recorded for this period. New editing requests will appear here as usage is saved.</p>}
        <div className="ai-cost-footnotes">
          <p>Estimates from recorded token usage, not your provider invoice. {report.summary.unknownCostCalls > 0 ? `${count(report.summary.unknownCostCalls)} unpriced ${report.summary.unknownCostCalls === 1 ? 'call is' : 'calls are'} excluded from the total. ` : ''}Separate media analysis costs are not included. Daily totals use {report.period.timeZone}.</p>
          <p>{report.recordingSince !== null ? `Recording since ${new Date(report.recordingSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: report.period.timeZone })}. ` : 'Tracking begins with new model calls. '}Earlier console-only usage is not included.</p>
          {report.summary.unreportedRuns > 0 && <p>{count(report.summary.unreportedRuns)} edit {report.summary.unreportedRuns === 1 ? 'run may' : 'runs may'} include calls with unreported usage. In-flight or interrupted calls may be missing.</p>}
          {report.truncated && <p>High usage exceeded this report’s record limit. The totals shown cover the most recent recorded calls only.</p>}
        </div>
      </>}
    </div>
  </section>;
}
