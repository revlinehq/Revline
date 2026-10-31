import { LandingStepVideo } from './step-video';
import { LandingHeading, LandingSection } from './ui';

// Each step is a grainy gradient card holding its title and, under it, its film.
// Films are looping exports of the "Landing: How it works steps" Revline project, one timeline tab per step.
const steps: { title: string; grain: string; film?: string }[] = [
  { title: 'Drop in your raw footage', grain: 'step-1', film: 'how-drop' },
  { title: 'Ask what you want', grain: 'step-2', film: 'how-ask' },
  { title: 'Tweak anything', grain: 'step-3', film: 'how-tweak' },
  { title: 'Export or share', grain: 'step-4', film: 'how-export' },
];

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="How the magic happens" />
    <div className="landing-steps">{steps.map(step => <article key={step.title} className="landing-step" style={{ backgroundImage: `url(/landing/grain/${step.grain}.webp)` }}>
      <h3 className="landing-step-title">{step.title}</h3>
      {step.film && <div className="landing-step-visual" aria-hidden="true"><LandingStepVideo src={`/landing/${step.film}.mp4`} poster={`/landing/${step.film}-poster.webp`} /></div>}
    </article>)}</div>
  </LandingSection>;
}
