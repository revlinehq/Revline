import { LandingNav } from '@/components/landing/nav';
import { LandingHero } from '@/components/landing/hero';
import { LandingLogos } from '@/components/landing/logos';
// Hidden until there is enough footage to show each use case.
// import { LandingUseCases } from '@/components/landing/use-cases';
import { LandingHowItWorks } from '@/components/landing/how-it-works';
import { LandingMcp } from '@/components/landing/mcp';
import { LandingTestimonial } from '@/components/landing/testimonial';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFinalCta } from '@/components/landing/final-cta';
import { LandingFooter } from '@/components/landing/footer';
import './landing.css';


export default function Home() {
  return <main className="landing">
    <LandingNav />
    <LandingHero />
    <LandingLogos />
    {/* <LandingUseCases /> */}
    <LandingHowItWorks />
    <LandingMcp />
    <LandingTestimonial />
    <LandingPricing />
    <LandingFaq />
    <LandingFinalCta />
    <LandingFooter />
  </main>;
}
