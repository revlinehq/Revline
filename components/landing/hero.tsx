import { LandingStartButton } from './start-button';
import { LandingSection } from './ui';

export function LandingHero() {
  return <LandingSection className="landing-hero" headingId="landing-hero-heading">
    <div className="landing-hero-copy">
      <h1 id="landing-hero-heading">The AI video editor that{' '}<br />actually does the editing</h1>
      <p>From podcasts and YouTube videos to product demos, ads, and social clips.{' '}<br />Revline cuts, captions, reframes, and polishes every video for you.</p>
      <div className="landing-hero-actions">
        <LandingStartButton />
      </div>
    </div>
    <div className="landing-product-frame"><img className="landing-product-window" src="/landing/product-window.webp" width={2560} height={1307} alt="The Revline editor with its conversation, preview, and timeline" fetchPriority="high" /></div>
  </LandingSection>;
}
