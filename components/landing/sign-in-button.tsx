'use client';

import { useAuth } from '@clerk/nextjs';
import { LandingButton } from './ui';

/** The hero's secondary action; members are already signed in, so it hides for them. */
export function LandingSignInButton() {
  const { isSignedIn } = useAuth();
  return isSignedIn ? null : <LandingButton href="/sign-in" variant="secondary" size="md">Sign in</LandingButton>;
}
