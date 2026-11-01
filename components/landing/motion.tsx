import { LandingFeatureVideo } from './feature-video';
import { LandingSection } from './ui';

export function LandingMotion() {
  return <LandingSection id="motion" className="landing-motion" headingId="landing-motion-heading" data-nav-tone="dark">
    <header className="landing-motion-heading">
      <h2 id="landing-motion-heading">Motion that keeps them watching.</h2>
      <p>Launch videos, explainers and motion that pops in as you talk, all edited in Revline.</p>
    </header>
    <div className="landing-motion-preview">
      <LandingFeatureVideo src="/landing/launch-film-original.mp4" poster="/landing/launch-film-original-poster.webp" />
    </div>
  </LandingSection>;
}
