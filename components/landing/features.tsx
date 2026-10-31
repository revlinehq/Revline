import type { ReactNode } from 'react';
import { LandingHeading, LandingSection } from './ui';
import { LandingFeatureVideo } from './feature-video';

function Feature({ title, description, stage, children }: { title: string; description: string; stage: string; children: ReactNode }) {
  return <article className="landing-feature">
    <div className="landing-feature-stage" data-stage={stage} aria-hidden="true">{children}</div>
    <div className="landing-feature-text"><h3>{title}</h3><p>{description}</p></div>
  </article>;
}

export function LandingFeatures() {
  return <LandingSection id="features" className="landing-features" headingId="landing-features-heading">
    <LandingHeading id="landing-features-heading" title="Revline's Agent is powerful" description={<>Effects that used to need <span className="landing-app-logos"><img src="/landing/logos/premiere-pro.svg" alt="Premiere Pro" /><img src="/landing/logos/after-effects.svg" alt="After Effects" /><img src="/landing/logos/capcut.png" alt="CapCut" /></span>, done by AI.</>} />
    <div className="landing-feature-grid">
      <Feature title="Text behind you" description="Words sit between you and the background." stage="film">
        <LandingFeatureVideo src="/landing/text-behind-you.mp4" poster="/landing/text-behind-you-poster.webp" />
      </Feature>
      <Feature title="Tracked labels" description="Captions and stickers follow what moves." stage="film">
        <LandingFeatureVideo src="/landing/tracked-labels.mp4" poster="/landing/tracked-labels-poster.webp" />
      </Feature>
      <Feature title="Speed ramps" description="Slow-mo hits on the beat, frame exact." stage="film">
        <LandingFeatureVideo src="/landing/speed-ramps.mp4" poster="/landing/speed-ramps-poster.webp" />
      </Feature>
      <Feature title="Masks" description="Reveal through shapes, text, or a moving spotlight." stage="film">
        <LandingFeatureVideo src="/landing/masks.mp4" poster="/landing/masks-poster.webp" />
      </Feature>
      <Feature title="Split screen" description="Two-up, three-up or stacked for vertical." stage="film">
        <LandingFeatureVideo src="/landing/split-screen.mp4" poster="/landing/split-screen-poster.webp" />
      </Feature>
      <Feature title="Animated captions" description="Word-by-word, styled to your brand." stage="film">
        <LandingFeatureVideo src="/landing/animated-captions.mp4" poster="/landing/animated-captions-poster.webp" />
      </Feature>
    </div>
  </LandingSection>;
}
