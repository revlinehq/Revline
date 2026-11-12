import type { Metadata } from 'next';
import { LandingNav } from '@/components/landing/nav';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFooter } from '@/components/landing/footer';
import { EDITOR_PLAN } from '@/lib/billing/plan';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Revline pricing',
  description: `Revline Editor Pro is $${EDITOR_PLAN.monthlyPrice} USD per month after a ${EDITOR_PLAN.trialDays}-day trial. Includes MCP and 1080p exports.`,
  alternates: { canonical: '/pricing' },
};

export default function PricingPage() {
  return <main className="landing">
    <LandingNav />
    <section className="landing-section landing-hero"><div className="landing-hero-copy"><h1>Revline pricing</h1></div></section>
    <LandingPricing />
    <LandingFaq />
    <LandingFooter />
  </main>;
}
