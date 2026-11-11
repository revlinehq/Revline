'use client';

import { HandleSSOCallback } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuthFrame } from './auth-frame';
import { safeAuthRedirect } from './email-auth-flow';
import { AuthRecovery } from './auth-recovery';

export function SsoCallback() {
  const params = useSearchParams();
  const [error, setError] = useState('');
  // window only exists in the browser: the callbacks run there, and the fallback link
  // gains its redirect after hydration so server and client render the same markup.
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  const target = () => safeAuthRedirect(params.get('redirect_url'), window.location.origin);
  const signInUrl = () => `/sign-in?redirect_url=${encodeURIComponent(target())}`;

  return <AuthFrame><div className="auth-callback"><div className="auth-callback-status" role={error ? 'alert' : 'status'}>{error ? <p>{error}</p> : <><LoaderCircle size={18} className="animate-spin" /><p>Signing you in…</p></>}</div><HandleSSOCallback navigateToApp={({ session, decorateUrl }) => {
    if (session?.currentTask) { setError('Your account requires an additional security step. Please contact support to complete sign-in.'); return; }
    // A document navigation also refreshes server auth after the new session is created.
    window.location.replace(decorateUrl(target()));
  }} navigateToSignIn={() => window.location.replace(signInUrl())} navigateToSignUp={() => window.location.replace(signInUrl())} />
    <Button asChild className="auth-link" variant="link"><a href={origin ? signInUrl() : '/sign-in'}>Back to sign-in</a></Button>
    {!error && <AuthRecovery />}
  </div></AuthFrame>;
}
