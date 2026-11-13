import { PLANS, PLAN_TIERS, TRIAL_DAYS } from '@/lib/billing/plan';
import { PlanCard, PlanGrid } from '@/components/workspace/plan-card';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

// The same plan cards as the in-app upgrade dialog. A visitor signs in and lands on a new project, where the plan
// picker opens checkout; a signed-in member goes to billing, where they can change their plan.
export function LandingPricing() {
  return <LandingSection id="pricing" className="landing-pricing" headingId="landing-pricing-heading" data-nav-tone="dark">
    <LandingHeading id="landing-pricing-heading" align="center" title="Cheaper than an editor. Faster too." description={`Three plans, from $${PLANS.starter.monthlyPrice} a month. ${TRIAL_DAYS}-day free trial on every plan.`} />
    <PlanGrid>{PLAN_TIERS.map(tier => {
      const plan = PLANS[tier];
      return <PlanCard key={tier} tier={tier} headingLevel={3} badge={plan.featured ? 'Most popular' : undefined}
        note={`${TRIAL_DAYS} days free, then $${plan.monthlyPrice}/month`}>
        <LandingStartButton label="Start free trial" variant={plan.featured ? 'primary' : 'inverse-outline'} size="lg" block signedInHref="/profile#billing" />
      </PlanCard>;
    })}</PlanGrid>
  </LandingSection>;
}
