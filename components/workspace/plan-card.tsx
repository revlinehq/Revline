import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { PLANS, type PlanTier } from '@/lib/billing/plan';
import './plan-card.css';

/** One plan as an outlined card: name, price, what it includes and its call to action (`children`).
 *  The upgrade dialog, the editor paywall and the landing pricing all render plans with this card. */
export function PlanCard({ tier, children, note, badge, headingLevel = 2 }: { tier: PlanTier; children?: ReactNode; note?: ReactNode; badge?: ReactNode; headingLevel?: 2 | 3 }) {
  const plan = PLANS[tier], titleId = `plan-card-${tier}-title`, Heading = headingLevel === 3 ? 'h3' : 'h2';
  return <section className="plan-card" data-tier={tier} data-featured={plan.featured || undefined} aria-labelledby={titleId}>
    <header>
      <div className="plan-card-title"><Heading id={titleId} className="plan-card-name">{plan.name}</Heading>{badge && <span className="plan-card-badge">{badge}</span>}</div>
      <p>{plan.tagline}</p>
    </header>
    <div className="plan-card-price"><strong>${plan.monthlyPrice}</strong><span>/ month · {plan.currency}</span></div>
    <ul aria-label={`${plan.name} includes`}>
      {plan.lead && <li className="plan-card-lead">{plan.lead}</li>}
      {plan.features.map(feature => <li key={feature}><Check size={16} strokeWidth={1.5} aria-hidden="true" />{feature}</li>)}
    </ul>
    {(children || note) && <div className="plan-card-action">{children}{note && <small>{note}</small>}</div>}
  </section>;
}

/** The three plans side by side; one column at phone width. */
export function PlanGrid({ children }: { children: ReactNode }) {
  return <div className="plan-grid">{children}</div>;
}
