import { Check } from 'lucide-react';
import { EDITOR_PLAN, ULTRA_FEATURES, ULTRA_OFFERED, ULTRA_PLAN } from '@/lib/billing/plan';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

// The landing's own feature list (from the design); billing pages keep PRO_FEATURES.
const LANDING_FEATURES = ['AI trims and cuts', 'Animated subtitles', 'Text effects', 'Background removal', 'Masks and tracking', 'Export in 9:16, 1:1 and 16:9', '1080p export, no watermark', 'Unlimited projects, 50 GB storage'];

const plans = [
  { name: 'Revline Pro', description: 'For everyone.', price: EDITOR_PLAN.monthlyPrice, features: LANDING_FEATURES, cta: 'Start free trial', note: `${EDITOR_PLAN.trialDays} days free, then $${EDITOR_PLAN.monthlyPrice}/month` },
  { name: 'Revline Ultra', description: 'For power users.', price: ULTRA_PLAN.monthlyPrice, lead: 'Everything in Pro, plus', features: ULTRA_FEATURES, cta: 'Get Ultra', note: 'Cancel anytime', ultra: true },
].filter(plan => ULTRA_OFFERED || !('ultra' in plan));

export function LandingPricing() {
  return <LandingSection id="pricing" className="landing-pricing" headingId="landing-pricing-heading" data-nav-tone="dark">
    <LandingHeading id="landing-pricing-heading" align="center" title="Cheaper than an editor. Faster too." description={`Try it free for ${EDITOR_PLAN.trialDays} days. Cancel anytime.`} />
    <div className="landing-plans">{plans.map(plan => <article key={plan.name} className="landing-plan">
      <header>
        <h3>{plan.name}</h3>
        <p>{plan.description}</p>
      </header>
      <div className="landing-price"><strong>${plan.price}</strong><span>/ month</span></div>
      <ul>
        {'lead' in plan && <li className="landing-plan-lead">{plan.lead}</li>}
        {plan.features.map(feature => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}
      </ul>
      <footer>
        {'ultra' in plan ? <LandingStartButton label={plan.cta} variant="primary" size="lg" block signedInHref="/profile#billing" /> : <LandingStartButton label={plan.cta} variant={ULTRA_OFFERED ? 'secondary' : 'primary'} size="lg" block />}
        <small>{plan.note}</small>
      </footer>
    </article>)}</div>
  </LandingSection>;
}
