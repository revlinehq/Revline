import Link from 'next/link';
import { Github } from 'lucide-react';
import { REPOSITORY } from '@/lib/repository.mjs';
import { Brand } from '@/components/workspace/brand';

export function LandingFooter() {
  return <footer className="landing-footer landing-section" data-nav-tone="dark">
    <div className="landing-footer-brand"><Brand /><small>© 2026</small></div>
    <nav aria-label="Footer navigation">
      <Link href="/pricing">Pricing</Link>
      <Link href="/blog">Blog</Link>
      <a href="/#faq">FAQ</a>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <a className="landing-footer-github" href={`https://github.com/${REPOSITORY}`} target="_blank" rel="noreferrer" aria-label="Revline on GitHub" title="Revline on GitHub"><Github size={18} aria-hidden /></a>
    </nav>
  </footer>;
}
