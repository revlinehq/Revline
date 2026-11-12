'use client';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { PLANS, PLAN_RANK, PLAN_TIERS, type PlanTier } from '@/lib/billing/plan';
import { Button } from '@/components/ui/button';
import { PlanCard, PlanGrid } from './plan-card';
import { PrimaryButton } from './primary-button';
import type { PlanStatus } from './use-plan-status';

/** The three plans with their actions. Without a plan, each card opens Stripe Checkout for that plan; on a web
 *  subscription, the other cards change the plan in place after a confirming second click. */
export function PlanPicker({ status, onChanged }: { status: PlanStatus; onChanged?: (tier: PlanTier) => void }) {
  const checkout = useAction(api.billing.createCheckout);
  const change = useAction(api.billing.changePlan);
  const [busy, setBusy] = useState<PlanTier | ''>('');
  const [confirming, setConfirming] = useState<PlanTier | ''>('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const current = status.subscribed ? status.tier ?? 'pro' : null;
  const trial = status.trialEligible && !status.subscribed;

  async function choose(tier: PlanTier) {
    if (!status.configured || inFlight.current) return;
    if (current && confirming !== tier) { setConfirming(tier); setError(''); return; }
    inFlight.current = true; setBusy(tier); setError('');
    try {
      if (current) { await change({ plan: tier }); setConfirming(''); onChanged?.(tier); }
      else {
        const result = await checkout({ plan: tier });
        if (!result.url) throw new Error('Could not open checkout. Please try again.');
        window.location.assign(result.url);
        return;
      }
    } catch (cause) {
      setError(userError(cause, 'Could not change your plan. Please try again.'));
    }
    inFlight.current = false; setBusy('');
  }

  const label = (tier: PlanTier) => {
    const name = PLANS[tier].name;
    if (!current) return tier === 'pro' && trial ? `Start ${PLANS.pro.trialDays}-day free trial` : `Get ${name}`;
    if (confirming === tier) return `Confirm ${PLAN_RANK[tier] > PLAN_RANK[current] ? 'upgrade' : 'change'}`;
    return PLAN_RANK[tier] > PLAN_RANK[current] ? `Upgrade to ${name}` : `Switch to ${name}`;
  };
  const note = (tier: PlanTier) => {
    if (current && confirming === tier) return PLAN_RANK[tier] > PLAN_RANK[current]
      ? 'You’ll be charged the prorated difference today, and any remaining trial ends.'
      : `Unused time is credited to your next invoice. If you’re on a free trial, it ends now and ${PLANS[tier].name} is billed today.`;
    if (!current && tier === 'pro' && trial) return `${PLANS.pro.trialDays} days free, then $${PLANS.pro.monthlyPrice}/month`;
    return !current ? 'Cancel anytime' : undefined;
  };

  return <>
    <PlanGrid>
      {PLAN_TIERS.map(tier => <PlanCard key={tier} tier={tier} badge={current === tier ? 'Current plan' : !current && PLANS[tier].featured ? 'Most popular' : undefined} note={note(tier)}>
        {current === tier
          ? <Button variant="soft" disabled>Your current plan</Button>
          : PLANS[tier].featured || confirming === tier
            ? <PrimaryButton disabled={!!busy || !status.configured} onClick={() => void choose(tier)}>{busy === tier && <LoaderCircle size={14} className="animate-spin" />}{label(tier)}</PrimaryButton>
            : <Button variant="soft" disabled={!!busy || !status.configured} onClick={() => void choose(tier)}>{busy === tier && <LoaderCircle size={14} className="animate-spin" />}{label(tier)}</Button>}
      </PlanCard>)}
    </PlanGrid>
    {!status.configured && <p className="plan-picker-message" role="status">Billing is temporarily unavailable. Please try again shortly.</p>}
    {error && <p className="plan-picker-message plan-picker-error" role="alert">{error}</p>}
  </>;
}
