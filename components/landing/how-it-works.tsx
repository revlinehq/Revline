import { LandingHeading, LandingSection } from './ui';

const steps = [
  { title: 'Pick a campaign', text: 'Browse campaigns with the rate and the budget left on every card.' },
  { title: 'Let AI cut it', text: 'Drop the footage. Revline makes the clips and you adjust them with one click.' },
  { title: 'Post everywhere', text: 'Send each clip to TikTok, Instagram and YouTube now, or schedule it.' },
];

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="How it works" description="Three steps from a campaign to a posted clip." />
    <ol className="landing-steps">{steps.map((step, index) => <li key={step.title} className="landing-step">
      <span className="landing-step-number" aria-hidden="true">{index + 1}</span>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
    </li>)}</ol>
  </LandingSection>;
}
