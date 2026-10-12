'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useAction, useConvexAuth, useQuery } from 'convex/react';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { EDITOR_PLAN } from '@/lib/billing/plan';
import { PrimaryButton } from './primary-button';
import { WorkspaceNav } from './workspace-nav';
import './shared.css';
import './editor-access-gate.css';

export function EditorAccessGate({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const status = useQuery(api.billing.status, isAuthenticated ? {} : 'skip');
  const checkout = useAction(api.billing.createCheckout);
  const portal = useAction(api.billing.createPortal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const name = user?.firstName?.trim() || user?.fullName?.trim().split(/\s+/)[0];

  if (!status) return <div className="editor-access-loading" role="status"><LoaderCircle size={18} className="animate-spin" />Checking your plan…</div>;
  if (!status.enabled || status.subscribed) return children;

  async function openCheckout() {
    if (!status?.configured || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = status.needsPayment ? await portal({}) : await checkout({ plan: 'pro' });
      if (!result.url) throw new Error('Could not open checkout. Please try again.');
      window.location.assign(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open billing. Please try again.');
      inFlight.current = false; setBusy(false);
    }
  }

  return <div className="workspace-page editor-access-page">
    <WorkspaceNav title="New chat" />
    <main className="editor-access-main">
      <header><h1>Welcome{name ? `, ${name}` : ''}.</h1><p>Start your edit.</p></header>
      <section className="editor-access-card" aria-labelledby="editor-access-title">
        <h2 id="editor-access-title">{status.needsPayment ? 'Get back to your edit.' : status.trialEligible ? 'Your first edit starts here.' : 'Keep creating with Revline.'}</h2>
        <p>{status.needsPayment ? 'Update your payment method to restore editor access.' : status.trialEligible ? `Try the full editor free for ${EDITOR_PLAN.trialDays} days.` : 'Renew your plan to edit and export your videos.'}</p>
        <div className="editor-access-price"><strong>${EDITOR_PLAN.monthlyPrice}</strong><span>/ month{status.trialEligible ? ' after your trial' : ''} · {EDITOR_PLAN.currency}</span></div>
        <p className="editor-access-description">Claude editing, captions, private uploads, and video exports.</p>
        {!status.configured && <p role="status">Billing is temporarily unavailable. Please try again shortly.</p>}
        <PrimaryButton disabled={busy || !status.configured} onClick={() => void openCheckout()}>
          {busy && <LoaderCircle size={14} className="animate-spin" />}
          {status.needsPayment ? 'Update payment method' : status.trialEligible ? `Start ${EDITOR_PLAN.trialDays}-day free trial` : 'Subscribe'}
        </PrimaryButton>
        <small>{status.trialEligible ? 'A payment method is required. Cancel before your trial ends to avoid a charge.' : 'Cancel anytime in billing.'}</small>
        {error && <p className="editor-access-error" role="alert">{error}</p>}
      </section>
      <nav aria-label="Account"><Link href="/chats">Your projects</Link><Link href="/profile#billing">Manage billing</Link></nav>
    </main>
  </div>;
}
