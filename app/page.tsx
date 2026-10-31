import { LandingNav } from '@/components/landing/nav';
import { LandingHero } from '@/components/landing/hero';
import { LandingUseCases } from '@/components/landing/use-cases';
import { LandingHowItWorks } from '@/components/landing/how-it-works';
import { LandingFeatures } from '@/components/landing/features';
import { LandingMotion } from '@/components/landing/motion';
import { LandingInspo } from '@/components/landing/inspo';
import { LandingMcp } from '@/components/landing/mcp';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFinalCta } from '@/components/landing/final-cta';
import { LandingFooter } from '@/components/landing/footer';
import './landing.css';


export default function Home() {
  return <main className="landing">
    <LandingNav />
    <LandingHero />
    <LandingUseCases />
    <LandingHowItWorks />
    <LandingFeatures />
    <LandingMotion />
    <LandingInspo />
    <LandingMcp />
    <LandingPricing />
    <LandingFaq />
    <LandingFinalCta />
    <LandingFooter />
  </main>;
}
