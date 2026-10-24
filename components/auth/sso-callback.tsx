'use client';

import { HandleSSOCallback } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { AuthFrame } from './auth-frame';
import { safeAuthRedirect } from './email-auth-flow';
import { AuthRecovery } from './auth-recovery';
import { BrandLoader } from '@/components/workspace/brand-loader';

export function SsoCallback() {
  const params = useSearchParams();
  const [error, setError] = useState('');
  const target = () => safeAuthRedirect(params.get('redirect_url'), window.location.origin);
  const signInUrl = () => `/sign-in?redirect_url=${encodeURIComponent(target())}`;

  return <AuthFrame><div className="auth-callback">{error ? <div className="auth-callback-status" role="alert"><p>{error}</p></div> : <BrandLoader label="Signing you in…"/>}<HandleSSOCallback navigateToApp={({ session, decorateUrl }) => {
    if (session?.currentTask) { setError('Your account requires an additional security step. Please contact support to complete sign-in.'); return; }
    // A document navigation also refreshes server auth after the new session is created.
    window.location.replace(decorateUrl(target()));
  }} navigateToSignIn={() => window.location.replace(signInUrl())} navigateToSignUp={() => window.location.replace(signInUrl())} />
    <div className="auth-callback-recovery"><a href={signInUrl()}>Back to sign-in</a></div>
    {!error && <AuthRecovery />}
  </div></AuthFrame>;
}
