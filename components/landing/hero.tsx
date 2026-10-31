import { LandingHeroVideo } from './hero-video';
import { LandingStartButton } from './start-button';
import { LandingAgentButton } from './agent-button';
import { LandingReveal, LandingSection } from './ui';

export function LandingHero() {
  return <LandingSection className="landing-hero" headingId="landing-hero-heading">
    <div className="landing-hero-copy">
      <LandingReveal as="h1" id="landing-hero-heading">The first agent-native{' '}<br />video editor</LandingReveal>
      <LandingReveal as="p" order={1}>Drop in your clips and say what you want.{' '}<br />Cuts, captions, motion and sound, done for you.</LandingReveal>
      <div className="landing-hero-actions">
        <LandingReveal order={2} className="landing-hero-buttons"><LandingStartButton /><LandingAgentButton /></LandingReveal>
      </div>
    </div>
    <div className="landing-product-frame"><LandingHeroVideo /></div>
  </LandingSection>;
}
