'use client';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { EDITOR_PLAN, ULTRA_PLAN } from '@/lib/billing/plan';
import { PrimaryButton } from './primary-button';
import { usePlanStatus } from './use-plan-status';
import { UltraPlanCard } from './ultra-plan-card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SettingsBody, SettingsCard, SettingsRow } from '@/components/dashboard/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import './billing-section.css';
import { Button } from '@/components/ui/button';

export type CheckoutReturn = 'success' | 'canceled' | undefined;

export function BillingSection({ checkoutReturn }: { checkoutReturn?: CheckoutReturn }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const status = usePlanStatus();
  const checkout = useAction(api.billing.createCheckout);
  const portal = useAction(api.billing.createPortal);
  const upgrade = useAction(api.billing.upgradeToUltra);
  const [busy, setBusy] = useState<'' | 'pro' | 'ultra' | 'upgrade'>('');
  const [confirmUpgrade, setConfirmUpgrade] = useState(false);
  const [ultraOpen, setUltraOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const paymentIssue = status?.paymentIssue ?? status?.needsPayment;
  const active = !!status?.enabled && status.configured;

  async function openBilling(plan: 'pro' | 'ultra' = 'pro') {
    if (!active || status?.complimentary || inFlight.current) return;
    inFlight.current = true; setBusy(plan); setError('');
    try {
      const result = status?.subscribed || paymentIssue ? await portal({}) : await checkout({ plan });
      if (!result.url) throw new Error('The billing link could not be opened.');
      window.location.assign(result.url);
    } catch (cause) {
      setError(userError(cause, 'Could not open billing. Please try again.'));
      inFlight.current = false; setBusy('');
    }
  }
  async function upgradeToUltra() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('upgrade'); setError('');
    try { await upgrade({}); setUpgrading(true); setConfirmUpgrade(false); setUltraOpen(false); }
    catch (cause) { setError(userError(cause, 'Could not upgrade to Ultra. Please try again.')); }
    finally { inFlight.current = false; setBusy(''); }
  }
  const ultra = status?.plan === 'ultra';
  const plan = ultra ? ULTRA_PLAN : EDITOR_PLAN;
  // Upgrades apply once Stripe's webhook syncs the new price.
  const offerUltra = !!status?.ultraAvailable && active && !ultra && !status.complimentary && !paymentIssue && !upgrading;

  const subscription = status?.subscriptionSource === 'apple' ? 'apple' : 'web';
  const comingSoon = !!status && !active && !status.complimentary && !status.subscribed && !paymentIssue && !checkoutReturn;
  // A purchase is the page's one primary button; managing an existing plan is a quiet one.
  const buying = active && !status?.subscribed && !paymentIssue;
  const action = !isAuthenticated && !isLoading ? <Button asChild variant="soft" size="sm"><Link href="/sign-in">Sign in</Link></Button>
    : !status || comingSoon ? null
    : subscription === 'apple' ? <Button asChild variant="soft" size="sm"><a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">Manage in App Store</a></Button>
    : status.complimentary ? null : <>
      {offerUltra && <Button variant="soft" size="sm" type="button" onClick={() => setUltraOpen(true)}>{status.subscribed ? 'Upgrade to Ultra' : 'See Ultra'}</Button>}
      <Button variant={buying ? 'primary' : 'soft'} size="sm" disabled={!active || !!busy} onClick={() => void openBilling()}>{!active ? 'Coming soon' : !buying ? 'Manage plan' : status.trialEligible ? `Start ${EDITOR_PLAN.trialDays}-day free trial` : 'Subscribe to Pro'}</Button>
    </>;

  return <SettingsCard id="billing" title="Plan" action={action}>
    {!isAuthenticated && !isLoading ? <SettingsBody><p>Sign in to view your plan and billing.</p></SettingsBody>
      : !status ? ['Plan', 'Price', 'Status'].map(label => <SettingsRow key={label} label={label}><Skeleton className="h-4 w-44 max-w-full" /></SettingsRow>)
      : comingSoon ? <SettingsBody><p>Membership is coming soon. No payment is required.</p></SettingsBody>
      : subscription === 'apple' ? <>
        <SettingsRow label="Plan">{ultra ? 'Revline Ultra' : 'Revline Pro'}</SettingsRow>
        <SettingsRow label="Billing">App Store subscription</SettingsRow>
        <SettingsBody><p>Your membership is active on the web and in the iOS app. Manage your plan, renewal, or cancellation in the App Store.</p></SettingsBody>
      </> : <>
        <SettingsRow label="Plan">{ultra ? 'Revline Ultra' : 'Revline Pro'}</SettingsRow>
        <SettingsRow label="Price">{status.complimentary ? 'Complimentary membership' : `$${plan.monthlyPrice} per month · ${plan.currency}`}</SettingsRow>
        <SettingsRow label="Status">{status.complimentary ? status.complimentaryExpiresAt ? `Free access until ${new Date(status.complimentaryExpiresAt).toLocaleDateString()}` : 'Free access forever' : status.subscribed ? 'Your current plan' : 'No active plan'}</SettingsRow>
        {(upgrading && !ultra || checkoutReturn || !status.complimentary || error) && <SettingsBody>
          {upgrading && !ultra && <p role="status">Upgrading to Ultra. This takes a few seconds…</p>}
          {checkoutReturn && <p role="status">{checkoutReturn === 'success' ? status.subscribed ? 'Your membership is ready. You can start editing.' : 'Checkout completed. Waiting for Stripe to confirm your membership…' : 'Checkout was canceled. Your membership has not changed.'}</p>}
          {!status.complimentary && <p>{status.subscribed ? 'Manage your subscription, payment method, and invoices securely through Stripe.' : status.trialEligible ? `Try it free for ${EDITOR_PLAN.trialDays} days, then $${EDITOR_PLAN.monthlyPrice}/month. Cancel anytime.` : `$${EDITOR_PLAN.monthlyPrice}/month. Cancel anytime. Your free trial has already been used.`}</p>}
          {error && <p className="dash-error" role="alert">{error}</p>}
        </SettingsBody>}
        <Dialog open={offerUltra && ultraOpen} onOpenChange={open => { setUltraOpen(open); if (!open) setConfirmUpgrade(false); }}>
          <DialogContent className="ultra-plan-dialog">
            <DialogTitle className="sr-only">Revline Ultra</DialogTitle>
            <DialogDescription className="sr-only">What Ultra adds to Pro, and how to get it.</DialogDescription>
            <UltraPlanCard note={status.subscribed && confirmUpgrade ? 'You\'ll be charged the prorated difference today, and any remaining trial ends.' : undefined}>
          {status.subscribed
            ? <PrimaryButton disabled={!!busy} onClick={() => confirmUpgrade ? void upgradeToUltra() : setConfirmUpgrade(true)}>{confirmUpgrade ? 'Confirm upgrade' : 'Upgrade to Ultra'}</PrimaryButton>
            : <PrimaryButton disabled={!!busy} onClick={() => void openBilling('ultra')}>Get Ultra</PrimaryButton>}
        </UltraPlanCard>
          </DialogContent>
        </Dialog>
      </>}
  </SettingsCard>;
}
