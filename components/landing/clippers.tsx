import { Card } from '@/components/ui/card';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

/** Clipping, shown as one still of the editor and its finished vertical clips. */
export function LandingClippers() {
  return <LandingSection id="clippers" className="landing-clippers" headingId="landing-clippers-heading">
    <div className="landing-showcase-copy">
      <LandingHeading id="landing-clippers-heading" title="Revline for clipping" description="Drop in gaming streams or podcasts and get Shorts and Reels ready to post." />
      <LandingStartButton label="Start clipping" size="sm" />
    </div>
    <Card className="landing-clippers-frame">
      <img className="landing-clippers-still" src="/landing/clippers-still.webp" alt="Revline turning gaming streams, podcasts and interviews into vertical clips with captions." loading="lazy" />
    </Card>
  </LandingSection>;
}
