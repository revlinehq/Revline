import { Brand } from '@/components/workspace/brand';
import { LandingNavAuth } from './nav-auth';
import { LandingReveal } from './ui';
import { LandingNavTone } from './nav-tone';
import { LandingHomeLink } from './home-link';
import { LandingProductMenu } from './product-menu';

const links = [
  { label: 'Use cases', href: '#use-cases' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

export function LandingNav() {
  return <nav className="landing-nav" aria-label="Main navigation">
    <LandingReveal className="landing-nav-brand"><LandingHomeLink><Brand /></LandingHomeLink></LandingReveal>
    <LandingReveal order={1} className="landing-nav-links"><LandingProductMenu />{links.map(({ label, href }) => <a key={label} href={href}>{label}</a>)}</LandingReveal>
    <LandingReveal order={2} className="landing-nav-right">
      <LandingNavAuth />
    </LandingReveal>
    <LandingNavTone />
  </nav>;
}
