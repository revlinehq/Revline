'use client';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { PLANS, type PlanTier } from '@/lib/billing/plan';
import { usePlanStatus } from './use-plan-status';
import { PlanPicker } from './plan-picker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SettingsBody, SettingsCard, SettingsRow } from '@/components/dashboard/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export type CheckoutReturn = 'success' | 'canceled' | undefined;

export function BillingSection({ checkoutReturn }: { checkoutReturn?: CheckoutReturn }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const status = usePlanStatus();
  const portal = useAction(api.billing.createPortal);
  const [busy, setBusy] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [changingTo, setChangingTo] = useState<PlanTier>();
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const paymentIssue = status?.paymentIssue ?? status?.needsPayment;
  const active = !!status?.enabled && status.configured;

  /** Opens the Stripe portal: payment method, invoices and cancellation. */
  async function openPortal() {
    if (!active || status?.complimentary || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await portal({});
      if (!result.url) throw new Error('The billing link could not be opened.');
      window.location.assign(result.url);
    } catch (cause) {
      setError(userError(cause, 'Could not open billing. Please try again.'));
      inFlight.current = false; setBusy(false);
    }
  }
  const tier: PlanTier = status?.tier ?? (status?.plan === 'ultra' ? 'studio' : 'pro');
  const plan = PLANS[tier];
  // A plan change applies once Stripe's webhook syncs the new price.
  const changing = !!changingTo && changingTo !== status?.tier;

  const subscription = status?.subscriptionSource === 'apple' ? 'apple' : 'web';
  const comingSoon = !!status && !active && !status.complimentary && !status.subscribed && !paymentIssue && !checkoutReturn;
  // Choosing a plan is the page's one primary button; managing an existing plan is a quiet one.
  const buying = active && !status?.subscribed && !paymentIssue;
  const offerPlans = active && !status?.complimentary && !paymentIssue;
  const action = !isAuthenticated && !isLoading ? <Button asChild variant="soft" size="sm"><Link href="/sign-in">Sign in</Link></Button>
    : !status || comingSoon ? null
    : subscription === 'apple' ? <Button asChild variant="soft" size="sm"><a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">Manage in App Store</a></Button>
    : status.complimentary ? null : <>
      {offerPlans && <Button variant={buying ? 'primary' : 'soft'} size="sm" type="button" onClick={() => setPlansOpen(true)}>{buying ? 'See plans' : 'Change plan'}</Button>}
      {!buying && <Button variant="soft" size="sm" disabled={!active || busy} onClick={() => void openPortal()}>{active ? 'Manage billing' : 'Coming soon'}</Button>}
    </>;

  return <SettingsCard id="billing" title="Plan" action={action}>
    {!isAuthenticated && !isLoading ? <SettingsBody><p>Sign in to view your plan and billing.</p></SettingsBody>
      : !status ? ['Plan', 'Price', 'Status'].map(label => <SettingsRow key={label} label={label}><Skeleton className="h-4 w-44 max-w-full" /></SettingsRow>)
      : comingSoon ? <SettingsBody><p>Membership is coming soon. No payment is required.</p></SettingsBody>
      : subscription === 'apple' ? <>
        <SettingsRow label="Plan">{`Revline ${plan.name}`}</SettingsRow>
        <SettingsRow label="Billing">App Store subscription</SettingsRow>
        <SettingsBody><p>Your membership is active on the web and in the iOS app. Manage your plan, renewal, or cancellation in the App Store.</p></SettingsBody>
      </> : <>
        <SettingsRow label="Plan">{status.subscribed || status.complimentary ? `Revline ${plan.name}` : 'No plan yet'}</SettingsRow>
        <SettingsRow label="Price">{status.complimentary ? 'Complimentary membership' : status.subscribed ? `$${plan.monthlyPrice} per month · ${plan.currency}` : `From $${PLANS.starter.monthlyPrice} per month · ${PLANS.starter.currency}`}</SettingsRow>
        <SettingsRow label="Status">{status.complimentary ? status.complimentaryExpiresAt ? `Free access until ${new Date(status.complimentaryExpiresAt).toLocaleDateString()}` : 'Free access forever' : status.subscribed ? 'Your current plan' : 'No active plan'}</SettingsRow>
        {(changing || checkoutReturn || !status.complimentary || error) && <SettingsBody>
          {changing && <p role="status">Moving you to {PLANS[changingTo!].name}. This takes a few seconds…</p>}
          {checkoutReturn && <p role="status">{checkoutReturn === 'success' ? status.subscribed ? 'Your membership is ready. You can start editing.' : 'Checkout completed. Waiting for Stripe to confirm your membership…' : 'Checkout was canceled. Your membership has not changed.'}</p>}
          {!status.complimentary && <p>{status.subscribed
            ? 'Change your plan here. Manage your payment method, invoices and cancellation securely through Stripe.'
            : `Starter is $${PLANS.starter.monthlyPrice}, Pro $${PLANS.pro.monthlyPrice}${status.trialEligible ? ` after a ${PLANS.pro.trialDays}-day free trial` : ''}, and Studio $${PLANS.studio.monthlyPrice} a month. Cancel anytime.`}</p>}
          {error && <p className="dash-error" role="alert">{error}</p>}
        </SettingsBody>}
        <Dialog open={offerPlans && plansOpen} onOpenChange={setPlansOpen}>
          <DialogContent className="plan-dialog">
            <DialogTitle className="sr-only">Revline plans</DialogTitle>
            <DialogDescription className="sr-only">Starter, Pro and Studio: what each includes, and how to get it.</DialogDescription>
            <PlanPicker status={status} onChanged={next => { setChangingTo(next); setPlansOpen(false); }} />
          </DialogContent>
        </Dialog>
      </>}
  </SettingsCard>;
}
