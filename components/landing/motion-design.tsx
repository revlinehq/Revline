import { LandingFeatureVideo } from './feature-video';
import { LandingHeading, LandingSection } from './ui';

export function LandingMotionDesign() {
  return (
    <LandingSection
      id="motion-design"
      className="landing-motion-design"
      headingId="landing-motion-design-heading"
    >
      <LandingHeading
        id="landing-motion-design-heading"
        title="Revline for Motion Design"
        description="Launch films, explainers and motion graphics, built from a prompt and editable on your timeline."
      />
      <div className="landing-motion-design-frame">
        <LandingFeatureVideo
          src="/landing/launch-film-original.mp4"
          poster="/landing/launch-film-original-poster.webp"
        />
      </div>
    </LandingSection>
  );
}
