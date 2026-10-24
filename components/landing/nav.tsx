import Link from 'next/link';
import { Brand } from '@/components/workspace/brand';
import { LandingStartButton } from './start-button';
import { LandingButton } from './ui';

const links = [
  { label: 'Product', href: '#how-it-works' },
  { label: 'Use cases', href: '#use-cases' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

export function LandingNav() {
  return <nav className="landing-nav" aria-label="Main navigation">
    <div className="landing-nav-left">
      <Link className="landing-brand" href="/" aria-label="Revline home"><Brand /></Link>
      <div className="landing-nav-links">{links.map(({ label, href }) => <a key={label} href={href}>{label}</a>)}</div>
    </div>
    <div className="landing-nav-right">
      <LandingButton className="landing-nav-login" href="/sign-in" variant="neutral" size="sm">Log in</LandingButton>
      <LandingStartButton label="Start free" variant="dark" size="sm" />
    </div>
  </nav>;
}
