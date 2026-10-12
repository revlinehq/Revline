'use client';

import { HandleSSOCallback } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { AuthFrame } from './auth-frame';
import { safeAuthRedirect } from './email-auth-flow';

export function SsoCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState('');
  const target = () => safeAuthRedirect(params.get('redirect_url'), window.location.origin);
  return <AuthFrame><div className="auth-callback" role={error ? 'alert' : 'status'}>{error ? <p>{error}</p> : <><LoaderCircle size={22} className="animate-spin" /><p>Signing you in…</p></>}<HandleSSOCallback navigateToApp={({ session, decorateUrl }) => {
    if (session?.currentTask) { setError('Your account requires an additional security step. Please contact support to complete sign-in.'); return; }
    const destination = decorateUrl(target()); if (destination.startsWith('http')) window.location.assign(destination); else router.replace(destination);
  }} navigateToSignIn={() => router.replace(`/sign-in?redirect_url=${encodeURIComponent(target())}`)} navigateToSignUp={() => router.replace(`/sign-in?redirect_url=${encodeURIComponent(target())}`)} /></div></AuthFrame>;
}
