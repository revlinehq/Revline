import { LandingHeroVideo } from './hero-video';
import { LandingStartButton } from './start-button';
import { LandingReveal, LandingSection } from './ui';

export function LandingHero() {
  return <LandingSection className="landing-hero" headingId="landing-hero-heading">
    <div className="landing-hero-copy">
      <LandingReveal as="h1" id="landing-hero-heading">The AI video editor that{' '}<br />actually does the editing</LandingReveal>
      <LandingReveal as="p" order={1}>From podcasts and YouTube videos to product demos, ads, and social clips.{' '}<br />Revline cuts, captions, reframes, and polishes every video for you.</LandingReveal>
      <div className="landing-hero-actions">
        <LandingReveal order={2}><LandingStartButton /></LandingReveal>
      </div>
    </div>
    <div className="landing-product-frame"><LandingHeroVideo /></div>
  </LandingSection>;
}
