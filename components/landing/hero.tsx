import { ProductDemo } from './editor-demo';
import { LandingStartButton } from './start-button';

export function LandingHero() {
  return <section className="landing-hero landing-section" aria-labelledby="landing-hero-heading">
    <div className="landing-hero-copy">
      <h1 id="landing-hero-heading">AI VIDEO EDITING</h1>
      <p>Upload your clips and tell Revline what to make.<br />Cut, caption, and shape your video in conversation.</p>
      <LandingStartButton label="Get started" className="landing-hero-start" />
    </div>
    <ProductDemo />
  </section>;
}
