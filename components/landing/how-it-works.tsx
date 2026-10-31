import { LandingStepVideo } from './step-video';
import { LandingHeading, LandingSection } from './ui';

// Each step is its title over its film, full width.
// Films are looping exports of the "Landing: How it works steps" Revline project, one timeline tab per step.
const steps: { title: string; film?: string }[] = [
  { title: 'Drop in your raw footage', film: 'how-drop' },
  { title: 'Ask what you want', film: 'how-ask' },
  { title: 'Tweak anything', film: 'how-tweak' },
  { title: 'Export or share', film: 'how-export' },
];

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="How the magic happens" />
    <div className="landing-steps">{steps.map(step => <article key={step.title} className="landing-step">
      <h3 className="landing-step-title">{step.title}</h3>
      <div className="landing-step-visual" aria-hidden="true">{step.film && <LandingStepVideo src={`/landing/${step.film}.mp4`} poster={`/landing/${step.film}-poster.webp`} />}</div>
    </article>)}</div>
  </LandingSection>;
}
