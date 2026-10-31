import { LandingHeroVideo } from './hero-video';
import { LandingStartButton } from './start-button';
import { LandingAgentButton } from './agent-button';
import { LandingReveal, LandingSection } from './ui';

export function LandingHero() {
  return <LandingSection className="landing-hero" headingId="landing-hero-heading">
    <div className="landing-hero-copy">
      <LandingReveal as="h1" id="landing-hero-heading">Raw footage in.{' '}<br />Finished video out.</LandingReveal>
      <LandingReveal as="p" order={1}>Say what you want in the chat. Revline cuts the footage, captions it,{' '}<br />adds the motion and sound, and hands back the finished video.</LandingReveal>
      <div className="landing-hero-actions">
        <LandingReveal order={2} className="landing-hero-buttons"><LandingStartButton /><LandingAgentButton /></LandingReveal>
      </div>
    </div>
    <div className="landing-product-frame"><LandingHeroVideo /></div>
  </LandingSection>;
}
