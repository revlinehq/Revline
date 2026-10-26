import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { ULTRA_FEATURES, ULTRA_PLAN } from '@/lib/billing/plan';
import './ultra-plan-card.css';

/** The Ultra offer, outlined like the Pro card. `children` is the call to action. */
export function UltraPlanCard({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <section className="ultra-plan-card" aria-labelledby="ultra-plan-title">
    <header>
      <h2 id="ultra-plan-title">Revline Ultra</h2>
      <p>For power users.</p>
    </header>
    <div className="ultra-plan-price"><strong>${ULTRA_PLAN.monthlyPrice}</strong><span>/ month · {ULTRA_PLAN.currency}</span></div>
    <ul aria-label="Ultra adds">
      <li className="ultra-plan-lead">Everything in Pro, plus</li>
      {ULTRA_FEATURES.map(feature => <li key={feature}><Check size={16} strokeWidth={1.5} aria-hidden="true" />{feature}</li>)}
    </ul>
    <div className="ultra-plan-action">{children}{note && <small>{note}</small>}</div>
  </section>;
}
