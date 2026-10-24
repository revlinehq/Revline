import { Check } from 'lucide-react';
import { LandingStartButton } from './start-button';

const features = [
  'Editing in conversation',
  'A preview you can refine',
  'A timeline when you need it',
  'Auto captions in your brand font',
  'Silence and filler-word removal',
  'Export in 9:16, 1:1 and 16:9',
  'Up to 4K, no watermark',
  'Unlimited projects and uploads',
];

export function LandingPricing() {
  return <section id="pricing" className="landing-pricing landing-section" aria-labelledby="landing-pricing-heading">
    <header><h2 id="landing-pricing-heading">One plan. More time to create.</h2><p>Start with a short trial. Keep creating with one simple monthly membership.</p></header>
    <div className="landing-plan">
      <div className="landing-plan-top">
        <h3>Revline</h3>
        <div className="landing-price"><strong>$39</strong><span>/ month <small>USD</small></span></div>
        <p>3 days free. Then $39/month. Cancel anytime.</p>
      </div>
      <LandingStartButton label="Start free trial" className="landing-button-block" />
      <ul>{features.map(feature => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
    </div>
  </section>;
}
