import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { LandingStartButton } from './start-button';
import { LandingButton } from './ui';

const links = [
  { label: 'Product', href: '#how-it-works', menu: true },
  { label: 'Use cases', href: '#use-cases', menu: true },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

export function LandingNav() {
  return <nav className="landing-nav" aria-label="Main navigation">
    <div className="landing-nav-left">
      <Link className="landing-brand" href="/" aria-label="Revline home"><Brand /></Link>
      <div className="landing-nav-links">{links.map(({ label, href, menu }) => <a key={label} href={href}>{label}{menu && <ChevronDown size={14} aria-hidden="true" />}</a>)}</div>
    </div>
    <div className="landing-nav-right">
      <LandingButton className="landing-nav-login" href="/sign-in" variant="neutral" size="sm">Log in</LandingButton>
      <LandingStartButton label="Start free" variant="dark" size="sm" />
    </div>
  </nav>;
}
