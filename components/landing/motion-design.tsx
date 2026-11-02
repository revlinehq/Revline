import { Card } from '@/components/ui/card';
import { LandingFeatureVideo } from './feature-video';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

export function LandingMotionDesign() {
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
          description="Launch films, explainers and motion graphics, built from a prompt and editable on your timeline."
        />
        <LandingStartButton label="Start editing" size="sm" />
      </div>
      <figure className="landing-motion-design-film">
        <Card className="landing-motion-design-frame">
          <LandingFeatureVideo
            src="/landing/motion-design-study.mp4"
            poster="/landing/motion-design-study-poster.webp"
          />
        </Card>
        <figcaption>
          Recreated in Revline from a reel by{' '}
          <a href="https://www.instagram.com/reel/DfMzGyNBdUH/" target="_blank" rel="noreferrer">
            @hc.prath
          </a>
        </figcaption>
      </figure>
    </LandingSection>
  );
}
