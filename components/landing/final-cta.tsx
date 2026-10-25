'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useSignIn } from '@clerk/nextjs';
import { LoaderCircle } from 'lucide-react';
import { LandingButton, LandingHeading, LandingSection } from './ui';

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85c-4.16-3.87-9.59-6.25-16.06-6.25-9.38 0-17.49 5.38-21.44 13.22l7.98 6.19c1.89-5.69 7.2-9.91 13.46-9.91z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-0.15-3.09-0.38-4.55h-22.6v9.02h12.94c-0.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-0.48-1.45-0.76-2.99-0.76-4.59s0.27-3.14 0.76-4.59l-7.98-6.19c-1.63 3.24-2.55 6.9-2.55 10.78 0 3.88 0.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19c3.96 7.85 12.07 13.23 21.45 13.23z" />
  </svg>;
}

/** Email continues into the sign-in flow with the address filled in; Google starts OAuth here. */
export function LandingFinalCta() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn } = useSignIn();
  const [email, setEmail] = useState('');
  const [google, setGoogle] = useState<'idle' | 'pending' | 'failed'>('idle');

  function start(event: React.FormEvent) {
    event.preventDefault();
    if (isSignedIn) return router.push(NEW_PROJECT_PATH);
    const address = email.trim();
    router.push(address ? `/sign-in?email=${encodeURIComponent(address)}` : '/sign-in');
  }
  async function continueWithGoogle() {
    if (isSignedIn) return router.push(NEW_PROJECT_PATH);
    if (!isLoaded || google === 'pending') return;
    setGoogle('pending');
    try {
      const started = await signIn.sso({ strategy: 'oauth_google', redirectUrl: NEW_PROJECT_PATH, redirectCallbackUrl: `/sso-callback?redirect_url=${encodeURIComponent(NEW_PROJECT_PATH)}` });
      if (started.error) throw started.error;
    } catch { setGoogle('failed'); }
  }

  return <LandingSection className="landing-final" headingId="landing-final-heading">
    <div className="landing-final-card">
      <LandingHeading id="landing-final-heading" align="center" size="lg" title={<>Your next video is<br />one prompt away.</>} description="Upload a clip and see what Revline does with it." />
      <div className="landing-signup">
        <form className="landing-email" onSubmit={start}>
          <label className="sr-only" htmlFor="landing-email">Email address</label>
          <input id="landing-email" type="email" name="email" autoComplete="email" placeholder="Enter your email" value={email} onChange={event => setEmail(event.target.value)} />
          <LandingButton type="submit" variant="brand" size="sm">Get started free</LandingButton>
        </form>
        <LandingButton className="landing-google" variant="neutral" size="lg" block disabled={google === 'pending'} onClick={() => void continueWithGoogle()}>{google === 'pending' ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <GoogleIcon />}Continue with Google</LandingButton>
      </div>
      <small role={google === 'failed' ? 'alert' : undefined}>{google === 'failed' ? 'Could not continue with Google. Please try again.' : 'Free to start · No credit card required'}</small>
    </div>
  </LandingSection>;
}
