import Link from 'next/link';
import { LandingStartButton } from './start-button';

export function LandingHero() {
  return <section className="landing-hero landing-section" aria-labelledby="landing-hero-heading">
    <div className="landing-hero-copy">
      <h1 id="landing-hero-heading">The AI video editor that{' '}<br />actually does the editing</h1>
      <p>From podcasts and YouTube videos to product demos, ads, and social clips.{' '}<br />Revline cuts, captions, reframes, and polishes every video for you.</p>
      <div className="landing-hero-actions">
        <LandingStartButton />
        <Link className="landing-button landing-button-secondary" href="/sign-in">Sign in</Link>
      </div>
    </div>
    <img className="landing-product-window" src="/landing/product-window.webp" width={2560} height={1307} alt="The Revline editor with its conversation, preview, and timeline" fetchPriority="high" />
  </section>;
}
