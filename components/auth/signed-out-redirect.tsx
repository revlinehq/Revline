'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

/**
 * Sends a signed-out visitor to sign-in from any page under app/(dashboard). proxy.ts already does this for every
 * request it sees; this covers what it cannot: a click between pages that are already in the browser asks the server
 * nothing, so a session that ended in another tab is caught here, as is a page proxy.ts does not list yet.
 * A full page load, like signing out, so no signed-in query stays cached.
 */
export function SignedOutRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && !isSignedIn) window.location.replace(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
  }, [isLoaded, isSignedIn]);
  return null;
}
