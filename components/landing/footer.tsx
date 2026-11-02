import Link from 'next/link';
import { Brand } from '@/components/workspace/brand';

export function LandingFooter() {
  return <footer className="landing-footer landing-section" data-nav-tone="dark">
    <div className="landing-footer-brand"><Brand /><small>© 2026</small></div>
    <nav aria-label="Footer navigation">
      <Link href="/pricing">Pricing</Link>
      <a href="/#faq">FAQ</a>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
    </nav>
  </footer>;
}
