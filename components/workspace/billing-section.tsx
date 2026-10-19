'use client';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth, useQuery } from 'convex/react';
import { Check, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { EDITOR_PLAN } from '@/lib/billing/plan';
import { PrimaryButton } from './primary-button';
import './billing-section.css';

export type CheckoutReturn = 'success' | 'canceled' | undefined;
const features = [
  'Edit clips, captions, and graphics',
  'Direct your edits in conversation',
  'Preview your changes as they happen',
  'Export your finished video',
];

export function BillingSection({ checkoutReturn }: { checkoutReturn?: CheckoutReturn }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const status = useQuery(api.billing.status, isAuthenticated ? {} : 'skip');
  const checkout = useAction(api.billing.createCheckout);
  const portal = useAction(api.billing.createPortal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const active = !!status?.enabled && status.configured;

  async function openBilling() {
    if (!active || status?.complimentary || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = status?.subscribed || status?.needsPayment ? await portal({}) : await checkout({ plan: 'pro' });
      if (!result.url) throw new Error('The billing link could not be opened.');
      window.location.assign(result.url);
    } catch (cause) {
      setError(userError(cause, 'Could not open billing. Please try again.'));
      inFlight.current = false; setBusy(false);
    }
  }

  return <section id="billing" className="workspace-profile-section workspace-billing-section" aria-labelledby="profile-billing-title">
    <div className="workspace-section-label"><h2 id="profile-billing-title">Membership & billing</h2><p>Your plan, payments, and invoices.</p></div>
    <div className="workspace-section-content">
      {!isAuthenticated && !isLoading ? <><p className="workspace-membership-description">Sign in to view your membership and billing.</p><div><Link className="workspace-outline-button" href="/sign-in">Sign in</Link></div></> : !status ? <div className="workspace-billing-loading" role="status"><LoaderCircle size={15} className="animate-spin" />Loading your plan…</div> : <>
        <div className="workspace-membership-line"><strong>{EDITOR_PLAN.name}</strong><span>{status.complimentary ? 'Complimentary membership' : `$${EDITOR_PLAN.monthlyPrice} / month · ${EDITOR_PLAN.currency}`}</span></div>
        <p className="workspace-billing-status">{status.complimentary ? status.complimentaryExpiresAt ? `Free access until ${new Date(status.complimentaryExpiresAt).toLocaleDateString()}` : 'Free access forever' : status.subscribed ? 'Your current plan' : 'No active plan'}</p>
        {checkoutReturn && <p className="workspace-billing-notice" role="status">{checkoutReturn === 'success' ? status.subscribed ? 'Your membership is ready. You can start editing.' : 'Checkout completed. Waiting for Stripe to confirm your membership…' : 'Checkout was canceled. Your membership has not changed.'}</p>}
        {!active && !status.complimentary && <p className="workspace-billing-notice">Membership is coming soon. No payment is required.</p>}
        <p className="workspace-membership-description">{status.complimentary ? 'Your membership includes full editor access. No payment method is required.' : status.subscribed ? 'Manage your subscription, payment method, and invoices securely through Stripe.' : status.trialEligible ? `Try it free for ${EDITOR_PLAN.trialDays} days, then $${EDITOR_PLAN.monthlyPrice}/month. Cancel anytime.` : `$${EDITOR_PLAN.monthlyPrice}/month. Cancel anytime. Your free trial has already been used.`}</p>
        <ul className="workspace-billing-features">{features.map(feature => <li key={feature}><Check size={13} />{feature}</li>)}</ul>
        <div>{!status.complimentary && <PrimaryButton size="compact" disabled={!active || busy} onClick={() => void openBilling()}>{busy && <LoaderCircle size={14} className="animate-spin" />}{!active ? 'Coming soon' : status.subscribed || status.needsPayment ? 'Manage subscription' : status.trialEligible ? `Start ${EDITOR_PLAN.trialDays}-day free trial` : 'Subscribe'}</PrimaryButton>}</div>
        {active && !status.subscribed && !status.complimentary && status.trialEligible && <p className="workspace-billing-trial-note">A payment method is required. Your first charge follows the trial unless you cancel.</p>}
        {error && <p className="workspace-inline-error" role="alert">{error}</p>}
      </>}
    </div>
  </section>;
}
