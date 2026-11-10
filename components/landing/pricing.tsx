import { Check } from 'lucide-react';
import { EDITOR_PLAN, ULTRA_FEATURES, ULTRA_OFFERED, ULTRA_PLAN } from '@/lib/billing/plan';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

// The landing's own feature list (from the design); the in-app paywall keeps PRO_FEATURES.
const LANDING_FEATURES = ['AI cuts clips from your footage', 'Subtitles, layouts and hooks in one click', 'Post and schedule to TikTok, Instagram and YouTube', 'Campaigns with the rate and budget left', '1080p export, no watermark', 'Unlimited projects, 50 GB storage'];

const plans = [
  { name: 'Revline Pro', price: EDITOR_PLAN.monthlyPrice, features: LANDING_FEATURES, cta: 'Start free trial', note: `${EDITOR_PLAN.trialDays} days free, then $${EDITOR_PLAN.monthlyPrice}/month` },
  { name: 'Revline Ultra', price: ULTRA_PLAN.monthlyPrice, lead: 'Everything in Pro, plus', features: ULTRA_FEATURES, cta: 'Get Ultra', note: 'Cancel anytime', ultra: true },
].filter(plan => ULTRA_OFFERED || !('ultra' in plan));

export function LandingPricing() {
  return <LandingSection id="pricing" className="landing-pricing" headingId="landing-pricing-heading">
    <LandingHeading id="landing-pricing-heading" title={ULTRA_OFFERED ? 'Two plans.' : 'One plan.'} description={`Try it free for ${EDITOR_PLAN.trialDays} days. Cancel anytime.`} />
    <div className="landing-plans">{plans.map(plan => <article key={plan.name} className="landing-plan">
      <h3>{plan.name}</h3>
      <div className="landing-price"><strong>${plan.price}</strong><span>/ month</span></div>
      <ul>
        {'lead' in plan && <li className="landing-plan-lead">{plan.lead}</li>}
        {plan.features.map(feature => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}
      </ul>
      <footer>
        {'ultra' in plan ? <LandingStartButton label={plan.cta} size="lg" block signedInHref="/profile#billing" /> : <LandingStartButton label={plan.cta} variant={ULTRA_OFFERED ? 'soft' : 'primary'} size="lg" block />}
        <small>{plan.note}</small>
      </footer>
    </article>)}</div>
  </LandingSection>;
}
