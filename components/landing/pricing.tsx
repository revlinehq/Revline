import { Check } from 'lucide-react';
import { LandingStartButton } from './start-button';

export function LandingPricing() {
  return <section id="pricing" className="landing-pricing landing-section" aria-labelledby="landing-pricing-heading">
    <div className="landing-pricing-copy"><h2 id="landing-pricing-heading">One plan.<br />More time to create.</h2><p>Start with a short trial. Keep creating with one simple monthly membership.</p></div>
    <div className="landing-price-card">
      <h3>Revline</h3>
      <div className="landing-price"><strong>$39</strong><div><span>/ month</span><small>USD</small></div></div>
      <p className="landing-price-disclosure">3 days free. Then $39/month.<br />Cancel anytime.</p>
      <hr />
      <ul>{['Editing in conversation', 'A preview you can refine', 'A timeline when you need it'].map(benefit => <li key={benefit}><Check size={14} aria-hidden="true" />{benefit}</li>)}</ul>
      <LandingStartButton className="landing-pricing-button" />
    </div>
  </section>;
}
