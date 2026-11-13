'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PlanTier } from '@/lib/billing/plan';
import { onPlanLimit, type PlanLimit } from '@/lib/billing/limit-events';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { usePlanStatus, type PlanStatus } from './use-plan-status';
import { PlanPicker } from './plan-picker';
import './plan-card.css';

const TITLES: Record<PlanLimit['code'], string> = { storage_full: 'Your storage is full', usage_limit: 'You’ve used your AI usage' };

/** Whether this account can move to a bigger plan here: a web subscription below Studio, or no plan yet. */
export function canUpgrade(status: PlanStatus | undefined) {
  if (!status?.enabled || !status.configured || status.complimentary || status.subscriptionSource === 'apple' || status.paymentIssue) return false;
  return !status.subscribed || (status.tier ?? 'pro') !== 'studio';
}

/** The plan cards in a dialog, with what sent the person here above them. */
export function UpgradeDialog({ open, onOpenChange, status, notice, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; status: PlanStatus; notice?: { title: string; message: string }; onChanged?: (tier: PlanTier) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="plan-dialog">
      {notice ? <div className="plan-dialog-notice"><DialogTitle asChild><h2>{notice.title}</h2></DialogTitle><DialogDescription>{notice.message}</DialogDescription></div>
        : <><DialogTitle className="sr-only">Revline plans</DialogTitle><DialogDescription className="sr-only">Starter, Pro and Studio: what each includes, and how to get it.</DialogDescription></>}
      <PlanPicker status={status} onChanged={next => { onChanged?.(next); onOpenChange(false); }} />
    </DialogContent>
  </Dialog>;
}

/** Opens when an action on this page hits a plan limit (storage_full, usage_limit): the upgrade cards where a
 *  bigger plan exists, otherwise the message alone (Studio: when it resets, or where to free space). A free trial's
 *  limit is the trial's, which no upgrade lifts, so it gets the message alone too. */
export function PlanLimitDialog() {
  const status = usePlanStatus();
  const [limit, setLimit] = useState<PlanLimit | null>(null);
  useEffect(() => onPlanLimit(setLimit), []);
  if (!limit || !status) return null;
  const close = (open: boolean) => { if (!open) setLimit(null); };
  const notice = { title: TITLES[limit.code], message: limit.message };
  if (canUpgrade(status) && !limit.trial) return <UpgradeDialog open onOpenChange={close} status={status} notice={notice} />;
  return <Dialog open onOpenChange={close}>
    <DialogContent>
      <DialogTitle>{notice.title}</DialogTitle>
      <DialogDescription>{notice.message}</DialogDescription>
      <div className="flex justify-end gap-2">
        {limit.code === 'storage_full' && <Button asChild variant="soft"><Link href="/library">Open Library</Link></Button>}
        <Button variant="primary" onClick={() => setLimit(null)}>OK</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

/** The AI meter's level: warning from AI_USAGE_WARNING, full at the allowance. */
export const meterLevel = (share: number, warning: number) => share >= 1 ? 'full' : share >= warning ? 'warning' : undefined;
