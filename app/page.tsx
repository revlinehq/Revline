import { LandingNav } from '@/components/landing/nav';
import { LandingHero } from '@/components/landing/hero';
import { LandingFeatures } from '@/components/landing/features';
import { LandingClippers } from '@/components/landing/clippers';
import { LandingMcp } from '@/components/landing/mcp';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFinalCta } from '@/components/landing/final-cta';
import { LandingFooter } from '@/components/landing/footer';
import { PLANS, PLAN_TIERS, TRIAL_DAYS } from '@/lib/billing/plan';
import type { Metadata } from 'next';
import './landing.css';

export const metadata: Metadata = { alternates: { canonical: '/' } };

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization', '@id': 'https://tryrevline.com/#organization',
      name: 'Revline', url: 'https://tryrevline.com', logo: 'https://tryrevline.com/brand/revline-square-1024.png',
    },
    {
      '@type': ['SoftwareApplication', 'Product'], '@id': 'https://tryrevline.com/#application',
      name: 'Revline', url: 'https://tryrevline.com', applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web', image: 'https://tryrevline.com/og-revline-v6.png',
      description: 'An AI video editor for real footage: prompt-based cuts, captions, vertical clips and short-form edits, with MCP access for AI agents.',
      brand: { '@id': 'https://tryrevline.com/#organization' },
      offers: PLAN_TIERS.map(tier => ({
        '@type': 'Offer', name: `Revline ${PLANS[tier].name}`, url: 'https://tryrevline.com/pricing', price: PLANS[tier].monthlyPrice,
        priceCurrency: PLANS[tier].currency,
        priceSpecification: { '@type': 'UnitPriceSpecification', price: PLANS[tier].monthlyPrice, priceCurrency: PLANS[tier].currency, unitText: 'month' },
        description: `${TRIAL_DAYS}-day free trial, then $${PLANS[tier].monthlyPrice} USD per month.`,
      })),
    },
  ],
};

export default function Home() {
  return <main className="landing">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <LandingNav />
    <LandingHero />
    <LandingClippers />
    <LandingFeatures />
    <LandingMcp />
    <LandingPricing />
    <LandingFaq />
    <LandingFinalCta />
    <LandingFooter />
  </main>;
}
