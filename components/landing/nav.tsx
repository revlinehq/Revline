import { Brand } from '@/components/workspace/brand';
import { LandingStartButton } from './start-button';
import { LandingButton, LandingReveal } from './ui';
import { LandingNavTone } from './nav-tone';
import { LandingHomeLink } from './home-link';

const links = [
  { label: 'Product', href: '#how-it-works' },
  { label: 'Use cases', href: '#use-cases' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

export function LandingNav() {
  return <nav className="landing-nav" aria-label="Main navigation">
    <LandingReveal className="landing-nav-brand"><LandingHomeLink><Brand /></LandingHomeLink></LandingReveal>
    <LandingReveal order={1} className="landing-nav-links">{links.map(({ label, href }) => <a key={label} href={href}>{label}</a>)}</LandingReveal>
    <LandingReveal order={2} className="landing-nav-right">
      <LandingButton className="landing-nav-login" href="/sign-in" variant="neutral" size="sm">Log in</LandingButton>
      <LandingStartButton label="Start free" variant="dark" size="sm" />
    </LandingReveal>
    <LandingNavTone />
  </nav>;
}
