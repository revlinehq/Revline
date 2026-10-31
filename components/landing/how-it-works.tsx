import { LandingStepVideo } from './step-video';
import { LandingHeading, LandingSection } from './ui';

// Each step is its film, full width, with the title and line under it.
// Films are looping exports of the "Landing: How it works steps" Revline project, one timeline tab per step.
const steps: { title: string; description: string; film?: string }[] = [
  { title: 'Drop in your raw footage', description: 'A single take, a whole shoot, or a link. Revline transcribes and watches every second.', film: 'how-drop' },
  { title: 'Ask what you want', description: 'Plain words. Revline makes the cuts and shows you every change.' },
  { title: 'Tweak anything', description: 'Undo, adjust or ask again. Every cut, caption and effect stays editable.', film: 'how-tweak' },
  { title: 'Export or share', description: 'An MP4 for any platform, or a link people can explore.', film: 'how-export' },
];

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="How the magic happens" />
    <div className="landing-steps">{steps.map(step => <article key={step.title} className="landing-step">
      <div className="landing-step-text"><h3>{step.title}</h3><p>{step.description}</p></div>
      <div className="landing-step-visual" aria-hidden="true">{step.film && <LandingStepVideo src={`/landing/${step.film}.mp4`} poster={`/landing/${step.film}-poster.webp`} />}</div>
    </article>)}</div>
  </LandingSection>;
}
