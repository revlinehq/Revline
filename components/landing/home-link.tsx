'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

/** The nav logo: on the landing page itself it jumps back to the top instead of re-navigating. */
export function LandingHomeLink({ children }: { children: ReactNode }) {
  return <Link className="landing-brand" href="/" aria-label="Revline home" onClick={event => {
    if (location.pathname !== '/') return;
    event.preventDefault();
    if (location.hash) history.replaceState(null, '', '/');
    scrollTo({ top: 0, behavior: 'instant' });
  }}>{children}</Link>;
}
