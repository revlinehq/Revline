'use client';

import { Component, createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { ChatMessage } from './assistant-results';
import './assistant-turn-costs.css';

export type AssistantTurnCost = {
  promptMessageId: string;
  knownEstimatedUsd: number;
  callCount: number;
  unknownCostCalls: number;
  unreportedRuns: number;
  truncated?: boolean;
  breakdown: { model: string | null; provider: string | null; reasoningEffort: string | null; speedMode: string | null; serviceTier: string | null; knownEstimatedUsd: number; callCount: number; unknownCostCalls: number }[];
};
export type AssistantTurnCostState = { threadId: string; reports: AssistantTurnCost[] | null | undefined };
export function turnCostPromptIds(messages: readonly ChatMessage[]) {
  return [...new Set(messages.filter(message => message.role === 'user').map(message => message.sourceId ?? message.id).filter(id => !id.startsWith('pending-')))].slice(-50);
}
export const ConnectedAssistantTurnCosts = memo(function ConnectedAssistantTurnCosts({ conversation, messages, onUpdate }: { conversation: { projectId: Id<'projects'>; threadId: string }; messages: readonly ChatMessage[]; onUpdate: (state: AssistantTurnCostState) => void }) {
  const promptMessageIds = useMemo(() => turnCostPromptIds(messages), [messages]);
  const reports = useQuery(api.aiCosts.turns, promptMessageIds.length ? { ...conversation, promptMessageIds } : 'skip');
  useLayoutEffect(() => onUpdate({ threadId: conversation.threadId, reports: promptMessageIds.length ? reports : [] }), [conversation.threadId, reports, onUpdate, promptMessageIds.length]);
  return null;
});
type CostContextValue = { enabled: boolean; reports: AssistantTurnCost[] | null | undefined };
const CostContext = createContext<CostContextValue>({ enabled: false, reports: undefined });

/** The subscription is isolated from the chat subtree, so diagnostics never remount or break it. */
export class AssistantCostQueryBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function AssistantTurnCostsProvider({ conversation, messages, demo, children }: { conversation?: { projectId: Id<'projects'>; threadId: string }; messages: readonly ChatMessage[]; demo?: boolean; children: ReactNode }) {
  const [state, setState] = useState<AssistantTurnCostState>();
  const enabled = process.env.NODE_ENV === 'development' && !!conversation && !demo;
  const reports = conversation && state?.threadId === conversation.threadId ? state.reports : undefined;
  return <CostContext.Provider value={{ enabled, reports }}>
    {enabled && conversation && <AssistantCostQueryBoundary key={conversation.threadId} onError={() => setState({ threadId: conversation.threadId, reports: null })}><ConnectedAssistantTurnCosts conversation={conversation} messages={messages} onUpdate={setState} /></AssistantCostQueryBoundary>}
    {children}
  </CostContext.Provider>;
}
export function AssistantTurnCostBadge({ promptMessageId }: { promptMessageId?: string }) {
  const context = useContext(CostContext);
  if (!context.enabled) return null;
  return <AssistantTurnCostPopover report={context.reports?.find(report => report.promptMessageId === promptMessageId)} loading={context.reports === undefined} unavailable={context.reports === null} />;
}
const cost = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: amount > 0 && amount < .01 ? 4 : 2 }).format(amount);
const mode = (value: string | null) => value ? value === 'xhigh' ? 'X-high' : value.charAt(0).toUpperCase() + value.slice(1) : 'Not recorded';
const model = (value: string | null) => value === 'gpt-6.1-sol' ? 'GPT-6.1 Sol' : value === 'gpt-6-astra' ? 'GPT-6 Astra' : value ?? 'Model not recorded';

export function AssistantTurnCostDetails({ report, loading = false, unavailable = false }: { report?: AssistantTurnCost; loading?: boolean; unavailable?: boolean }) {
  if (loading) return <p className="assistant-turn-cost-note">Loading recorded usage…</p>;
  if (!report) return <p className="assistant-turn-cost-note">{unavailable ? 'Development cost tracking is unavailable.' : 'No cost was recorded for this turn. Older messages are not backfilled.'}</p>;
  return <>
    <div className="assistant-turn-cost-total"><strong>{report.unknownCostCalls === report.callCount ? 'Unknown' : cost(report.knownEstimatedUsd)}</strong><span>Estimated API cost · {report.callCount} {report.callCount === 1 ? 'call' : 'calls'}</span></div>
    {report.breakdown.map((row, index) => <div className="assistant-turn-cost-model" key={`${row.model}-${row.reasoningEffort}-${row.speedMode}-${row.serviceTier}-${index}`}><strong>{model(row.model)}</strong><span>Reasoning: {mode(row.reasoningEffort)}</span><span>Requested speed: {mode(row.speedMode)}</span><span>Returned tier: {row.serviceTier === 'default' ? 'Standard' : mode(row.serviceTier)}</span><small>{row.callCount} {row.callCount === 1 ? 'call' : 'calls'} · {row.unknownCostCalls === row.callCount ? 'Unpriced' : cost(row.knownEstimatedUsd)}{row.unknownCostCalls > 0 ? ` · ${row.unknownCostCalls} unpriced` : ''}</small></div>)}
    {report.unknownCostCalls > 0 && <p className="assistant-turn-cost-note">{report.unknownCostCalls} unpriced {report.unknownCostCalls === 1 ? 'call is' : 'calls are'} excluded from the amount.</p>}
    {report.unreportedRuns > 0 && <p className="assistant-turn-cost-note">Some usage was not reported. The total may be incomplete.</p>}
    {report.truncated && <p className="assistant-turn-cost-note">Some usage was omitted from this report. The displayed total may be incomplete.</p>}
    <p className="assistant-turn-cost-note">All recorded model steps for this assistant turn. Token-based estimate, not an invoice. Separate media analysis is excluded.</p>
  </>;
}

/** A nonmodal popover supports mouse hover, keyboard focus and touch without trapping the chat. */
export function AssistantTurnCostPopover({ report, loading, unavailable, children }: { report?: AssistantTurnCost; loading?: boolean; unavailable?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocusAt = useRef(0);
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const show = () => { cancelClose(); setOpen(true); };
  const hideSoon = () => { cancelClose(); timer.current = setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
    <Popover.Trigger asChild><button type="button" className="assistant-turn-cost-trigger" aria-label="View development usage for this assistant turn" onMouseEnter={show} onMouseLeave={hideSoon} onPointerDown={() => { pointerFocusAt.current = Date.now(); }} onFocus={() => { if (Date.now() - pointerFocusAt.current > 500) show(); }}>{children ?? (report && report.unknownCostCalls < report.callCount ? cost(report.knownEstimatedUsd) : 'Usage')}</button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="assistant-turn-cost-popover" side="bottom" align="end" sideOffset={8} collisionPadding={12} onMouseEnter={cancelClose} onMouseLeave={hideSoon} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} onFocusOutside={() => setOpen(false)} aria-label="Development AI usage"><AssistantTurnCostDetails report={report} loading={loading} unavailable={unavailable} /></Popover.Content></Popover.Portal>
  </Popover.Root>;
}
