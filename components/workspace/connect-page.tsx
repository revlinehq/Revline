'use client';
import { userError } from '@/lib/user-error';

import { useEffect, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useUser } from '@clerk/nextjs';
import { Check, CircleCheck, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Brand } from './brand';
import { PrimaryButton } from './primary-button';
import './workspace-pages.css';
import './connect-page.css';
import { Button } from '@/components/ui/button';

export type ConnectRequest = { clientId?: string; redirectUri?: string; codeChallenge?: string; codeChallengeMethod?: string; state?: string; resource?: string };

// What a connected agent can be asked, shown once access is granted.
const nextSteps = ['“Cut the dead air from my latest project”', '“Add captions and a title card”', '“Score the cuts with sound effects”'];
/** Apps on this computer (Claude Code, Codex) take the code on a localhost callback page of their own. */
const loopback = (uri: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(uri).hostname);

const permissions = ['See your projects, media and transcripts', 'Edit timelines with Revline’s editing tools; every edit is saved and undoable', 'Import video links and start exports'];

/** OAuth consent for an MCP client such as Claude or ChatGPT. */
export function ConnectPage({ request }: { request: ConnectRequest }) {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const complete = !!request.clientId && !!request.redirectUri && !!request.codeChallenge;
  const details = useQuery(api.mcpAuth.authorizationRequest, isAuthenticated && complete ? { clientId: request.clientId!, redirectUri: request.redirectUri! } : 'skip');
  const approve = useMutation(api.mcpAuth.approve);
  const [busy, setBusy] = useState<'approve' | 'cancel' | ''>('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  // Backstop for the frame-ancestors header: approving from inside another page is refused.
  const [framed, setFramed] = useState(false);
  useEffect(() => { setFramed(window.top !== window.self); }, []);

  async function allow() {
    if (window.top !== window.self) return;
    setBusy('approve'); setError('');
    // A local app's callback opens in a small window that closes itself, so this page can show the result.
    // Opened before the await so the click still counts and the popup isn't blocked.
    const local = loopback(request.redirectUri!);
    const handoff = local ? window.open('about:blank', 'revline-connect', 'popup,width=420,height=320') : null;
    try {
      const { redirectTo } = await approve({ clientId: request.clientId!, redirectUri: request.redirectUri!, codeChallenge: request.codeChallenge!, codeChallengeMethod: request.codeChallengeMethod ?? '', ...(request.state !== undefined ? { state: request.state } : {}), ...(request.resource !== undefined ? { resource: request.resource } : {}) });
      setConnected(true);
      if (handoff) { handoff.location.href = redirectTo; window.setTimeout(() => handoff.close(), 2500); }
      else window.setTimeout(() => window.location.assign(redirectTo), 1600);
    } catch (cause) { handoff?.close(); setError(userError(cause, 'Could not connect. Please try again.')); setBusy(''); }
  }
  // Only a redirect address the server confirmed is registered for this app.
  function cancel() {
    setBusy('cancel');
    const target = new URL(request.redirectUri!);
    target.searchParams.set('error', 'access_denied');
    if (request.state !== undefined) target.searchParams.set('state', request.state);
    window.location.assign(target.toString());
  }

  let body;
  if (framed) body = <p className="connect-message">Open this page directly to connect an app.</p>;
  else if (!complete) body = <p className="connect-message">This connection link is incomplete. Start again from the app you are connecting.</p>;
  else if (details === undefined) body = <div className="connect-message" role="status"><LoaderCircle size={18} className="animate-spin" /></div>;
  else if (!details.ok) body = <p className="connect-message">{details.message}</p>;
  else if (connected) body = <div className="connect-done" role="status">
    <CircleCheck size={28} strokeWidth={1.5} className="connect-done-icon" aria-hidden="true" />
    <h1>Connected to {details.clientName}</h1>
    <p className="connect-lead">{loopback(request.redirectUri!) ? <>Revline is ready in {details.clientName}. Go back there and ask for an edit. You can close this tab.</> : <>Taking you back to {details.clientName}…</>}</p>
    <div className="connect-try">
      <span>Try asking</span>
      <ul>{nextSteps.map(item => <li key={item}>{item}</li>)}</ul>
    </div>
    <p className="connect-note">Every edit shows up live in your Revline editor and can be undone. Manage access in your profile.</p>
  </div>;
  else body = <>
    <h1>Connect {details.clientName} to Revline</h1>
    <p className="connect-lead">An app calling itself “{details.clientName}” is asking to use your Revline account{user?.primaryEmailAddress ? <> ({user.primaryEmailAddress.emailAddress})</> : null}. Access will be sent to <strong>{details.redirectHost}</strong>.</p>
    {!details.trusted && <p className="connect-warning" role="note">This isn’t a Claude, ChatGPT or local address. Only allow it if you started this connection yourself and recognize {details.redirectHost}.</p>}
    {details.allowed ? <ul className="connect-permissions">{permissions.map(item => <li key={item}><Check size={14} />{item}</li>)}</ul>
      : <p className="connect-message">Connecting AI apps needs an active Revline plan.</p>}
    <p className="connect-note">Revoke access any time in your profile.</p>
    {error && <p className="workspace-inline-error" role="alert">{error}</p>}
    <div className="connect-actions">
      <Button variant="outline" size="md" type="button" disabled={!!busy} onClick={cancel}>Cancel</Button>
      {details.allowed && <PrimaryButton size="compact" disabled={!!busy} onClick={() => void allow()}>{busy === 'approve' && <LoaderCircle size={13} className="animate-spin" />}Allow access</PrimaryButton>}
    </div>
  </>;

  return <div className="workspace-page connect-page"><main className="connect-card"><Brand className="connect-brand" />{body}</main></div>;
}
