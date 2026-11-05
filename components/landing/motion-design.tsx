'use client';

import { Card } from '@/components/ui/card';
import { useLazyIllustration } from './use-lazy-illustration';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

const loadMotion = () => import('./motion-design-animation');

export function LandingMotionDesign() {
  const { frame, Animation, playing } = useLazyIllustration(loadMotion);
  return (
    <LandingSection
      id="motion-design"
      className="landing-motion-design"
      headingId="landing-motion-design-heading"
    >
      <div className="landing-showcase-copy">
        <LandingHeading
          id="landing-motion-design-heading"
          title="Revline for motion design"
          description="Launch films and motion graphics, built from a prompt and editable on your timeline."
        />
        <LandingStartButton label="Start editing" size="sm" />
      </div>
      <figure className="landing-motion-design-film">
        <Card ref={frame} className="landing-motion-design-frame" role="img"
          aria-label="Revline motion editor with a portrait film, scene and graphic clips, a music waveform and a synchronized playhead.">
          <img className="landing-motion-design-poster" src="/landing/motion-design-study-poster.webp" alt="" loading="lazy" />
          {Animation && <Animation playing={playing} />}
        </Card>
      </figure>
    </LandingSection>
  );
}
