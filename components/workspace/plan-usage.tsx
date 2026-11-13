'use client';
import { useState } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { AI_USAGE_WARNING } from '@/lib/billing/plan';
import { connectedCount } from '@/lib/posting/account-caps';
import { formatBytes } from '@/components/library/format';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SettingsRow } from '@/components/dashboard/settings-card';
import { usePlanStatus } from './use-plan-status';
import { UpgradeDialog, canUpgrade, meterLevel } from './plan-limit-dialog';
import './plan-card.css';

export type PlanUsage = FunctionReturnType<typeof api.usage.status>;
/** The meters, with a day or period that has ended since the query last ran read as reset: Convex re-runs the
 *  query only when its data changes, not when the clock passes midnight or the period end. */
export function usePlanUsage(): PlanUsage | undefined {
  const { isAuthenticated } = useConvexAuth();
  const usage = useQuery(api.usage.status, isAuthenticated ? {} : 'skip');
  if (!usage?.ai) return usage;
  const now = Date.now(), ai = usage.ai;
  const used = now >= ai.resetsAt ? 0 : ai.used, today = ai.today === null ? null : now >= ai.dayResetsAt || now >= ai.resetsAt ? 0 : ai.today;
  return { ...usage, ai: { ...ai, used, today, blocked: used >= 1 ? 'month' : today !== null && today >= 1 ? 'day' : null } };
}
const percent = (share: number) => Math.min(100, Math.round(share * 100));
const resetDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
/** The larger of the period's and today's share: what decides the next refusal. */
export const aiShare = (ai: NonNullable<PlanUsage['ai']>) => Math.max(ai.used, ai.today ?? 0);

function Meter({ label, detail, share }: { label: string; detail: string; share: number }) {
  return <div className="plan-meter" data-level={meterLevel(share, AI_USAGE_WARNING)}>
    <div className="plan-meter-label"><span>{label}</span><small>{detail}</small></div>
    <Progress value={percent(share)} aria-label={`${label}: ${detail}`} />
  </div>;
}

/** Settings → Plan: storage against the plan's limit, connected social accounts against theirs, AI usage as a percentage, and when it resets. */
export function PlanUsageRows({ usage }: { usage: PlanUsage }) {
  const { storage, ai } = usage, stored = storage.usedBytes + storage.reservedBytes;
  const accounts = useQuery(api.posting.accountAllowance, {});
  return <>
    <SettingsRow label="Storage">{storage.limitBytes === null
      ? `${formatBytes(stored)} used`
      : <Meter label={`${formatBytes(stored)} of ${formatBytes(storage.limitBytes)}`} detail={`${percent(stored / storage.limitBytes)}%`} share={stored / storage.limitBytes} />}</SettingsRow>
    {accounts && <SettingsRow label="Social accounts">{connectedCount(accounts.connected, accounts.limit)}</SettingsRow>}
    {ai && <SettingsRow label="AI usage"><Meter label={ai.blocked === 'day' ? 'Today’s limit reached' : `${percent(ai.used)}% used this period`} detail={ai.today !== null ? `${percent(ai.today)}% of today’s` : ''} share={aiShare(ai)} /></SettingsRow>}
    {ai && <SettingsRow label="Resets">{resetDate(ai.resetsAt)}</SettingsRow>}
  </>;
}

/** In the editor from 80% of the AI allowance (period or day) until it resets; at 100% new requests are refused. */
export function AiUsageBanner() {
  const usage = usePlanUsage(), status = usePlanStatus();
  const [open, setOpen] = useState(false);
  const ai = usage?.ai;
  if (!ai || !status || aiShare(ai) < AI_USAGE_WARNING) return null;
  const day = (ai.today ?? 0) > ai.used;
  const text = ai.blocked
    ? ai.blocked === 'day' ? 'You’ve used today’s AI usage. It resets at midnight UTC.'
      : usage?.trial ? `You’ve used your free trial’s AI usage. Your plan’s full allowance starts with your first payment on ${resetDate(ai.resetsAt)}.`
      : `You’ve used this period’s AI usage. It resets on ${resetDate(ai.resetsAt)}.`
    : day ? `You’ve used ${percent(ai.today ?? 0)}% of today’s AI usage.` : `You’ve used ${percent(ai.used)}% of this period’s AI usage. It resets on ${resetDate(ai.resetsAt)}.`;
  // A free trial's allowance is the trial's until the first payment; a bigger plan does not raise it.
  const upgrade = canUpgrade(status) && !usage?.trial;
  return <div className="ai-usage-banner" role="status">
    <p>{text}</p>
    {upgrade && <Button variant="soft" size="sm" onClick={() => setOpen(true)}>Upgrade</Button>}
    {upgrade && <UpgradeDialog open={open} onOpenChange={setOpen} status={status} />}
  </div>;
}
