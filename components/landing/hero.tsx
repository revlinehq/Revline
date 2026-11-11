import { LandingStartButton } from './start-button';
import { LandingSection, LandingShot } from './ui';

export function LandingHero() {
  return <LandingSection className="landing-hero" headingId="landing-hero-heading">
    <div className="landing-hero-copy">
      <h1 id="landing-hero-heading">Turn raw footage into paid clips.</h1>
      <p>Revline finds campaigns that pay per view, cuts the clips with AI, and posts them to your accounts.</p>
      <div className="landing-hero-actions">
        <LandingStartButton />
      </div>
    </div>
    <figure className="landing-hero-shot">
      <LandingShot name="campaigns" layout="wide" priority alt="The Campaigns page in Revline: a grid of clipping campaigns, each card showing its rate per 1K views and the budget left." />
    </figure>
  </LandingSection>;
}
