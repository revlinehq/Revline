import Link from 'next/link';
import { LandingNavAuth } from './nav-auth';
import { LandingHomeLink } from './home-link';

export function LandingNav() {
  return <nav className="landing-nav" aria-label="Main navigation">
    <LandingHomeLink>Revline</LandingHomeLink>
    <div className="landing-nav-right">
      <Link className="landing-nav-link" href="/pricing">Pricing</Link>
      <LandingNavAuth />
    </div>
  </nav>;
}
