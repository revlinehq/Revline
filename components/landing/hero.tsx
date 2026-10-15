import { ProductDemoPreview } from './editor-demo-preview';
import { LandingStartButton } from './start-button';

export function LandingHero() {
  return <section className="landing-hero landing-section" aria-labelledby="landing-hero-heading">
    <div className="landing-hero-copy">
      <h1 id="landing-hero-heading">AI Native Video Editing</h1>
      <p>Turn your footage into finished edits.<br />Just tell Revline what you have in mind.</p>
      <LandingStartButton label="Get started" className="landing-hero-start" />
      <p className="landing-social-proof">Loved by 49,216 creators</p>
    </div>
    <ProductDemoPreview />
  </section>;
}
