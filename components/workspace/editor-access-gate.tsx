'use client';
import { userError } from '@/lib/user-error';

import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useAction } from 'convex/react';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { PrimaryButton } from './primary-button';
import { usePlanStatus } from './use-plan-status';
import { PlanPicker } from './plan-picker';
import { WorkspaceNav } from './workspace-nav';
import './shared.css';
import './editor-access-gate.css';
import { Button } from '@/components/ui/button';

export function EditorAccessGate({ children, loading, checkoutPending = false }: { children: ReactNode; loading?: ReactNode; checkoutPending?: boolean }) {
  const status = usePlanStatus();
  const portal = useAction(api.billing.createPortal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  if (!status) return loading ?? <div className="editor-access-loading" role="status"><LoaderCircle size={18} className="animate-spin" />Checking your plan…</div>;
  if (!status.enabled || status.subscribed || status.complimentary) return children;
  const paymentIssue = status.paymentIssue ?? status.needsPayment;
  if (checkoutPending && !paymentIssue) return <div className="workspace-page editor-access-page">
    <WorkspaceNav title={NEW_WORKSPACE_LABEL} />
    <main className="editor-access-main"><section className="editor-access-card" aria-labelledby="editor-access-title">
      <h1 id="editor-access-title">Confirming your subscription…</h1>
      <p role="status">Waiting for payment confirmation. Your new project will open automatically.</p>
      <div><Button asChild variant="outline" size="md"><Link href="/profile#billing">View billing</Link></Button></div>
    </section></main>
  </div>;

  async function openPortal() {
    if (!status?.configured || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await portal({});
      if (!result.url) throw new Error('Could not open billing. Please try again.');
      window.location.assign(result.url);
    } catch (cause) {
      setError(userError(cause, 'Could not open billing. Please try again.'));
      inFlight.current = false; setBusy(false);
    }
  }

  // A member whose payment failed fixes it first; everyone else picks a plan.
  if (paymentIssue) return <div className="workspace-page editor-access-page">
    <WorkspaceNav title={NEW_WORKSPACE_LABEL} />
    <main className="editor-access-main">
      <section className="editor-access-card" aria-labelledby="editor-access-title">
        <header className="editor-access-heading">
          <h1 id="editor-access-title">Update your payment method</h1>
          <p>Update your payment method to restore editor access.</p>
        </header>
        {!status.configured && <p role="status">Billing is temporarily unavailable. Please try again shortly.</p>}
        <div className="editor-access-action">
          <PrimaryButton className="editor-access-start" disabled={busy || !status.configured} onClick={() => void openPortal()}>
            {busy && <LoaderCircle size={14} className="animate-spin" />}Update payment method
          </PrimaryButton>
        </div>
        {error && <p className="editor-access-error" role="alert">{error}</p>}
      </section>
    </main>
  </div>;

  return <div className="workspace-page editor-access-page">
    <WorkspaceNav title={NEW_WORKSPACE_LABEL} />
    <main className="editor-access-main" data-plans>
      <header className="editor-access-intro">
        <h1>Choose your plan</h1>
        <p>Pick a plan to start editing. Cancel anytime.</p>
      </header>
      <PlanPicker status={status} />
    </main>
  </div>;
}
