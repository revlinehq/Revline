import { ArrowDown } from 'lucide-react';
import { LandingStartButton } from './start-button';
import { LandingButton, LandingSection, LandingShot } from './ui';

export function LandingHero() {
  return <LandingSection className="landing-hero" headingId="landing-hero-heading">
    <div className="landing-hero-copy">
      <h1 id="landing-hero-heading">Get paid to clip.</h1>
      <p>Revline finds campaigns that pay per view, cuts the clips with AI, and posts them to your accounts.</p>
      <div className="landing-hero-actions">
        <LandingStartButton />
        <LandingButton href="#how-it-works" variant="quiet">See how it works<ArrowDown size={16} aria-hidden="true" /></LandingButton>
      </div>
    </div>
    <figure className="landing-hero-shot">
      <LandingShot name="campaigns" layout="wide" priority alt="The Campaigns page in Revline: a grid of clipping campaigns, each card showing its rate per 1K views and the budget left." />
      <figcaption>Campaigns from Content Rewards</figcaption>
    </figure>
  </LandingSection>;
}
