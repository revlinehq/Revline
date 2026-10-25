import { Geist, Geist_Mono, Outfit } from 'next/font/google';
import { LandingNav } from '@/components/landing/nav';
import { LandingHero } from '@/components/landing/hero';
import { LandingLogos } from '@/components/landing/logos';
// Hidden until there is enough footage to show each use case.
// import { LandingUseCases } from '@/components/landing/use-cases';
import { LandingHowItWorks } from '@/components/landing/how-it-works';
import { LandingFeatures } from '@/components/landing/features';
import { LandingTestimonial } from '@/components/landing/testimonial';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFinalCta } from '@/components/landing/final-cta';
import { LandingFooter } from '@/components/landing/footer';
import './landing.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--landing-font-head' });
const geist = Geist({ subsets: ['latin'], variable: '--landing-font-body' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--landing-font-mono' });

export default function Home() {
  return <main className={`landing ${outfit.variable} ${geist.variable} ${geistMono.variable}`}>
    <LandingNav />
    <LandingHero />
    <LandingLogos />
    {/* <LandingUseCases /> */}
    <LandingHowItWorks />
    <LandingFeatures />
    <LandingTestimonial />
    <LandingPricing />
    <LandingFaq />
    <LandingFinalCta />
    <LandingFooter />
  </main>;
}
