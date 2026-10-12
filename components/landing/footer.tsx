'use client';

import Link from 'next/link';
import { Plus, Minus } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const questions = [
  ['How does the free trial work?', 'The trial lasts 3 days. After that, Revline costs $39 USD per month. Cancel before the trial ends if you don’t want to continue.'],
  ['Do I need editing experience?', 'Start with your footage and an idea. Describe the edit you want, then review and refine it.'],
  ['Can I still edit manually?', 'Yes. Use the preview and timeline to adjust clips, text, and framing directly.'],
  ['Can I cancel?', 'Yes. You can cancel your monthly subscription. To avoid continuing after the trial, cancel before the 3 days are up.'],
];

export function LandingFaq() {
  return <section id="questions" className="landing-faq landing-section" aria-labelledby="landing-faq-heading"><h2 id="landing-faq-heading">A few things<br />before you start.</h2><div className="landing-faq-list">{questions.map(([question, answer], index) => <details name="landing-questions" key={question} open={index === 0}>
    <summary>{question}<span><Plus className="landing-faq-plus" size={16} aria-hidden="true" /><Minus className="landing-faq-minus" size={16} aria-hidden="true" /></span></summary><p>{answer}</p>
  </details>)}</div></section>;
}

const footerNotes = [
  { label: 'Privacy', title: 'Your projects and footage', description: 'Revline is an early preview. Clerk manages account sign-in, Convex stores your project data, and Cloudflare R2 stores your uploaded media. Your footage is used to prepare your edits and exports. A complete privacy policy will be available before a public launch.' },
  { label: 'Terms', title: 'About this preview', description: 'Revline is currently in development. Keep a copy of your original footage and review your edit before sharing it. Only upload media you have permission to use. Public service terms are not yet published.' },
  { label: 'Contact', title: 'Help shape Revline', description: 'This is a development preview. Share feedback with the person or team who gave you access. A public support channel has not been set up yet.' },
];

export function LandingFooter() {
  return <footer className="landing-footer landing-section">
    <div className="landing-footer-top"><Link href="/" aria-label="Revline home"><Brand /></Link><nav aria-label="Footer navigation"><a href="#workflow">Workflow</a><a href="#features">AI tools</a><a href="#questions">Questions</a><Link href="/sign-in">Sign in</Link></nav></div>
    <div className="landing-footer-bottom"><p>© 2026 Revline</p><div className="landing-footer-links">{footerNotes.map(({ label, title, description }) => <Dialog key={label}><DialogTrigger className="landing-footer-link">{label}</DialogTrigger><DialogContent className="landing-legal-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader></DialogContent></Dialog>)}</div></div>
  </footer>;
}
