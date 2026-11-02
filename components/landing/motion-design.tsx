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
      <Card className="landing-motion-design-frame">
        <LandingFeatureVideo
          src="/landing/launch-film-original.mp4"
          poster="/landing/launch-film-original-poster.webp"
        />
      </Card>
    </LandingSection>
  );
}
