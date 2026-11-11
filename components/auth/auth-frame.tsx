'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

/** The dark page around every auth screen: the wordmark, one centred card, and the legal links. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-page dash-theme">
    <header className="auth-nav"><Link href="/" className="auth-brand" aria-label="Revline home">Revline</Link></header>
    <section className="auth-main">
      <Card variant="dash" className="auth-card">{children}</Card>
      <footer className="auth-legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></footer>
    </section>
  </main>;
}
