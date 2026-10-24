'use client';
import { userError } from '@/lib/user-error';

import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth, useQuery } from 'convex/react';
import { Check, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { EDITOR_PLAN } from '@/lib/billing/plan';
import { PrimaryButton } from './primary-button';
import { WorkspaceNav } from './workspace-nav';
import './shared.css';
import './editor-access-gate.css';

export function EditorAccessGate({ children, loading, checkoutPending = false }: { children: ReactNode; loading?: ReactNode; checkoutPending?: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const status = useQuery(api.billing.status, isAuthenticated ? {} : 'skip');
  const checkout = useAction(api.billing.createCheckout);
  const portal = useAction(api.billing.createPortal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  if (!status) return loading ?? <div className="editor-access-loading" role="status"><LoaderCircle size={18} className="animate-spin" />Checking your plan…</div>;
  if (!status.enabled || status.subscribed || status.complimentary) return children;
  if (checkoutPending && !status.needsPayment) return <div className="workspace-page editor-access-page">
    <WorkspaceNav title={NEW_WORKSPACE_LABEL} />
    <main className="editor-access-main"><section className="editor-access-card" aria-labelledby="editor-access-title">
      <h1 id="editor-access-title">Confirming your subscription…</h1>
      <p role="status">Waiting for payment confirmation. Your new project will open automatically.</p>
      <div><Link className="workspace-outline-button" href="/profile#billing">View billing</Link></div>
    </section></main>
  </div>;
  const trial = status.trialEligible && !status.needsPayment;

  async function openCheckout() {
    if (!status?.configured || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = status.needsPayment ? await portal({}) : await checkout({ plan: 'pro' });
      if (!result.url) throw new Error('Could not open checkout. Please try again.');
      window.location.assign(result.url);
    } catch (cause) {
      setError(userError(cause, 'Could not open billing. Please try again.'));
      inFlight.current = false; setBusy(false);
    }
  }

  return <div className="workspace-page editor-access-page">
    <WorkspaceNav title={NEW_WORKSPACE_LABEL} />
    <main className="editor-access-main">
      <section className="editor-access-card" aria-labelledby="editor-access-title">
        <header className="editor-access-heading">
          <h1 id="editor-access-title">{status.needsPayment ? 'Update your payment method' : 'Continue with Revline'}</h1>
          {status.needsPayment && <p>Update your payment method to restore editor access.</p>}
        </header>
        <div className="editor-access-offer">
          <div className="editor-access-price"><strong>${EDITOR_PLAN.monthlyPrice}</strong><span>/ month · {EDITOR_PLAN.currency}</span></div>
        </div>
        <ul className="editor-access-features" aria-label="Included features">
          <li><Check size={16} strokeWidth={1.5} aria-hidden="true" />AI editing in chat</li>
          <li><Check size={16} strokeWidth={1.5} aria-hidden="true" />Automatic captions &amp; animated text</li>
          <li><Check size={16} strokeWidth={1.5} aria-hidden="true" />Custom fonts, colors &amp; text styles</li>
          <li><Check size={16} strokeWidth={1.5} aria-hidden="true" />Video effects &amp; smooth transitions</li>
          <li><Check size={16} strokeWidth={1.5} aria-hidden="true" />Audio FX &amp; precise timeline controls</li>
          <li><Check size={16} strokeWidth={1.5} aria-hidden="true" />Private uploads &amp; MP4 exports</li>
        </ul>
        {!status.configured && <p role="status">Billing is temporarily unavailable. Please try again shortly.</p>}
        <div className="editor-access-action">
          <PrimaryButton className="editor-access-start" disabled={busy || !status.configured} onClick={() => void openCheckout()}>
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            {status.needsPayment ? 'Update payment method' : trial ? `Start ${EDITOR_PLAN.trialDays}-day free trial` : 'Start creating'}
          </PrimaryButton>
          <small>{trial ? 'Payment method required. Cancel before your trial ends to avoid a charge.' : 'Cancel anytime in billing.'}</small>
        </div>
        {error && <p className="editor-access-error" role="alert">{error}</p>}
      </section>
    </main>
  </div>;
}
