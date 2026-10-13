import { ProductDemo } from './editor-demo';
import { LandingStartButton } from './start-button';

export function LandingHero() {
  return <section className="landing-hero landing-section" aria-labelledby="landing-hero-heading">
    <div className="landing-hero-copy">
      <h1 id="landing-hero-heading">YOUR EDIT. AI ON HAND.</h1>
      <p>Shape your video with a hands-on timeline.<br />Ask AI to help with cuts, captions, and the details.</p>
      <LandingStartButton label="Get started" className="landing-hero-start" />
    </div>
    <ProductDemo />
  </section>;
}
