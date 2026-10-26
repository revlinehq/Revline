import { Check } from 'lucide-react';
import { EDITOR_PLAN, ULTRA_FEATURES, ULTRA_PLAN } from '@/lib/billing/plan';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

// Background removal and subject masking run on paid models per frame, so they are Ultra features.
const plans = [
  { name: 'Revline Pro', description: 'For creators editing every week.', price: EDITOR_PLAN.monthlyPrice, features: [
    'AI trims and cuts', 'Animated subtitles', 'Text effects', 'Motion design', 'Export in 9:16, 1:1 and 16:9', '1080p export, no watermark', 'Unlimited projects, 50 GB storage',
  ], cta: 'Start free trial', note: `${EDITOR_PLAN.trialDays} days free, then $${EDITOR_PLAN.monthlyPrice}/month` },
  { name: 'Revline Ultra', description: 'For power users.', price: ULTRA_PLAN.monthlyPrice, lead: 'Everything in Pro, plus', features: ULTRA_FEATURES, cta: 'Get Ultra', note: 'Cancel anytime', ultra: true },
] as const;

export function LandingPricing() {
  return <LandingSection id="pricing" className="landing-pricing" headingId="landing-pricing-heading">
    <LandingHeading id="landing-pricing-heading" align="center" title="Cheaper than an editor. Faster too." description={`Try it free for ${EDITOR_PLAN.trialDays} days. Cancel anytime.`} />
    <div className="landing-plans">{plans.map(plan => <article key={plan.name} className="landing-plan" data-ultra={'ultra' in plan || undefined}>
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
        {'ultra' in plan ? <LandingStartButton label={plan.cta} variant="inverse" size="lg" block signedInHref="/profile#billing" /> : <LandingStartButton label={plan.cta} variant="secondary" size="lg" block />}
        <small>{plan.note}</small>
      </footer>
    </article>)}</div>
  </LandingSection>;
}
