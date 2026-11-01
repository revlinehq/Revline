'use client';

import { Brand } from '@/components/workspace/brand';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const footerNotes = [
  { label: 'Privacy', title: 'Your projects and footage', description: 'Revline is an early preview. Clerk manages account sign-in, Convex stores your project data, and Cloudflare R2 stores your uploaded media. Your footage is used to prepare your edits and exports. A complete privacy policy will be available before a public launch.' },
  { label: 'Terms', title: 'About this preview', description: 'Revline is currently in development. Keep a copy of your original footage and review your edit before sharing it. Only upload media you have permission to use. Public service terms are not yet published.' },
];

export function LandingFooter() {
  return <footer className="landing-footer landing-section" data-nav-tone="dark">
    <div className="landing-footer-brand"><Brand /><small>© 2026</small></div>
    <nav aria-label="Footer navigation">
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
      {footerNotes.map(({ label, title, description }) => <Dialog key={label}><DialogTrigger className="landing-footer-link">{label}</DialogTrigger><DialogContent className="landing-legal-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader></DialogContent></Dialog>)}
    </nav>
  </footer>;
}
