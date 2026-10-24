import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { LandingStartButton } from './start-button';

/** Revline mark from the Pen landing design (node fRsMC), drawn at 0.1 scale. */
export function LandingMark() {
  return <svg className="landing-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path transform="translate(0.58 1.82) scale(0.1)" fill="#070707" d="M211.65001 70.54999l-138.65001 0.00001c-9.55 0-18.25001 3.5-24.60001 9.29998 1.8-18.54999 17.35001-32.94998 36.25-32.94998l29.80001 0c9.45001 0 16.70001-7.45001 16.70001-16.6 0-5.1-2.35001-9.85001-6.40003-13.80001-10.09999-10.3-25.34999-16.49999-41.84999-16.49999-45.7 0-82.89999 36.85-82.89999 85.84998l0 90.60003c0 15.04999 12.15 26.94998 25.55 26.94998 14.39999 0 26.59999-11.89999 26.59999-26.94998l0-38.00003c0-17.64998 13.89999-31.49999 30.60001-31.49999l128.3 0c10.4 0 18.29999-8.35001 18.29999-18.44998 0-9.95001-8.10001-17.95001-17.69998-17.95002z" />
    <path transform="translate(16.62 7.56) scale(0.1)" fill="#7D24FF" d="M7.50002 59.75c-4.35001 0-7.50002-3.3-7.50002-7.30002l0-44.94998c0-4.25002 3.40001-7.5 7.50002-7.5 4.24997 0 7.75 3.24998 7.74999 7.5l0 44.94998c0.14996 4.00002-3.35001 7.30002-7.74999 7.30002z" />
  </svg>;
}

const links = [
  { label: 'Product', href: '#how-it-works', menu: true },
  { label: 'Use cases', href: '#use-cases', menu: true },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

export function LandingNav() {
  return <nav className="landing-nav" aria-label="Main navigation">
    <div className="landing-nav-left">
      <Link className="landing-brand" href="/" aria-label="Revline home"><LandingMark /><span>Revline</span></Link>
      <div className="landing-nav-links">{links.map(({ label, href, menu }) => <a key={label} href={href}>{label}{menu && <ChevronDown size={14} aria-hidden="true" />}</a>)}</div>
    </div>
    <div className="landing-nav-right">
      <Link className="landing-button landing-button-neutral" href="/sign-in">Log in</Link>
      <LandingStartButton label="Start free" className="landing-button-dark" />
    </div>
  </nav>;
}
