import type { ReactNode } from 'react';
import { Bell } from 'lucide-react';
import { LandingHeading, LandingSection } from './ui';
import { LandingSoundStage } from './sound-stage';

// The speed ramp's rate over the clip: fast, a slow-mo dip on the jump, fast again (bar heights in px).
const ramp = [62, 70, 80, 90, 92, 82, 62, 42, 27, 25, 25, 27, 42, 62, 82, 92, 90, 80, 70, 62];

function Feature({ title, description, stage, wide, interactive, children }: { title: string; description: string; stage: string; wide?: boolean; interactive?: boolean; children: ReactNode }) {
  return <article className="landing-feature" data-wide={wide || undefined}>
    <div className="landing-feature-stage" data-stage={stage} aria-hidden={interactive ? undefined : true}>{children}</div>
    <div className="landing-feature-text"><h3>{title}</h3><p>{description}</p></div>
  </article>;
}

function Layer({ name, kind, thumb, active }: { name: string; kind: string; thumb?: string; active?: boolean }) {
  return <div className="landing-layer" data-active={active || undefined}>
    {thumb ? <img src={`/landing/${thumb}.webp`} alt="" data-dim={kind === 'Background' || undefined} /> : <span>Aa</span>}
    <div><b>{name}</b><small>{kind}</small></div>
  </div>;
}

export function LandingFeatures() {
  return <LandingSection id="features" className="landing-features" headingId="landing-features-heading">
    <LandingHeading id="landing-features-heading" title="More from Revline" description="Effects that used to need After Effects, done by asking." />
    <div className="landing-feature-grid">
      <Feature title="Text behind you" description="Words sit between you and the background." stage="layers">
        <Layer name="You" kind="Cut-out" thumb="talking-head" />
        <Layer name="LEGEND" kind="Text" active />
        <Layer name="Original footage" kind="Background" thumb="talking-head" />
      </Feature>
      <Feature title="Tracked labels" description="Captions and stickers follow what moves." stage="tracking">
        <span className="landing-track-box" />
        <span className="landing-track-label"><i />Sony A7 IV</span>
      </Feature>
      <Feature title="Speed ramps" description="Slow-mo hits on the beat, frame exact." stage="ramp">
        <div className="landing-ramp">
          <div className="landing-ramp-head"><b>Hero ramp</b><small>slow-mo on the jump</small></div>
          <div className="landing-ramp-bars">{ramp.map((height, index) => <i key={index} style={{ height }} data-slow={height < 30 || undefined} />)}</div>
          <div className="landing-ramp-axis"><span>1.6×</span><span>0.25×</span><span>1.6×</span></div>
        </div>
      </Feature>
      <Feature title="Masks" description="Reveal through shapes, text, or a moving spotlight." stage="mask">
        <span className="landing-mask-ring"><img src="/landing/podcast.webp" alt="" /></span>
        <span className="landing-mask-chip">Ellipse mask · soft edge</span>
      </Feature>
      <Feature title="Motion blur" description="Every move feels shot, not keyframed." stage="blur">
        <div className="landing-blur-trail">{[.12, .25, .5, 1].map(opacity => <span key={opacity} style={{ opacity }}><Bell size={14} />Subscribe</span>)}</div>
        <span className="landing-blur-chip">motion blur 0.5</span>
      </Feature>
      <Feature title="Animated captions" description="Word-by-word, styled to your brand." stage="captions">
        <p className="landing-caption-demo">this is <b>INSANE</b> <span>right?</span></p>
      </Feature>
      <Feature title="Sound effects, generated" description="Describe a sound and Revline makes it, then lands it on the exact frame of the move it scores." stage="sound" wide interactive>
        <LandingSoundStage />
      </Feature>
    </div>
  </LandingSection>;
}
