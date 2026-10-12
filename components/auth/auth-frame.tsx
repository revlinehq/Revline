'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/workspace/brand';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-page">
    <header className="auth-nav"><Link href="/" aria-label="Revline home"><Brand /></Link><Link href="/" className="auth-back">Back to Revline</Link></header>
    <section className="auth-main">{children}</section>
    <footer className="auth-legal">{[
      { label: 'Terms', title: 'About this preview', description: 'Revline is currently in development. Keep a copy of your original footage and review your edit before sharing it. Public service terms are not yet published.' },
      { label: 'Privacy', title: 'Your projects and footage', description: 'Clerk manages your account, Convex stores your project data, and Cloudflare R2 stores uploaded media. A complete privacy policy will be available before public launch.' },
    ].map(({ label, title, description }) => <Dialog key={label}><DialogTrigger>{label}</DialogTrigger><DialogContent className="auth-legal-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader></DialogContent></Dialog>)}</footer>
  </main>;
}
