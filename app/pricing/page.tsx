import type { Metadata } from 'next';
import { LandingNav } from '@/components/landing/nav';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFooter } from '@/components/landing/footer';
import { PLANS } from '@/lib/billing/plan';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Revline pricing',
  description: `Revline Starter is $${PLANS.starter.monthlyPrice}, Pro $${PLANS.pro.monthlyPrice} after a ${PLANS.pro.trialDays}-day trial, and Studio $${PLANS.studio.monthlyPrice} USD per month. Pro adds MCP; Studio adds 4K exports.`,
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
