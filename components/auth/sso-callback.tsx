'use client';

import { HandleSSOCallback, useSession } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AuthFrame } from './auth-frame';
import { safeAuthRedirect } from './email-auth-flow';

export function SsoCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useSession();
  const [error, setError] = useState('');
  const [slow, setSlow] = useState(false);
  const navigating = useRef(false);
  const target = () => safeAuthRedirect(params.get('redirect_url'), window.location.origin);
  function enterApp(destination: string) {
    if (navigating.current) return;
    navigating.current = true;
    window.location.replace(destination);
  }
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    // Recover if Clerk has activated the session but its completion callback never navigates.
    if (session?.status !== 'active' || session.currentTask || error) return;
    const timer = setTimeout(() => enterApp(target()), 500);
    return () => clearTimeout(timer);
  }, [session, error, params]);

  return <AuthFrame><div className="auth-callback"><div className="auth-callback-status" role={error ? 'alert' : 'status'}>{error ? <p>{error}</p> : <><LoaderCircle size={22} className="animate-spin" /><p>Signing you in…</p></>}</div><HandleSSOCallback navigateToApp={({ session, decorateUrl }) => {
    if (session?.currentTask) { setError('Your account requires an additional security step. Please contact support to complete sign-in.'); return; }
    // A document navigation also refreshes server auth after the new session is created.
    enterApp(decorateUrl(target()));
  }} navigateToSignIn={() => router.replace(`/sign-in?redirect_url=${encodeURIComponent(target())}`)} navigateToSignUp={() => router.replace(`/sign-in?redirect_url=${encodeURIComponent(target())}`)} />
    {slow && !error && <div className="auth-callback-recovery"><p>This is taking longer than expected. Complete any verification above, or try signing in again.</p><Link href={`/sign-in?redirect_url=${encodeURIComponent(target())}`}>Back to sign-in</Link></div>}
  </div></AuthFrame>;
}
