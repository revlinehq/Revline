import { LandingFeatureVideo } from './feature-video';
import { LandingHeading, LandingSection } from './ui';

/** Clipping a stream into vertical shorts, shown as a film made in Revline. */
export function LandingClippers() {
  return <LandingSection id="clippers" className="landing-clippers" headingId="landing-clippers-heading">
    <LandingHeading id="landing-clippers-heading" align="center" size="lg" title="Revline for clippers" description="Drop in a stream and get vertical clips with the creator on top and the gameplay below, ready to post." />
    <div className="landing-clippers-frame">
      <LandingFeatureVideo src="/landing/clippers.mp4" poster="/landing/clippers-poster.jpg" />
    </div>
  </LandingSection>;
}
