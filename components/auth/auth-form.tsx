'use client';
import { SIGNED_IN_HOME_PATH } from '@/lib/workspace-routes';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useClerk, useSignIn, useSignUp } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { prepareExternalAuthRedirect } from '@/lib/editor/project-draft';
import { AuthFrame } from './auth-frame';
import { OtpCodeInput } from './otp-code-input';
import { safeAuthRedirect, sendEmailCode, verifyEmailCode } from './email-auth-flow';
import { InstagramBrowserHandoff } from './instagram-browser-handoff';
import { AuthRecovery } from './auth-recovery';

function errorMessage(error: unknown, fallback: string) {
  const value = error as { errors?: { longMessage?: string; message?: string }[]; longMessage?: string; message?: string } | null;
  return value?.errors?.[0]?.longMessage ?? value?.errors?.[0]?.message ?? value?.longMessage ?? value?.message ?? fallback;
}

function GoogleIcon() {
  return <svg className="size-[18px]" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.61 0-4.83-1.77-5.62-4.15H3.04v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.38 13.9a6 6 0 0 1 0-3.8V7.51H3.04a10 10 0 0 0 0 8.98l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.51L18.7 4.6A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z"/></svg>;
}

export function AuthForm({ mode = 'sign-in' }: { mode?: 'sign-in' | 'sign-up' }) {
  const { signIn, fetchStatus } = useSignIn();
  const { signUp } = useSignUp();
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const router = useRouter();
  const params = useSearchParams();
  const redirectParam = params.get('redirect_url') ?? params.get('redirectUrl') ?? params.get('returnTo');
  const [target, setTarget] = useState(SIGNED_IN_HOME_PATH);
  const [browserUrl, setBrowserUrl] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(() => params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'verifying' | 'resending' | 'resetting' | 'google'>('idle');
  const [blockedTask, setBlockedTask] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);
  const pending = phase !== 'idle' || fetchStatus === 'fetching';

  useEffect(() => {
    const destination = safeAuthRedirect(redirectParam, window.location.origin);
    setTarget(destination);
    if (/Android/i.test(navigator.userAgent) && /Instagram/i.test(navigator.userAgent)) {
      const url = new URL('/sign-in', window.location.origin);
      url.searchParams.set('redirect_url', destination);
      setBrowserUrl(url.href);
    }
    if (isLoaded && isSignedIn && phase === 'idle' && !blockedTask) router.replace(destination);
  }, [redirectParam, isLoaded, isSignedIn, phase, blockedTask, router]);
  useEffect(() => {
    const update = () => setCooldown(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update(); if (!resendAt) return;
    const timer = setInterval(update, 250); return () => clearInterval(timer);
  }, [resendAt]);

  async function send() {
    const address = email.trim();
    if (!address || inFlight.current || !isLoaded) return;
    inFlight.current = true; setPhase('sending'); setError(''); setNotice(''); setEmail(address); setCode('');
    try { await sendEmailCode(signIn, address); setResendAt(Date.now() + 30_000); setStep('code'); }
    catch (failure) { setError(errorMessage(failure, 'We could not send a code. Please try again.')); }
    finally { inFlight.current = false; setPhase('idle'); }
  }
  async function verify() {
    if (!/^\d{6}$/.test(code) || inFlight.current) return;
    inFlight.current = true; setPhase('verifying'); setError(''); setNotice('');
    try {
      const flow = await verifyEmailCode(signIn, signUp, code);
      const done = await (flow === 'signUp' ? signUp : signIn).finalize({ navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          setBlockedTask(true); setError('This account needs an additional security step that Revline can’t complete here. Sign in with another account to continue.'); return;
        }
        const destination = decorateUrl(target);
        if (destination.startsWith('http')) window.location.assign(destination); else router.replace(destination);
      } });
      if (done.error) throw done.error;
    } catch (failure) { setError(errorMessage(failure, 'Could not verify your code. Please try again.')); }
    finally { inFlight.current = false; setPhase('idle'); }
  }
  async function resend() {
    if (inFlight.current || Date.now() < resendAt) return;
    inFlight.current = true; setPhase('resending'); setError(''); setNotice('');
    try { const sent = await signIn.emailCode.sendCode(); if (sent.error) throw sent.error; setCode(''); setResendAt(Date.now() + 30_000); setNotice('A new code has been sent.'); }
    catch (failure) { setError(errorMessage(failure, 'We could not resend the code. Please try again.')); }
    finally { inFlight.current = false; setPhase('idle'); }
  }
  async function changeEmail() {
    if (inFlight.current) return;
    inFlight.current = true; setPhase('resetting');
    try {
      const results = await Promise.all([signIn.reset(), signUp.reset()]);
      for (const result of results) if (result.error) throw result.error;
      setStep('email'); setCode(''); setError(''); setNotice(''); setResendAt(0);
    } catch (failure) { setError(errorMessage(failure, 'Could not change your email. Please try again.')); }
    finally { inFlight.current = false; setPhase('idle'); }
  }
  async function switchAccount() {
    if (inFlight.current) return;
    inFlight.current = true; setPhase('resetting'); setError(''); setNotice('');
    try {
      // Stay on this sign-in page, with its redirect, for the next account.
      await clerk.signOut({ redirectUrl: window.location.href });
      setBlockedTask(false); setStep('email'); setEmail(''); setCode(''); setResendAt(0);
      // The session is gone; stale attempt resources only need a best-effort reset.
      await Promise.all([signIn.reset(), signUp.reset()]).catch(() => undefined);
    } catch (failure) { setError(errorMessage(failure, 'Could not sign out of this account. Reload the page and try again.')); }
    finally { inFlight.current = false; setPhase('idle'); }
  }
  async function google() {
    if (inFlight.current || !isLoaded) return;
    inFlight.current = true; setPhase('google'); setError(''); setNotice('');
    try {
      await prepareExternalAuthRedirect();
      const started = await signIn.sso({ strategy: 'oauth_google', redirectUrl: target, redirectCallbackUrl: `/sso-callback?redirect_url=${encodeURIComponent(target)}` });
      if (started.error) throw started.error;
    }
    catch (failure) { setError(errorMessage(failure, 'Could not continue with Google. Please try again.')); }
    finally { inFlight.current = false; setPhase('idle'); }
  }

  if (browserUrl && !isSignedIn) return <InstagramBrowserHandoff url={browserUrl} />;

  return <AuthFrame><div className="auth-form" data-auth-step={step}>
    <header className="auth-header"><h1>{step === 'code' ? 'Check your email' : mode === 'sign-up' ? 'Create your account' : 'Sign in to Revline'}</h1><p>{step === 'code' ? <><span>Enter the code sent to</span><strong>{email}</strong></> : 'Your AI video editor.'}</p></header>
    {step === 'email' ? <>
      <Button className="auth-action auth-google" variant="soft" data-auth-action="google" disabled={!isLoaded || pending} onClick={() => void google()}>{phase === 'google' ? <LoaderCircle size={18} className="animate-spin" /> : <GoogleIcon />}Continue with Google</Button>
      <div className="auth-divider"><span />or<span /></div>
      <form className="auth-email-form" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label htmlFor="auth-email">Email</label><Input className="auth-field" id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} required disabled={pending} aria-describedby="auth-email-help auth-feedback" />
        <p id="auth-email-help" className="auth-help">We’ll send you a code.</p>
        <Button className="auth-action auth-continue" variant="primary" type="submit" data-auth-action="continue" disabled={!isLoaded || pending}>{phase === 'sending' && <LoaderCircle size={15} className="animate-spin" />}{phase === 'sending' ? 'Sending code…' : 'Continue'}</Button>
      </form>
    </> : <form className="auth-code-form" onSubmit={event => { event.preventDefault(); void verify(); }}>
      <label id="auth-code-help" className="sr-only">Six-digit code</label><OtpCodeInput value={code} onChange={setCode} disabled={pending} invalid={!!error} />
      <Button className="auth-action auth-continue" variant="primary" type="submit" data-auth-action="verify" disabled={pending || !/^\d{6}$/.test(code)}>{phase === 'verifying' && <LoaderCircle size={15} className="animate-spin" />}{phase === 'verifying' ? 'Checking code…' : 'Verify'}</Button>
      <div className="auth-links"><Button className="auth-link" variant="link" type="button" data-auth-action="resend" disabled={pending || cooldown > 0} onClick={() => void resend()}>{phase === 'resending' ? 'Sending…' : cooldown ? `Resend code in ${cooldown}s` : 'Resend code'}</Button><Button className="auth-link" variant="link" type="button" data-auth-action="change-email" disabled={pending} onClick={() => void changeEmail()}>Use a different email</Button></div>
    </form>}
    <div id="auth-feedback" className="auth-feedback">{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div>
    {blockedTask && <div className="auth-links"><Button className="auth-link" variant="link" type="button" data-auth-action="another-account" disabled={pending} onClick={() => void switchAccount()}>{phase === 'resetting' ? 'Signing out…' : 'Use another account'}</Button></div>}
    {(!isLoaded || pending) && <AuthRecovery key={!isLoaded ? 'loading' : phase} />}
    <div id="clerk-captcha" />
  </div></AuthFrame>;
}
