'use client';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth } from 'convex/react';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { EDITOR_PLAN, ULTRA_PLAN } from '@/lib/billing/plan';
import { PrimaryButton } from './primary-button';
import { usePlanStatus } from './use-plan-status';
import { UltraPlanCard } from './ultra-plan-card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './billing-section.css';

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
  const active = !!status?.enabled && status.configured;

  async function openBilling(plan: 'pro' | 'ultra' = 'pro') {
    if (!active || status?.complimentary || inFlight.current) return;
    inFlight.current = true; setBusy(plan); setError('');
    try {
      const result = status?.subscribed || status?.needsPayment ? await portal({}) : await checkout({ plan });
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
  const offerUltra = !!status?.ultraAvailable && active && !ultra && !status.complimentary && !status.needsPayment && !upgrading;

  return <section id="billing" className="workspace-profile-section workspace-billing-section" aria-labelledby="profile-billing-title">
    <div className="workspace-section-label"><h2 id="profile-billing-title">Membership & billing</h2><p>Your plan, payments, and invoices.</p></div>
    <div className="workspace-section-content">
      {!isAuthenticated && !isLoading ? <><p className="workspace-membership-description">Sign in to view your membership and billing.</p><div><Link className="workspace-outline-button" href="/sign-in">Sign in</Link></div></> : !status ? <div className="workspace-billing-loading" role="status"><LoaderCircle size={15} className="animate-spin" />Loading your plan…</div> : !active && !status.complimentary && !status.subscribed && !status.needsPayment && !checkoutReturn ? <p className="workspace-billing-notice">Membership is coming soon. No payment is required.</p> : <>
        <div className="workspace-membership-line"><strong>{status.plan === 'ultra' ? 'Revline Ultra' : 'Revline Pro'}</strong><span>{status.complimentary ? 'Complimentary membership' : `$${plan.monthlyPrice} / month · ${plan.currency}`}</span></div>
        <p className="workspace-billing-status">{status.complimentary ? status.complimentaryExpiresAt ? `Free access until ${new Date(status.complimentaryExpiresAt).toLocaleDateString()}` : 'Free access forever' : status.subscribed ? 'Your current plan' : 'No active plan'}</p>
        {upgrading && !ultra && <p className="workspace-billing-notice" role="status">Upgrading to Ultra. This takes a few seconds…</p>}
        {checkoutReturn && <p className="workspace-billing-notice" role="status">{checkoutReturn === 'success' ? status.subscribed ? 'Your membership is ready. You can start editing.' : 'Checkout completed. Waiting for Stripe to confirm your membership…' : 'Checkout was canceled. Your membership has not changed.'}</p>}
        {!status.complimentary && <p className="workspace-membership-description">{status.subscribed ? 'Manage your subscription, payment method, and invoices securely through Stripe.' : status.trialEligible ? `Try it free for ${EDITOR_PLAN.trialDays} days, then $${EDITOR_PLAN.monthlyPrice}/month. Cancel anytime.` : `$${EDITOR_PLAN.monthlyPrice}/month. Cancel anytime. Your free trial has already been used.`}</p>}
        {!status.complimentary && <div className="workspace-billing-actions">
          <PrimaryButton size="compact" disabled={!active || !!busy} onClick={() => void openBilling()}>{busy === 'pro' && <LoaderCircle size={14} className="animate-spin" />}{!active ? 'Coming soon' : status.subscribed || status.needsPayment ? 'Manage subscription' : status.trialEligible ? `Start ${EDITOR_PLAN.trialDays}-day free trial` : 'Subscribe to Pro'}</PrimaryButton>
          {offerUltra && <button type="button" className="workspace-outline-button" onClick={() => setUltraOpen(true)}>{status.subscribed ? 'Upgrade to Ultra' : 'See Ultra'}</button>}
        </div>}
        <Dialog open={offerUltra && ultraOpen} onOpenChange={open => { setUltraOpen(open); if (!open) setConfirmUpgrade(false); }}>
          <DialogContent className="ultra-plan-dialog">
            <DialogTitle className="sr-only">Revline Ultra</DialogTitle>
            <DialogDescription className="sr-only">What Ultra adds to Pro, and how to get it.</DialogDescription>
            <UltraPlanCard note={status.subscribed && confirmUpgrade ? 'You\'ll be charged the prorated difference today, and any remaining trial ends.' : undefined}>
          {status.subscribed
            ? <PrimaryButton disabled={!!busy} onClick={() => confirmUpgrade ? void upgradeToUltra() : setConfirmUpgrade(true)}>{busy === 'upgrade' && <LoaderCircle size={14} className="animate-spin" />}{confirmUpgrade ? 'Confirm upgrade' : 'Upgrade to Ultra'}</PrimaryButton>
            : <PrimaryButton disabled={!!busy} onClick={() => void openBilling('ultra')}>{busy === 'ultra' && <LoaderCircle size={14} className="animate-spin" />}Get Ultra</PrimaryButton>}
        </UltraPlanCard>
          </DialogContent>
        </Dialog>
        {error && <p className="workspace-inline-error" role="alert">{error}</p>}
      </>}
    </div>
  </section>;
}
