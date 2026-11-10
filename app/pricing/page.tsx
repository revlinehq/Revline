import type { Metadata } from 'next';
import { LandingNav } from '@/components/landing/nav';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFooter } from '@/components/landing/footer';
import { EDITOR_PLAN } from '@/lib/billing/plan';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Revline pricing',
  description: `Revline is $${EDITOR_PLAN.monthlyPrice} USD per month after a ${EDITOR_PLAN.trialDays}-day free trial. AI cuts the clips and you post them to TikTok, Instagram and YouTube.`,
  alternates: { canonical: '/pricing' },
};

export default function PricingPage() {
  return <main className="landing">
    <LandingNav />
    <h1 className="sr-only">Revline pricing</h1>
    <LandingPricing />
    <LandingFaq />
    <LandingFooter />
  </main>;
}
