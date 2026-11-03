'use client';

import { useLazyIllustration } from './use-lazy-illustration';
import { Card } from '@/components/ui/card';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

const loadClippers = () => import('./clippers-animation');

/** The film's editor and montage, rendered as a passive, viewport-driven illustration. */
export function LandingClippers() {
  const { frame, Animation, playing } = useLazyIllustration(loadClippers);
  return (
    <LandingSection
      id="clippers"
      className="landing-clippers"
      headingId="landing-clippers-heading"
    >
      <div className="landing-showcase-copy">
        <LandingHeading
          id="landing-clippers-heading"
          title="Revline for clipping"
          description="Drop in gaming streams or podcasts and get Shorts and Reels ready to post."
        />
        <LandingStartButton label="Start clipping" size="sm" />
      </div>
      <Card
        ref={frame}
        className="landing-clippers-frame"
        role="img"
        aria-label="Revline turns gaming streams, podcasts and interviews into vertical clips, then reveals three gaming and three podcast or interview videos with distinct caption styles and illustrative view counts."
      >
        <img
          className="landing-clippers-still"
          src="/landing/clippers-still.webp"
          alt=""
          loading="lazy"
        />
        {Animation && <Animation playing={playing} />}
      </Card>
    </LandingSection>
  );
}
