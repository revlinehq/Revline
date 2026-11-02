'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/workspace/brand';

export function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-page">
    <header className="auth-nav"><Link href="/" aria-label="Revline home"><Brand /></Link><Link href="/" className="auth-back">Back to Revline</Link></header>
    <section className="auth-main">{children}</section>
    <footer className="auth-legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></footer>
  </main>;
}
