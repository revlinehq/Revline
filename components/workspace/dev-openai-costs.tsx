'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenAiCostReport } from '@/lib/server/openai-costs';
import { formatAiCost } from './ai-cost-report';
import './dev-openai-costs.css';

type Report = OpenAiCostReport | { connected: false };
export function DevOpenAiCosts({ days }: { days: 7 | 30 }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/dev/openai-costs?days=${days}`, { cache: 'no-store' });
      const data = await response.json() as Report & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not load OpenAI costs.');
      if (current === generation.current) setReport(data as Report);
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not load OpenAI costs.'); }
    finally { if (current === generation.current) setBusy(false); }
  }, [days]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = JSON.stringify({ adminKey: values.get('adminKey'), projectId: values.get('projectId') });
    const keyField = form.elements.namedItem('adminKey');
    if (keyField instanceof HTMLInputElement) keyField.value = '';
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/dev/openai-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not connect OpenAI costs.');
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not connect OpenAI costs.'); }
    finally { setBusy(false); }
  }
  const connected = report?.connected ? report : null;
  const maximum = Math.max(...(connected?.daily.map(day => day.usd) ?? []), 0.0001);
  return <section className="workspace-profile-section ai-cost-section" aria-labelledby="openai-reported-cost-title">
    <div className="workspace-section-label"><h2 id="openai-reported-cost-title">OpenAI-reported project cost</h2><p>Official project totals, separate from edit estimates.</p></div>
    <div className="workspace-section-content openai-cost-report" aria-busy={busy}>
      {connected ? <>
        <div className="openai-cost-top"><div><strong>{formatAiCost(connected.totalUsd)}</strong><span>Last {connected.days} days · USD</span></div><button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
        <div className="openai-cost-chart" role="img" aria-label={`OpenAI reported ${formatAiCost(connected.totalUsd)} over the last ${connected.days} days`}>
          {connected.daily.map(day => <div key={day.date} title={`${day.date} (UTC): ${formatAiCost(day.usd)}`}><span style={{ height: `${Math.max(0, day.usd) / maximum * 100}%` }} /></div>)}
        </div>
        <div className="openai-cost-chart-labels" aria-hidden="true"><span>{connected.daily[0]?.date}</span><span>{connected.daily.at(-1)?.date} · UTC</span></div>
        <p className="openai-cost-meta">Project <code>{connected.projectId}</code></p>
        <p className="openai-cost-meta">Refreshed {new Date(connected.refreshedAt).toLocaleString()}. Daily totals use UTC. OpenAI reporting may lag recent requests.</p>
        <p className="openai-cost-meta">This includes all reported API activity in the selected project. OpenAI’s costs endpoint does not split these totals by reasoning effort. The model and mode breakdown below remains estimated.</p>
      </> : report?.connected === false ? <form className="openai-cost-connect" onSubmit={connect}>
        <p>Connect a Usage read-only Admin API key to show this project’s official costs. The key stays in this computer’s development server.</p>
        <label>API project ID<input name="projectId" required placeholder="proj_…" autoComplete="off" spellCheck={false} disabled={busy} /></label>
        <label>Usage read-only Admin key<input type="password" name="adminKey" required placeholder="sk-admin-…" autoComplete="off" spellCheck={false} disabled={busy} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect costs'}</button>
      </form> : busy ? <p className="openai-cost-meta" role="status">Checking costs connection…</p> : null}
      {error && <div className="openai-cost-error" role="alert"><p>{error}</p>{!connected && <button type="button" disabled={busy} onClick={() => void load()}>Retry</button>}</div>}
    </div>
  </section>;
}
