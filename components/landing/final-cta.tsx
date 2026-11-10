import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

export function LandingFinalCta() {
  return <LandingSection className="landing-final" headingId="landing-final-heading">
    <div className="landing-final-card">
      <LandingHeading id="landing-final-heading" title="Your next clip could be up tonight." description="Pick a campaign, let Revline cut it, and post it to your accounts." />
      <LandingStartButton />
    </div>
  </LandingSection>;
}
