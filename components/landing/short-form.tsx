'use client';

import { Card } from '@/components/ui/card';
import { useLazyIllustration } from './use-lazy-illustration';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

const loadShortForm = () => import('./short-form-animation');

export function LandingShortForm() {
  const { frame, Animation, playing } = useLazyIllustration(loadShortForm);
  return (
    <LandingSection id="short-form" className="landing-short-form" headingId="landing-short-form-heading">
      <div className="landing-showcase-copy">
        <LandingHeading id="landing-short-form-heading" title="Revline for short-form editing"
          description="Drop in a talking head or raw footage and get a 30–60 s Reel with cuts, captions and zooms." />
        <LandingStartButton label="Start editing" size="sm" variant="dark" />
      </div>
      <Card ref={frame} className="landing-short-form-frame" role="img"
        aria-label="Raw talking-head footage drops into Revline. Pauses are removed, captions follow each word, and a punch-in leads into a finished vertical Reel ready to post.">
        <img className="landing-short-form-still" src="/landing/short-form-still.webp" alt="" loading="lazy" />
        {Animation && <Animation playing={playing} />}
      </Card>
    </LandingSection>
  );
}
